<?php

namespace App\Services\Automation;

use App\Models\AiProvider;
use App\Models\Automation;
use App\Models\DbConnection;
use App\Services\AiServiceClient;
use App\Services\FeatureFlagService;
use App\Services\NoveltyCheckService;
use App\Services\QualityScoreService;
use App\Services\SafeDatabaseExecutor;
use Carbon\CarbonInterface;
use Exception;
use Illuminate\Support\Str;

/**
 * One content run, shared by background executions and the live preview:
 *
 *   1. field plan from the live schema and the automation's mappings
 *   2. knowledge-base passages (RAG) when documents are attached
 *   3. AI text for every AI column, including the name of any parent record the AI should choose
 *   4. novelty check against recent titles (one regeneration with a new angle if too similar)
 *   5. parent decisions: reuse an existing record or create one (only where allowed)
 *   6. images for image columns, generated from the content that was just written
 *   7. fixed values, slugs, timestamps
 *   8. a read-only dry run of the exact INSERT plan against the live database
 *
 * It never writes to the customer database. Publishing happens later in PublishAutomationContentJob.
 */
class ContentPipeline
{
    public function __construct(
        protected AiServiceClient $ai,
        protected FieldPlanBuilder $planBuilder,
        protected ImageFieldService $images,
        protected SafeDatabaseExecutor $executor,
        protected NoveltyCheckService $novelty,
    ) {}

    /**
     * @param array $options rejection_feedback, recent_titles, publication_time (Carbon), include_images (bool)
     * @param callable|null $log fn(string $stage, string $message, ?array $metadata)
     * @return array{payload: array, meta: array}
     */
    public function run(Automation $automation, array $options = [], ?callable $log = null): array
    {
        $log ??= fn() => null;
        $started = microtime(true);
        $connection = $automation->connection;
        if (!$connection instanceof DbConnection) {
            throw new Exception('The automation has no database connection.');
        }

        // 1. Field plan (short-lived connection; never held open across model calls)
        $pdo = $connection->createTargetPdo();
        try {
            $plan = $this->planBuilder->build($automation, $connection, $pdo);
        } finally {
            $pdo = null;
        }
        $planErrors = array_values(array_filter($plan['issues'], fn($i) => $i['level'] === 'error'));
        if (!empty($planErrors)) {
            throw new Exception('Field mapping problem: ' . implode(' ', array_map(fn($i) => $i['message'], $planErrors)));
        }
        $fields = $plan['fields'];
        $log('TABLE_READ', 'Read `' . $automation->target_table . '` from your database: ' . count($fields) . ' column(s) to fill.');
        $isManual = $automation->operation_mode === 'MANUAL_SCHEDULE';
        $tz = ScheduleCalculator::normalizeTimezone($automation->timezone);
        $dbTz = $connection->data_timezone ?: 'UTC';
        $publishAt = $options['publication_time'] ?? null;

        $payload = [];
        $relationOptions = [];
        $meta = [
            'version' => 2,
            'target_table' => $automation->target_table,
            'content_format' => $automation->generationOption('content_format', 'markdown'),
            'fields' => [],
            'relations' => [],
            'media' => [],
            'runtime_now' => [],
            'rag' => [],
            'issues' => [],
        ];

        $aiText = array_filter($fields, fn($f) => in_array($f['source'], ['ai_text', 'ai_relation'], true));
        $data = [];

        if (!$isManual && !empty($aiText)) {
            // 2. Knowledge passages (RAG retrieval with self-healing)
            $passages = [];
            if (!empty($automation->knowledge_document_ids)) {
                $docIds = is_array($automation->knowledge_document_ids)
                    ? array_values(array_unique(array_filter(array_map('intval', $automation->knowledge_document_ids))))
                    : [];
                $query = trim((string) ($automation->prompt_context ?: $automation->name));
                try {
                    $rawChunks = $this->ai->queryKnowledge($automation->user_id, $query, 4, $docIds);

                    // Self-healing: if 0 chunks returned and user has selected documents, check and auto-restore FAISS index
                    if (empty($rawChunks) && !empty($docIds)) {
                        try {
                            $indexer = app(\App\Services\Knowledge\KnowledgeIndexerService::class);
                            if ($indexer->ensureDocumentsIndexed($automation->user_id, $docIds)) {
                                $rawChunks = $this->ai->queryKnowledge($automation->user_id, $query, 4, $docIds);
                            }
                        } catch (\Throwable $healEx) {
                            Log::warning("[ContentPipeline] RAG self-healing attempt failed: " . $healEx->getMessage());
                        }
                    }

                    // Preload document titles for readable UI attribution
                    $docTitles = !empty($docIds)
                        ? \App\Models\KnowledgeDocument::where('user_id', $automation->user_id)
                            ->whereIn('id', $docIds)
                            ->pluck('title', 'id')
                            ->toArray()
                        : [];

                    foreach ($rawChunks as $chunk) {
                        $txt = $chunk['text'] ?? $chunk['content'] ?? '';
                        if ($txt !== '') {
                            $passages[] = $txt;
                            $docId = $chunk['document_id'] ?? null;
                            $meta['rag'][] = [
                                'document_id' => $docId,
                                'document_title' => $docTitles[$docId] ?? ($docId ? "Document #{$docId}" : "Knowledge Base"),
                                'chunk_id' => $chunk['chunk_id'] ?? null,
                                'score' => isset($chunk['score']) ? (float) $chunk['score'] : null,
                                'snippet' => Str::limit($txt, 300),
                            ];
                        }
                    }
                    $log('RAG_CONTEXT_RETRIEVED', 'Retrieved ' . count($passages) . " passage(s) from your knowledge base for '" . Str::limit($query, 80) . "'.", [
                        'query' => $query,
                        'chunks' => count($passages),
                        'document_ids' => $docIds,
                        'retrieved_passages' => $meta['rag'],
                    ]);
                } catch (\Throwable $e) {
                    $meta['issues'][] = ['level' => 'warning', 'column' => null, 'message' => 'Knowledge base search failed; content was written without it (' . Str::limit($e->getMessage(), 120) . ').'];
                    $log('RAG_CONTEXT_FAILED', 'Knowledge base search failed: ' . Str::limit($e->getMessage(), 200));
                }
            }

            // 3. AI text
            [$provider, $model, $apiKey] = $this->resolveTextProvider($automation);
            $specs = $this->fieldSpecs($automation, $aiText);
            $prompt = $this->buildPrompt($automation);
            $recent = $options['recent_titles'] ?? [];

            $log('AI_INFERENCE_STARTED', "Writing " . count($aiText) . " field(s) with {$provider}" . ($model ? " ({$model})" : '') . '.', [
                'provider' => $provider,
                'model' => $model,
                'fields' => array_keys($aiText),
                'has_rag_context' => !empty($passages),
                'prompt_preview' => Str::limit($prompt, 400),
            ]);

            $result = $this->generateText($provider, $model, $apiKey, $automation, $prompt, $specs, $passages, $options['rejection_feedback'] ?? null, $recent);
            $data = $result['data'];
            $meta['provider'] = $provider;
            $meta['model'] = $result['model_used'] ?? $model;
            $meta['latency_seconds'] = $result['latency_seconds'] ?? null;

            // 4. Novelty
            $titleCol = $this->firstField($aiText, 'title');
            if ($titleCol && !empty($data[$titleCol]) && !empty($recent) && $automation->exists) {
                try {
                    $check = $this->novelty->check((string) $data[$titleCol], $automation, 0.92);
                    if (!empty($check['is_duplicate'])) {
                        $log('NOVELTY_DUPLICATE_DETECTED', "Title '{$data[$titleCol]}' is too similar to '{$check['matched_title']}'; rewriting with a new angle.", $check);
                        $angle = $prompt . "\n\nIMPORTANT: '{$data[$titleCol]}' is too similar to an earlier post ('{$check['matched_title']}'). " . ($check['angle_suggestion'] ?? 'Take a clearly different angle and title.');
                        $retry = $this->generateText($provider, $model, $apiKey, $automation, $angle, $specs, $passages, $options['rejection_feedback'] ?? null, $recent);
                        if (!empty($retry['data'][$titleCol])) {
                            $data = $retry['data'];
                            $log('NOVELTY_ANGLE_APPLIED', "New title: '{$data[$titleCol]}'.");
                        }
                    } else {
                        $log('NOVELTY_VERIFIED', 'Title is distinct from recent posts.');
                    }
                } catch (\Throwable) {
                    // Novelty is advisory.
                }
            }

            $missing = array_values(array_filter(array_keys($aiText), fn($col) => !isset($data[$col]) || (is_string($data[$col]) && trim($data[$col]) === '')));
            $missingRequired = array_values(array_filter($missing, fn($col) => !$fields[$col]['meta']['nullable']));
            if (!empty($missingRequired)) {
                throw new Exception('The AI model did not write: ' . implode(', ', $missingRequired) . '. Run it again, or choose a larger model on the AI step.');
            }
            foreach ($missing as $col) {
                $meta['issues'][] = ['level' => 'warning', 'column' => $col, 'message' => "The AI model left `{$col}` empty."];
            }

            $log('AI_INFERENCE_COMPLETED', 'Received ' . count($data) . " field(s) from {$provider}.", [
                'provider' => $provider,
                'model' => $meta['model'],
                'latency_seconds' => $meta['latency_seconds'],
            ]);
        }

        // 5 + 7. Values per column
        $context = ['topic' => $automation->prompt_context, 'entity' => Str::singular(str_replace('_', ' ', $automation->target_table))];
        foreach ($fields as $col => $f) {
            $m = $f['mapping'];
            $c = $f['meta'];
            switch ($f['source']) {
                case 'ai_text':
                    if (!array_key_exists($col, $data)) {
                        break;
                    }
                    $value = $data[$col];
                    if ($f['kind'] === 'body' && is_string($value)) {
                        $value = $this->dropRepeatedTitleHeading($value, $data, $aiText);
                    }
                    if ($f['kind'] === 'body' && $meta['content_format'] === 'html' && is_string($value)) {
                        $value = Str::markdown($value, ['html_input' => 'strip', 'allow_unsafe_links' => false]);
                    }
                    if ($f['kind'] === 'boolean' && is_string($value)) {
                        $value = in_array(strtolower(trim($value)), ['true', '1', 'yes'], true) ? 1 : 0;
                    }
                    $payload[$col] = $value;
                    break;

                case 'ai_relation':
                    $rel = $f['relation'];
                    $label = trim((string) ($data[$col] ?? ''));
                    // A separate decision once the content exists: does an existing parent really fit it, or is a new one needed?
                    $decided = $isManual ? null : $this->decideParent($automation, $col, $rel, $label, $data, $aiText, $log);
                    $reason = $decided['reason'] ?? null;
                    if ($decided) {
                        $label = $decided['label'];
                    }
                    if ($label === '') {
                        if ($c['nullable']) {
                            $payload[$col] = null;
                            break;
                        }
                        throw new Exception("The AI model did not choose a {$rel['entity']} for `{$col}`.");
                    }
                    $existing = $this->matchOption($label, $rel['options']);
                    if ($existing === null && !$rel['allow_create']) {
                        $closest = $this->closestOption($label, $rel['options']);
                        if ($closest === null) {
                            throw new Exception("The AI model suggested {$rel['entity']} '{$label}', which does not exist, and creating new ones is not allowed for `{$col}`.");
                        }
                        $meta['issues'][] = ['level' => 'info', 'column' => $col, 'message' => "AI suggested '{$label}', which does not exist; using the closest existing {$rel['entity']} '{$closest}'."];
                        $existing = $closest;
                    }
                    $final = $existing ?? Str::limit(Str::title($label), 80, '');
                    $payload[$col] = $final;
                    $description = trim((string) ($data["__{$col}_description"] ?? ''));
                    $relationOptions[$col] = [
                        'referenced_table' => $rel['table'],
                        'referenced_column' => $rel['column'],
                        'creation_policy' => $rel['allow_create'] ? 'CREATE_IF_MISSING' : 'REUSE_EXISTING_ONLY',
                        'description' => $description !== '' ? $description : null,
                    ];
                    $meta['relations'][] = [
                        'column' => $col,
                        'table' => $rel['table'],
                        'entity' => $rel['entity'],
                        'label' => $final,
                        'decision' => $existing !== null ? 'reuse' : 'create',
                        'description' => $description !== '' ? $description : null,
                        'reason' => $reason,
                    ];
                    // The image prompt and cover label prefer a category-like parent, else the first parent.
                    if (str_contains($col, 'categor')) {
                        $context['category'] = $final;
                    } else {
                        $context['category'] ??= $final;
                    }
                    break;

                case 'fixed':
                    $payload[$col] = $m['fixed_value'];
                    break;

                case 'fixed_relation':
                    $payload[$col] = $m['fixed_value'];
                    $relationOptions[$col] = [
                        'referenced_table' => $f['relation']['table'],
                        'referenced_column' => $f['relation']['column'],
                        'creation_policy' => 'REUSE_EXISTING_ONLY',
                    ];
                    $meta['relations'][] = [
                        'column' => $col,
                        'table' => $f['relation']['table'],
                        'entity' => $f['relation']['entity'],
                        'label' => is_numeric($m['fixed_value']) ? "#{$m['fixed_value']}" : (string) $m['fixed_value'],
                        'decision' => 'fixed',
                    ];
                    break;

                case 'empty':
                    $payload[$col] = null;
                    break;

                case 'now':
                    $at = $publishAt instanceof CarbonInterface ? $publishAt->copy() : now();
                    $payload[$col] = $at->setTimezone($dbTz)->format('Y-m-d H:i:s');
                    $meta['runtime_now'][] = $col;
                    break;
            }
        }

        foreach ($fields as $col => $f) {
            if ($f['source'] === 'slug') {
                $src = $f['slug_source'] ?? null;
                $base = $src && isset($payload[$src]) ? (string) $payload[$src] : (string) ($payload[$this->firstField($fields, 'title') ?? ''] ?? $automation->name);
                $payload[$col] = Str::slug(Str::limit($base, 90, '')) ?: Str::lower(Str::random(10));
            }
        }

        $titleCol = $this->firstField($fields, 'title');
        $summaryCol = $this->firstField($fields, 'summary') ?? $this->firstField($fields, 'meta_description');
        $bodyCol = $this->firstField($fields, 'body');
        $context['title'] = $titleCol ? ($payload[$titleCol] ?? null) : null;
        $context['summary'] = $summaryCol ? ($payload[$summaryCol] ?? null) : ($bodyCol ? Str::limit(strip_tags((string) ($payload[$bodyCol] ?? '')), 300) : null);

        // 6. Images
        if (($options['include_images'] ?? true) && !$isManual) {
            $imageCols = array_keys(array_filter($fields, fn ($f) => $f['source'] === 'ai_image'));
            if ($imageCols) {
                $log('IMAGES_STARTED', 'Creating ' . count($imageCols) . ' image(s): ' . implode(', ', $imageCols) . '.');
            }
            foreach ($fields as $col => $f) {
                if ($f['source'] !== 'ai_image') {
                    continue;
                }
                try {
                    $img = $this->images->generate($automation, $col, $f['meta'], $context, $log);
                    if (!empty($f['media'])) {
                        // The column keeps images as rows of a media table: the new image becomes such a row first.
                        $row = $this->mediaRow($automation, $connection, $f['media'], $img['meta'], (string) ($context['title'] ?? $automation->name), !empty($options['wait_for_insights']), $log);
                        $payload[$col] = $row['label'];
                        $relationOptions[$col] = [
                            'referenced_table' => $f['media']['table'],
                            'referenced_column' => $f['media']['column'],
                            'creation_policy' => 'CREATE_IF_MISSING',
                            'parent_values' => $row['values'],
                            'always_new' => true,
                        ];
                        $img['meta']['stored_as'] = "a new row in {$f['media']['table']}";
                        foreach ($row['notes'] as $note) {
                            $meta['issues'][] = ['level' => 'info', 'column' => $col, 'message' => $note];
                        }
                    } else {
                        $payload[$col] = $img['value'];
                    }
                    $meta['media'][] = $img['meta'];
                } catch (\Throwable $e) {
                    if (!$f['meta']['nullable']) {
                        throw new Exception("Image for `{$col}` failed: " . $e->getMessage());
                    }
                    $payload[$col] = null;
                    $meta['issues'][] = ['level' => 'warning', 'column' => $col, 'message' => "Image for `{$col}` could not be created and was left empty (" . Str::limit($e->getMessage(), 140) . ').'];
                    $log('IMAGE_FAILED', "Image for `{$col}` failed: " . Str::limit($e->getMessage(), 200));
                }
            }
        }

        // Field summary for previews and email
        foreach ($fields as $col => $f) {
            $meta['fields'][] = [
                'column' => $col,
                'kind' => $f['kind'],
                'source' => $f['source'],
                'type' => $f['meta']['column_type'],
            ];
        }

        if (app(FeatureFlagService::class)->isEnabled('FEATURE_QUALITY_SCORE') && !$isManual) {
            try {
                $meta['quality_metrics'] = app(QualityScoreService::class)->evaluateContent($payload, array_column($meta['rag'], 'snippet'));
            } catch (\Throwable) {
            }
        }

        // 8. Read-only dry run of the INSERT
        $log('WRITE_CHECK_STARTED', 'Checking the write against your live table (nothing is written).');
        $plan = $this->executor->planInsert($connection, $automation->target_table, $payload, $relationOptions);
        $log('WRITE_CHECKED', $plan['can_publish'] ? 'The row fits your table: types, lengths, required columns and links checked.' : 'The row needs attention before it can be published (' . count($plan['issues']) . ' issue(s)).');
        $meta['write_plan'] = $plan;
        $meta['relation_options'] = $relationOptions;
        $meta['issues'] = array_merge($meta['issues'], $plan['issues']);
        $meta['can_publish'] = $plan['can_publish'];
        $meta['generated_at'] = now()->toIso8601String();
        $meta['duration_ms'] = (int) round((microtime(true) - $started) * 1000);
        $meta['timezone'] = $tz;

        return ['payload' => $payload, 'meta' => $meta];
    }

    /**
     * Effective text provider: the automation's choice, else the user's writing model (model roles / active
     * provider / local Ollama). Never a placeholder generator: if the model cannot be reached the run fails honestly.
     *
     * @return array{0: string, 1: ?string, 2: ?string} provider, model, api key
     */
    public function resolveTextProvider(Automation $automation): array
    {
        $provider = $automation->ai_provider;
        $model = $automation->ai_model;

        if (empty($provider) || $provider === 'none' || $provider === 'mock') {
            $chosen = \App\Services\Agent\ModelSelector::for($automation->user, \App\Models\ModelRole::ROLE_GENERATOR);
            $provider = $chosen['provider'];
            $model = $chosen['model'];
        } elseif (empty($model)) {
            // No model named: the "Writing content" model when it uses the same provider, else the provider's default.
            $chosen = \App\Services\Agent\ModelSelector::for($automation->user, \App\Models\ModelRole::ROLE_GENERATOR);
            $model = $chosen['provider'] === $provider ? $chosen['model'] : null;
        }

        $apiKey = AiProvider::where('user_id', $automation->user_id)->where('provider_type', $provider)->first()?->encrypted_api_key;
        return [$provider, $model, $apiKey];
    }

    private function generateText(string $provider, ?string $model, ?string $apiKey, Automation $a, string $prompt, array $specs, array $passages, ?string $feedback, array $recent): array
    {
        return $this->ai->generateContent([
            'provider' => $provider,
            'model' => $model,
            'api_key' => $apiKey,
            'prompt' => $prompt,
            'system_prompt' => 'You are an expert editor who writes accurate, original, well-structured content for websites. Write for real readers; do not mention that you are an AI.',
            'target_table' => $a->target_table,
            'required_fields' => array_column($specs, 'name'),
            'field_specs' => $specs,
            'length' => $a->generationOption('length', 'medium'),
            'context_passages' => $passages,
            'rejection_feedback' => $feedback,
            'recent_titles' => array_slice($recent, 0, 20),
            // How creative the writing is: the customer's "Writing content" role (provider default when not set).
            'temperature' => $a->user ? \App\Services\Agent\ModelSelector::temperature($a->user, \App\Models\ModelRole::ROLE_GENERATOR) : null,
        ]);
    }

    /** Field contract sent to the AI service, built only from the live schema and the mappings. */
    private function fieldSpecs(Automation $automation, array $aiFields): array
    {
        $specs = [];
        foreach ($aiFields as $col => $f) {
            $c = $f['meta'];
            $instructions = $f['mapping']['instructions'] ?? null;
            if ($f['source'] === 'ai_relation') {
                $rel = $f['relation'];
                $specs[] = [
                    'name' => $col,
                    'kind' => 'relation_label',
                    'entity' => $rel['entity'],
                    'options' => $rel['options'],
                    'allow_new' => $rel['allow_create'],
                    'required' => !$c['nullable'],
                    'max_length' => 80,
                    'instructions' => $instructions,
                ];
                if ($rel['allow_create']) {
                    $specs[] = [
                        'name' => "__{$col}_description",
                        'kind' => 'summary',
                        'max_length' => 200,
                        'required' => false,
                        'instructions' => "One sentence describing the {$rel['entity']} you chose for \"{$col}\" (used only if it is new).",
                    ];
                }
                continue;
            }

            $kind = match ($f['kind']) {
                'title', 'summary', 'body', 'meta_title', 'meta_description', 'keywords', 'number', 'boolean', 'enum' => $f['kind'],
                default => 'text',
            };
            $specs[] = [
                'name' => $col,
                'kind' => $kind,
                'max_length' => $kind === 'body' ? null : $c['max_length'],
                'enum_values' => $c['enum_values'] ?: null,
                'required' => !$c['nullable'],
                'instructions' => $instructions ?: ($kind === 'text' ? 'Value for the "' . str_replace('_', ' ', $col) . '" column.' : null),
            ];
        }
        return $specs;
    }

    private function buildPrompt(Automation $automation): string
    {
        $entity = Str::singular(str_replace('_', ' ', $automation->target_table));
        $topic = trim((string) $automation->prompt_context) ?: $automation->name;
        $tone = $automation->generationOption('tone', 'Professional, clear and engaging');
        $audience = $automation->generationOption('audience');

        $lines = [
            "Write one new {$entity} for the \"{$automation->target_table}\" table.",
            "Topic and direction: {$topic}",
            "Tone: {$tone}",
        ];
        if ($audience) {
            $lines[] = "Audience: {$audience}";
        }
        $lines[] = 'Pick a specific, useful angle within the topic so each run produces something new.';
        return implode("\n", $lines);
    }

    private function firstField(array $fields, string $kind): ?string
    {
        foreach ($fields as $col => $f) {
            if (($f['kind'] ?? null) === $kind && !in_array($f['source'] ?? '', ['ai_relation', 'fixed_relation'], true)) {
                return $col;
            }
        }
        return null;
    }

    /**
     * Where new content belongs: the customer's model compares the written content with the existing parents (ranked
     * by meaning with embeddings) and either picks one that clearly fits or names a new one (only when creating is
     * allowed). Returns null when no decision could be made (the suggestion from the writing call is used then).
     *
     * @return array{label: string, decision: string, reason: string}|null
     */
    private function decideParent(Automation $automation, string $col, array $rel, string $suggested, array $data, array $aiText, callable $log): ?array
    {
        $titleCol = $this->firstField($aiText, 'title');
        $summaryCol = $this->firstField($aiText, 'summary') ?? $this->firstField($aiText, 'meta_description');
        $bodyCol = $this->firstField($aiText, 'body');
        $content = [
            'title' => $titleCol ? (string) ($data[$titleCol] ?? '') : '',
            'summary' => $summaryCol ? (string) ($data[$summaryCol] ?? '') : ($bodyCol ? Str::limit(strip_tags((string) ($data[$bodyCol] ?? '')), 500) : ''),
            'topic' => (string) $automation->prompt_context,
            'suggestion' => $suggested,
        ];
        if (trim($content['title'] . $content['summary'] . $content['topic'] . $suggested) === '') {
            return null;
        }
        [$provider, $model, $apiKey] = $this->resolveTextProvider($automation);
        try {
            $res = $this->ai->chooseParent([
                'provider' => $provider,
                'model' => $model,
                'api_key' => $apiKey,
                'entity' => $rel['entity'],
                'content' => $content,
                'candidates' => array_values($rel['options']),
                'allow_new' => (bool) $rel['allow_create'],
                'budget_seconds' => 150,
            ]);
        } catch (\Throwable $e) {
            $log('PARENT_DECISION_FAILED', "Could not decide the {$rel['entity']} for `{$col}` separately (" . Str::limit($e->getMessage(), 120) . '); using the writer\'s suggestion.');
            return null;
        }
        $label = trim((string) ($res['label'] ?? ''));
        if ($label === '' || !in_array($res['decision'] ?? null, ['existing', 'new'], true)) {
            return null;
        }
        $existing = $this->matchOption($label, $rel['options']);
        if ($res['decision'] === 'new' && $existing === null && !$rel['allow_create']) {
            return null;
        }
        $decision = $existing !== null ? 'reuse' : 'create';
        $reason = trim((string) ($res['reason'] ?? ''));
        $log('PARENT_DECIDED', ($decision === 'reuse' ? "Uses the existing {$rel['entity']} '{$existing}'" : "No existing {$rel['entity']} fits; creates '{$label}'") . ($reason !== '' ? ": {$reason}" : '.'), [
            'column' => $col,
            'decision' => $decision,
            'source' => $res['source'] ?? null,
            'closest' => array_slice((array) ($res['ranked'] ?? []), 0, 3),
        ]);
        return ['label' => $existing ?? Str::limit($label, 80, ''), 'decision' => $decision, 'reason' => $reason];
    }

    /**
     * The new media-table row for a generated image. When the customer's model has not read the media table yet, it
     * reads it now (in background runs) so the image's address and details go to the right columns.
     */
    private function mediaRow(Automation $automation, DbConnection $connection, array $media, array $imageMeta, string $title, bool $wait, callable $log): array
    {
        $builder = app(\App\Services\Data\MediaRowBuilder::class);
        if (!$builder->ready($connection, $media['table'])) {
            if (!$wait) {
                throw new Exception("your AI model is still reading `{$media['table']}`, so it is not known yet where the image goes. It is included once that is done");
            }
            $log('MEDIA_TABLE_READING', "Reading `{$media['table']}` with your AI model to know where the image goes.");
            $insights = app(\App\Services\Data\TableInsightService::class);
            $meta = app(\App\Services\Data\LiveSchemaService::class)->getCatalog($connection)['tables'][$media['table']] ?? [];
            $insights->ensure($connection, $media['table'], $meta, true, false);
            for ($i = 0; $i < 4 && $insights->analyze($connection, $media['table']); $i++) {
            }
        }
        $asset = \App\Models\MediaAsset::where('user_id', $automation->user_id)->findOrFail($imageMeta['asset_id']);
        return $builder->forAsset($connection, $media['table'], $asset, $title);
    }

    /** Small models often open the body with "# <title>"; the title already has its own column. */
    private function dropRepeatedTitleHeading(string $body, array $data, array $aiFields): string
    {
        $titleCol = $this->firstField($aiFields, 'title');
        $title = $titleCol ? trim((string) ($data[$titleCol] ?? '')) : '';
        if ($title === '' || !preg_match('/^\s*#{1,2}\s+(.+?)\s*(\R|$)/u', $body, $m)) {
            return $body;
        }
        similar_text(mb_strtolower($m[1]), mb_strtolower($title), $pct);
        return $pct >= 80 ? ltrim(mb_substr($body, mb_strlen($m[0]))) : $body;
    }

    private function matchOption(string $label, array $options): ?string
    {
        $slug = Str::slug($label);
        foreach ($options as $opt) {
            if (strcasecmp(trim($opt), $label) === 0 || ($slug !== '' && Str::slug($opt) === $slug)) {
                return $opt;
            }
        }
        return null;
    }

    private function closestOption(string $label, array $options): ?string
    {
        $best = null;
        $bestScore = -1.0;
        foreach ($options as $opt) {
            similar_text(strtolower($label), strtolower($opt), $pct);
            if ($pct > $bestScore) {
                $bestScore = $pct;
                $best = $opt;
            }
        }
        return $best;
    }
}
