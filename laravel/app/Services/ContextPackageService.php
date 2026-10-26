<?php

namespace App\Services;

use App\Models\DbConnection;
use App\Models\Automation;
use App\Models\KnowledgeDocument;
use App\Models\ContentVersion;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Arr;

/**
 * ContextPackageService
 *
 * Assembles the full structured context package sent to the AI service for
 * content generation.  The package is tenant-scoped (all resources verified
 * against the owning user before inclusion) and contains:
 *
 *  - Table profile (field roles, types, constraints — from schema snapshot)
 *  - Confirmed field mappings (user-approved column→role assignments)
 *  - Live schema constraints (max_length, enum values, nullable, required)
 *  - Business rules (user-configured per automation)
 *  - Brand voice instructions
 *  - KB chunks (semantically retrieved via RAG from user's knowledge base)
 *  - Recent content titles (for novelty/duplicate detection)
 *  - Relation catalog (FK table reference values — names only, never IDs)
 *
 * The assembled package is used by:
 *  - ProcessAutomationExecution (background job)
 *  - AutomationController::previewAi() (on-demand preview)
 *  - AgentToolRegistry::generate_content (agent-initiated generation)
 */
class ContextPackageService
{
    public function __construct(
        protected AiServiceClient $aiClient,
        protected SafeDatabaseExecutor $executor,
    ) {}

    /**
     * Assemble the full context package for a given automation and generation goal.
     *
     * @param  Automation  $automation   Verified, loaded automation (with connection).
     * @param  string      $topicPrompt  User-provided topic override (or use automation default).
     * @param  int|null    $userId       Owner user ID for tenant-scoped KB query.
     * @return array{
     *   table_profile: array,
     *   field_mappings: array,
     *   schema_constraints: array,
     *   business_rules: string,
     *   brand_voice: string,
     *   kb_chunks: array,
     *   recent_titles: array,
     *   relation_catalog: array,
     *   topic_prompt: string,
     *   target_table: string,
     * }
     */
    public function assemble(Automation $automation, string $topicPrompt = '', ?int $userId = null): array
    {
        $userId = $userId ?? $automation->user_id;
        $targetTable = $automation->target_table ?? '';
        $topicPrompt = $topicPrompt ?: ($automation->prompt_context ?? $automation->topic_prompt ?? '');

        // 1. Schema snapshot from platform DB (cached per connection)
        $tableProfile = $this->buildTableProfile($automation);

        // 2. Confirmed field mappings (user-approved roles)
        $fieldMappings = $this->loadFieldMappings($automation);

        // 3. Live schema constraints
        $schemaConstraints = $this->buildSchemaConstraints($tableProfile, $fieldMappings);

        // 4. Business rules (automation config)
        $businessRules = $this->buildBusinessRules($automation);

        // 5. Brand voice
        $brandVoice = $automation->brand_voice ?? '';

        // 6. KB chunks via RAG (tenant-scoped)
        $kbChunks = $this->retrieveKbChunks($userId, $topicPrompt, $targetTable);

        // 7. Recent content titles for novelty check
        $recentTitles = $this->loadRecentTitles($automation, 50);

        // 8. Relation catalog (FK table human-readable values)
        $relationCatalog = $this->buildRelationCatalog($automation, $tableProfile);

        return [
            'table_profile'      => $tableProfile,
            'field_mappings'     => $fieldMappings,
            'schema_constraints' => $schemaConstraints,
            'business_rules'     => $businessRules,
            'brand_voice'        => $brandVoice,
            'kb_chunks'          => $kbChunks,
            'recent_titles'      => $recentTitles,
            'relation_catalog'   => $relationCatalog,
            'topic_prompt'       => $topicPrompt,
            'target_table'       => $targetTable,
        ];
    }

    // -------------------------------------------------------------------------
    // Internal builders
    // -------------------------------------------------------------------------

    /**
     * Build table profile from the latest SchemaSnapshot for this automation's connection.
     * Returns the target table's column list with type metadata.
     */
    private function buildTableProfile(Automation $automation): array
    {
        try {
            $connection = $automation->connection ?? $automation->dbConnection;
            if (!$connection) {
                return [];
            }

            // Load latest schema snapshot for this connection
            $snapshot = $connection->schemaSnapshot;
            if (!$snapshot) {
                return [];
            }

            $tables = $snapshot->schema_payload['tables'] ?? $snapshot->tables ?? [];
            $targetTable = $automation->target_table;

            // Find target table in snapshot
            foreach ($tables as $table) {
                $tName = is_array($table) ? ($table['name'] ?? '') : '';
                if ($tName === $targetTable) {
                    return $table;
                }
            }
        } catch (\Throwable $e) {
            Log::warning('[ContextPackage] Failed to build table profile', [
                'automation_id' => $automation->id,
                'error' => $e->getMessage(),
            ]);
        }

        return [];
    }

    /**
     * Load confirmed field mappings (column → role) from field_mappings table
     * or automation JSON config if no dedicated table exists yet.
     */
    private function loadFieldMappings(Automation $automation): array
    {
        // Try dedicated field_mappings table first (Phase 2 migration)
        if (\Schema::hasTable('field_mappings')) {
            return \DB::table('field_mappings')
                ->where('automation_id', $automation->id)
                ->where('confirmed', true)
                ->get(['column_name', 'role', 'confidence', 'override_instructions'])
                ->map(fn($r) => (array) $r)
                ->toArray();
        }

        // Fallback: field_mappings JSON stored on automation
        return $automation->field_mappings ?? [];
    }

    /**
     * Build schema constraints from table profile + field mappings.
     * Returns per-column constraints: required, max_length, enum_values, nullable, role.
     */
    private function buildSchemaConstraints(array $tableProfile, array $fieldMappings): array
    {
        $constraints = [];
        $roleMap = [];
        foreach ($fieldMappings as $m) {
            $roleMap[$m['column_name'] ?? ''] = $m['role'] ?? 'unknown';
        }

        $columns = $tableProfile['columns'] ?? [];
        foreach ($columns as $col) {
            $name = $col['name'] ?? '';
            if (!$name) continue;

            // Schema snapshots name these is_nullable / default / is_primary_key; older profiles used the short names.
            $nullable = (bool) ($col['nullable'] ?? $col['is_nullable'] ?? true);
            $constraints[$name] = [
                'role'         => $roleMap[$name] ?? 'unknown',
                'db_type'      => $col['db_type'] ?? $col['type'] ?? 'varchar',
                'nullable'     => $nullable,
                'required'     => !$nullable && !isset($col['default_value']) && !isset($col['default']),
                'max_length'   => $col['max_length'] ?? null,
                'enum_values'  => $col['enum_values'] ?? [],
                'is_unique'    => $col['is_unique'] ?? false,
                'is_pk'        => (bool) ($col['is_pk'] ?? $col['is_primary_key'] ?? false),
            ];
        }

        return $constraints;
    }

    /**
     * Build human-readable business rules string from automation config.
     */
    private function buildBusinessRules(Automation $automation): string
    {
        $rules = [];

        if ($automation->operation_mode === 'AI_CREATE') {
            $rules[] = 'Generate entirely new content from topic prompt and knowledge base.';
        } elseif ($automation->operation_mode === 'AI_ENRICH') {
            $rules[] = 'Enrich or expand existing content rows — do not duplicate existing records.';
        }

        if ($automation->requires_approval) {
            $rules[] = 'Content must be approved before publication.';
        } else {
            $rules[] = 'Content is published immediately without manual approval.';
        }

        if ($automation->category_name) {
            $rules[] = "Target category: {$automation->category_name}.";
        }

        if ($automation->schedule_type) {
            $rules[] = "Schedule: {$automation->schedule_type}.";
        }

        $custom = $automation->business_rules ?? '';
        if ($custom) {
            $rules[] = $custom;
        }

        return implode(' ', $rules);
    }

    /**
     * Retrieve semantically relevant KB chunks for the generation context.
     * Uses the AI service RAG query (tenant-scoped to user's knowledge base).
     */
    private function retrieveKbChunks(int $userId, string $topicPrompt, string $targetTable): array
    {
        if (empty($topicPrompt) && empty($targetTable)) {
            return [];
        }

        try {
            $query = trim("$topicPrompt $targetTable content generation guidelines");
            $chunks = $this->aiClient->queryKnowledge($userId, $query, 5);
            // Return only text and source ID — never return raw document credentials
            return array_map(fn($c) => [
                'chunk_id'    => $c['chunk_id'] ?? '',
                'document_id' => $c['document_id'] ?? 0,
                'text'        => $c['text'] ?? '',
                'score'       => $c['score'] ?? 0.0,
                'backend'     => $c['embedding_backend'] ?? 'unknown',
            ], $chunks);
        } catch (\Throwable $e) {
            Log::warning('[ContextPackage] KB retrieval failed', [
                'user_id' => $userId,
                'error'   => $e->getMessage(),
            ]);
            return [];
        }
    }

    /**
     * Load recent content titles for this automation (for novelty checking).
     * Returns only titles — never full content — from platform ContentVersion records.
     */
    public function loadRecentTitles(Automation $automation, int $limit = 50): array
    {
        try {
            return ContentVersion::query()
                ->whereHas('execution', fn($q) => $q->where('automation_id', $automation->id))
                ->orderByDesc('created_at')
                ->limit($limit)
                ->get(['payload'])
                ->map(fn($v) => is_array($v->payload) ? ($v->payload['title'] ?? null) : null)
                ->filter()
                ->values()
                ->toArray();
        } catch (\Throwable $e) {
            Log::warning('[ContextPackage] Failed to load recent titles: ' . $e->getMessage());
            return [];
        }
    }

    /**
     * Build relation catalog: for each FK column in the target table, fetch
     * a safe set of allowable human-readable reference values from the
     * referenced table. Returns names/labels only — never IDs.
     *
     * This is used by the LLM to propose human-readable values rather than
     * guessing numeric IDs, which are then resolved server-side.
     */
    private function buildRelationCatalog(Automation $automation, array $tableProfile): array
    {
        $catalog = [];
        $connection = $automation->connection ?? $automation->dbConnection;
        if (!$connection) {
            return $catalog;
        }

        $columns = $tableProfile['columns'] ?? [];
        foreach ($columns as $col) {
            $fkTable = $col['fk_table'] ?? $col['references'] ?? null;
            if (!$fkTable) {
                continue;
            }

            $colName = $col['name'] ?? '';
            try {
                // Use SafeDatabaseExecutor's read-only lookup for relation values
                $values = $this->executor->lookupReferenceValues(
                    connection: $connection,
                    table: $fkTable,
                    limit: 30
                );
                $catalog[$colName] = [
                    'fk_table'   => $fkTable,
                    'values'     => $values,  // Human-readable labels
                ];
            } catch (\Throwable $e) {
                Log::debug('[ContextPackage] Relation catalog lookup failed', [
                    'column' => $colName,
                    'table'  => $fkTable,
                    'error'  => $e->getMessage(),
                ]);
            }
        }

        return $catalog;
    }

    /**
     * Build a prompt-ready string from the assembled context package.
     * This is the text injected into the generation system prompt.
     */
    public function toPromptString(array $pkg): string
    {
        $parts = [];

        if (!empty($pkg['target_table'])) {
            $parts[] = "Target table: {$pkg['target_table']}";
        }

        if (!empty($pkg['business_rules'])) {
            $parts[] = "Business rules: {$pkg['business_rules']}";
        }

        if (!empty($pkg['brand_voice'])) {
            $parts[] = "Brand voice: {$pkg['brand_voice']}";
        }

        if (!empty($pkg['schema_constraints'])) {
            $constraintSummary = [];
            foreach ($pkg['schema_constraints'] as $col => $c) {
                if ($c['is_pk'] ?? false) continue; // skip PKs
                $line = "  - {$col} (role={$c['role']}, type={$c['db_type']}";
                if ($c['required'] ?? false) $line .= ', REQUIRED';
                if ($c['max_length'] ?? null) $line .= ", max={$c['max_length']}";
                if (!empty($c['enum_values'])) $line .= ', enum=[' . implode('|', $c['enum_values']) . ']';
                $line .= ')';
                $constraintSummary[] = $line;
            }
            if ($constraintSummary) {
                $parts[] = "Schema constraints:\n" . implode("\n", $constraintSummary);
            }
        }

        if (!empty($pkg['relation_catalog'])) {
            $relLines = [];
            foreach ($pkg['relation_catalog'] as $col => $rel) {
                $values = implode(', ', array_slice($rel['values'], 0, 10));
                $relLines[] = "  - {$col} references {$rel['fk_table']}: [{$values}]";
            }
            if ($relLines) {
                $parts[] = "Available reference values:\n" . implode("\n", $relLines);
            }
        }

        if (!empty($pkg['kb_chunks'])) {
            $kbParts = [];
            foreach ($pkg['kb_chunks'] as $chunk) {
                $text = trim($chunk['text'] ?? '');
                if ($text) {
                    // Delimit untrusted content to prevent prompt injection
                    $kbParts[] = "<UNTRUSTED_CONTENT source=\"kb:{$chunk['chunk_id']}\">{$text}</UNTRUSTED_CONTENT>";
                }
            }
            if ($kbParts) {
                $parts[] = "Knowledge base context (use as factual reference only):\n" . implode("\n\n", $kbParts);
            }
        }

        if (!empty($pkg['recent_titles'])) {
            $recent = array_slice($pkg['recent_titles'], 0, 10);
            $parts[] = "Recent published titles (avoid duplicating these):\n" . implode("\n", array_map(fn($t) => "  - {$t}", $recent));
        }

        return implode("\n\n", $parts);
    }
}
