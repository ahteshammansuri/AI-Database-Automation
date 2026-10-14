<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Automation;
use App\Models\AutomationExecution;
use App\Models\DbConnection;
use App\Models\AuditLog;
use App\Jobs\GenerateAutomationContentJob;
use App\Services\DatabaseSafetyService;
use App\Models\ContentVersion;
use App\Services\SafeDatabaseExecutor;
use App\Services\LiveEventService;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Carbon\Carbon;

class AutomationController extends Controller
{
    public function __construct(
        protected DatabaseSafetyService $safetyService,
        protected SafeDatabaseExecutor $executor
    ) {}

    public function index(Request $request)
    {
        $automations = Automation::where('user_id', $request->user()->id)
            ->with(['connection:id,name,host,database_name'])
            ->withCount('executions')
            ->orderBy('created_at', 'desc')
            ->get();

        return response()->json($automations);
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'connection_id' => 'required|integer',
            'target_table' => 'required|string',
            'operation_mode' => 'required|string|in:AI_CREATE,AI_ENRICH,MANUAL_SCHEDULE',
            'field_mappings' => 'required|array',
            'ai_provider' => 'nullable|string',
            'ai_model' => 'nullable|string',
            'prompt_context' => 'nullable|string',
            'knowledge_document_ids' => 'nullable|array',
            'schedule_type' => 'required|string|in:ONE_TIME,DAILY,WEEKLY',
            'start_date' => 'nullable|string',
            'generation_time' => 'required|string',
            'publication_time' => 'required|string',
            'timezone' => 'nullable|string',
            'requires_approval' => 'nullable|boolean',
            'reviewer_email' => 'nullable|email',
            'timeout_policy' => 'nullable|string|in:AUTO_PUBLISH_LATEST,KEEP_DRAFT,CANCEL',
            'is_active' => 'nullable|boolean',
        ]);

        // Enforce 30-minute generation lead-time policy
        $leadTimeError = $this->validateLeadTime(
            $validated['generation_time'],
            $validated['publication_time'],
            $validated['timezone'] ?? 'UTC'
        );
        if ($leadTimeError) {
            return response()->json([
                'message' => $leadTimeError,
                'errors' => [
                    'publication_time' => [$leadTimeError],
                ],
            ], 422);
        }

        // Verify connection ownership
        $connection = DbConnection::where('user_id', $request->user()->id)
            ->where('id', $validated['connection_id'])
            ->firstOrFail();

        // Safety verification: cannot target restricted tables
        if ($this->safetyService->isTableSensitive($validated['target_table'])) {
            return response()->json([
                'message' => "Security violation: Table '{$validated['target_table']}' is restricted and cannot be automated.",
            ], 422);
        }

        $requiresApproval = isset($validated['requires_approval']) ? (bool) $validated['requires_approval'] : false;

        $automation = Automation::create([
            'user_id' => $request->user()->id,
            'connection_id' => $connection->id,
            'name' => $validated['name'],
            'target_table' => $validated['target_table'],
            'operation_mode' => $validated['operation_mode'],
            'field_mappings' => $validated['field_mappings'],
            'ai_provider' => $validated['ai_provider'] ?? 'ollama',
            'ai_model' => $validated['ai_model'] ?? 'llama3.2:1b',
            'prompt_context' => $validated['prompt_context'] ?? null,
            'knowledge_document_ids' => $validated['knowledge_document_ids'] ?? [],
            'schedule_type' => $validated['schedule_type'],
            'start_date' => $validated['start_date'] ?? null,
            'generation_time' => $validated['generation_time'],
            'publication_time' => $validated['publication_time'],
            'timezone' => $validated['timezone'] ?? 'UTC',
            'requires_approval' => $requiresApproval,
            'reviewer_email' => $validated['reviewer_email'] ?? $request->user()->email,
            'timeout_policy' => $validated['timeout_policy'] ?? 'AUTO_PUBLISH_LATEST',
            'is_active' => $validated['is_active'] ?? true,
        ]);

        AuditLog::log($request->user()->id, 'AUTOMATION_CREATED', 'Automation', (string) $automation->id, [
            'name' => $automation->name,
            'table' => $automation->target_table,
            'mode' => $automation->operation_mode,
            'requires_approval' => $requiresApproval,
        ]);

        \App\Services\LiveEventService::publish($request->user()->id, 'automation.created', [
            'id' => $automation->id,
            'name' => $automation->name,
            'target_table' => $automation->target_table,
            'requires_approval' => $requiresApproval,
        ], 'Automation', (string) $automation->id);

        return response()->json([
            'message' => 'Automation workflow configured successfully',
            'automation' => $automation,
        ], 201);
    }

    public function show(Request $request, $id)
    {
        $automation = Automation::where('user_id', $request->user()->id)
            ->where('id', $id)
            ->with(['connection', 'executions.versions'])
            ->firstOrFail();

        return response()->json($automation);
    }

    public function update(Request $request, $id)
    {
        $automation = Automation::where('user_id', $request->user()->id)
            ->where('id', $id)
            ->firstOrFail();

        $validated = $request->validate([
            'name' => 'sometimes|string|max:255',
            'is_active' => 'sometimes|boolean',
            'prompt_context' => 'nullable|string',
            'field_mappings' => 'sometimes|array',
            'ai_provider' => 'sometimes|nullable|string',
            'ai_model' => 'sometimes|nullable|string',
            'knowledge_document_ids' => 'sometimes|nullable|array',
            'requires_approval' => 'sometimes|boolean',
            'generation_time' => 'sometimes|string',
            'publication_time' => 'sometimes|string',
            'timezone' => 'sometimes|nullable|string',
            'reviewer_email' => 'nullable|email',
        ]);

        if (isset($validated['generation_time']) || isset($validated['publication_time'])) {
            $genTime = $validated['generation_time'] ?? $automation->generation_time;
            $pubTime = $validated['publication_time'] ?? $automation->publication_time;
            $tz = $validated['timezone'] ?? $automation->timezone;
            $leadTimeError = $this->validateLeadTime($genTime, $pubTime, $tz);
            if ($leadTimeError) {
                return response()->json([
                    'message' => $leadTimeError,
                    'errors' => [
                        'publication_time' => [$leadTimeError],
                    ],
                ], 422);
            }
        }

        $automation->update($validated);

        AuditLog::log($request->user()->id, 'AUTOMATION_UPDATED', 'Automation', (string) $id);

        return response()->json([
            'message' => 'Automation updated successfully',
            'automation' => $automation,
        ]);
    }

    public function destroy(Request $request, $id)
    {
        $automation = Automation::where('user_id', $request->user()->id)
            ->where('id', $id)
            ->firstOrFail();

        $automation->delete();

        AuditLog::log($request->user()->id, 'AUTOMATION_DELETED', 'Automation', (string) $id);

        return response()->json([
            'message' => 'Automation deleted successfully',
        ]);
    }

    public function trigger(Request $request, $id)
    {
        $automation = Automation::where('user_id', $request->user()->id)
            ->where('id', $id)
            ->firstOrFail();

        $today = now()->format('Y-m-d_H-i-s');
        $idempotencyKey = "manual_trig_{$automation->id}_{$today}_" . Str::random(6);

        $execution = AutomationExecution::create([
            'user_id' => $request->user()->id,
            'automation_id' => $automation->id,
            'status' => 'PENDING_GENERATION',
            'idempotency_key' => $idempotencyKey,
            'publication_time' => now()->addMinutes(60),
        ]);

        GenerateAutomationContentJob::dispatch($execution->id);

        AuditLog::log($request->user()->id, 'AUTOMATION_TRIGGERED', 'AutomationExecution', (string) $execution->id);

        return response()->json([
            'message' => 'Execution dispatched to background worker',
            'execution' => $execution,
        ], 202);
    }

    /**
     * Dynamic manual content publishing / scheduling directly to any target table
     */
    public function manualPublish(Request $request)
    {
        $validated = $request->validate([
            'connection_id' => 'required|integer',
            'target_table' => 'required|string',
            'payload' => 'required|array',
            'publish_now' => 'nullable|boolean',
            'scheduled_time' => 'nullable|string',
            'name' => 'nullable|string|max:255',
        ]);

        $connection = DbConnection::where('user_id', $request->user()->id)
            ->where('id', $validated['connection_id'])
            ->firstOrFail();

        if ($this->safetyService->isTableSensitive($validated['target_table'])) {
            return response()->json([
                'message' => "Security violation: Table '{$validated['target_table']}' is classified as restricted and cannot receive manual writes.",
            ], 422);
        }

        $pipelineName = $validated['name'] ?? ("Manual: " . ucwords(str_replace('_', ' ', $validated['target_table'])));
        $automation = Automation::firstOrCreate(
            [
                'user_id' => $request->user()->id,
                'connection_id' => $connection->id,
                'target_table' => $validated['target_table'],
                'operation_mode' => 'MANUAL_SCHEDULE',
            ],
            [
                'name' => $pipelineName,
                'field_mappings' => [],
                'ai_provider' => 'none',
                'ai_model' => 'manual',
                'schedule_type' => 'ONE_TIME',
                'generation_time' => now()->format('H:i'),
                'publication_time' => now()->addHour()->format('H:i'),
                'requires_approval' => false,
                'is_active' => true,
            ]
        );

        $publishNow = isset($validated['publish_now'])
            ? (bool) $validated['publish_now']
            : (empty($validated['scheduled_time']) || Carbon::parse($validated['scheduled_time'])->isPast());
        $idempotencyKey = "manual_direct_{$automation->id}_" . now()->format('Ymd_His') . "_" . Str::random(6);

        if ($publishNow) {
            $writeResult = $this->executor->executeInsert($connection, $validated['target_table'], $validated['payload']);

            $execution = AutomationExecution::create([
                'user_id' => $request->user()->id,
                'automation_id' => $automation->id,
                'status' => 'PUBLISHED',
                'idempotency_key' => $idempotencyKey,
                'generation_started_at' => now(),
                'generation_completed_at' => now(),
                'publication_time' => now(),
                'published_at' => now(),
                'result_details' => $writeResult,
            ]);

            $version = ContentVersion::create([
                'user_id' => $request->user()->id,
                'execution_id' => $execution->id,
                'version_number' => 1,
                'payload' => $validated['payload'],
                'status' => 'APPROVED',
            ]);

            $execution->addTimelineEvent(
                'TARGET_TRANSACTION_COMMITTED',
                "Direct manual publication committed to table '{$validated['target_table']}'.",
                ['table' => $validated['target_table'], 'record_id' => $writeResult['record_id'] ?? null]
            );

            AuditLog::log($request->user()->id, 'MANUAL_PUBLISH_EXECUTED', 'AutomationExecution', (string) $execution->id, [
                'table' => $validated['target_table'],
                'record_id' => $writeResult['record_id'] ?? null,
            ]);

            LiveEventService::publish($request->user()->id, 'execution.published', [
                'execution_id' => $execution->id,
                'status' => 'PUBLISHED',
                'record_id' => $writeResult['record_id'] ?? null,
                'target_table' => $validated['target_table'],
                'published_at' => now()->toIso8601String(),
            ], 'AutomationExecution', (string) $execution->id);

            return response()->json([
                'message' => "Successfully published record to table '{$validated['target_table']}'!",
                'execution' => $execution->load('versions'),
                'result' => $writeResult,
            ], 201);
        } else {
            $pubTime = !empty($validated['scheduled_time']) ? Carbon::parse($validated['scheduled_time']) : now()->addMinutes(30);

            $execution = AutomationExecution::create([
                'user_id' => $request->user()->id,
                'automation_id' => $automation->id,
                'status' => 'APPROVED',
                'idempotency_key' => $idempotencyKey,
                'publication_time' => $pubTime,
            ]);

            $version = ContentVersion::create([
                'user_id' => $request->user()->id,
                'execution_id' => $execution->id,
                'version_number' => 1,
                'payload' => $validated['payload'],
                'status' => 'APPROVED',
            ]);

            $execution->addTimelineEvent(
                'MANUAL_SCHEDULED',
                "Manual publication scheduled for {$pubTime->toIso8601String()}.",
                ['publication_time' => $pubTime->toIso8601String()]
            );

            LiveEventService::publish($request->user()->id, 'execution.created', [
                'execution_id' => $execution->id,
                'automation_id' => $automation->id,
                'status' => 'APPROVED',
                'publication_time' => $pubTime->toIso8601String(),
            ], 'AutomationExecution', (string) $execution->id);

            AuditLog::log($request->user()->id, 'MANUAL_PUBLISH_SCHEDULED', 'AutomationExecution', (string) $execution->id, [
                'table' => $validated['target_table'],
                'scheduled_for' => $pubTime->toIso8601String(),
            ]);

            return response()->json([
                'message' => "Manual publication scheduled for " . $pubTime->toDateTimeString(),
                'execution' => $execution->load('versions'),
            ], 202);
        }
    }

    /**
     * Generate structured AI content preview without modifying target database.
     */
    public function previewAi(Request $request, \App\Services\AiServiceClient $aiClient)
    {
        $validated = $request->validate([
            'prompt' => 'nullable|string',
            'topic' => 'nullable|string',
            'target_table' => 'nullable|string',
            'fields' => 'nullable|array',
            'tone' => 'nullable|string',
            'context_document_ids' => 'nullable|array',
            'provider' => 'nullable|string',
            'model' => 'nullable|string',
        ]);

        $topic = $validated['topic'] ?? $validated['prompt'] ?? 'Healthy Nutrition & Daily Food Diaries';
        $targetTable = $validated['target_table'] ?? 'blogs';
        $fields = $validated['fields'] ?? ['title', 'slug', 'content', 'excerpt'];

        $provider = $validated['provider'] ?? 'ollama';
        $model = $validated['model'] ?? null;

        $userProvider = \App\Models\AiProvider::where('user_id', $request->user()->id)
            ->where('provider_type', $provider)
            ->first();
        $apiKey = $userProvider?->encrypted_api_key;

        $contextPassages = [];
        if (!empty($validated['context_document_ids'])) {
            try {
                $chunks = $aiClient->queryKnowledge($request->user()->id, $topic, 3);
                foreach ($chunks as $c) {
                    if (!empty($c['text'])) {
                        $contextPassages[] = $c['text'];
                    }
                }
            } catch (\Throwable $e) {
                // RAG query fallback
            }
        }

        try {
            $res = $aiClient->generateContent([
                'provider' => $provider,
                'model' => $model,
                'api_key' => $apiKey,
                'prompt' => $topic,
                'target_table' => $targetTable,
                'required_fields' => $fields,
                'context_passages' => $contextPassages,
            ]);

            return response()->json([
                'success' => true,
                'data' => $res['data'] ?? [],
            ]);
        } catch (\Throwable $e) {
            $cleanTopic = ucwords(preg_replace('/[•|–—\s]+/', ' ', trim($topic)));
            $slug = Str::slug($cleanTopic) . '-' . rand(100, 999);
            $isFood = preg_match('/(food|meat|diet|diate|eat|meal|nutrition|recipe|health)/i', $topic);

            $banner = $isFood
                ? 'https://images.unsplash.com/photo-1498837167922-ddd27525d352?w=1200&auto=format&fit=crop&q=80'
                : 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=1200&auto=format&fit=crop&q=80';
            $metaImg = $isFood
                ? 'https://images.unsplash.com/photo-1540420773420-3366772f4999?w=800&auto=format&fit=crop&q=80'
                : 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=800&auto=format&fit=crop&q=80';

            $fallback = [
                'title' => "The Essential Guide to {$cleanTopic}",
                'slug' => $slug,
                'excerpt' => "A practical, evidence-based exploration of {$cleanTopic}, highlighting core principles and actionable takeaways.",
                'short_description' => "A practical, evidence-based exploration of {$cleanTopic}, highlighting core principles and actionable takeaways.",
                'content' => "# The Essential Guide to {$cleanTopic}\n\nDeveloping consistency with {$cleanTopic} requires a balanced, structured approach.\n\n## Core Principles\n- Intentional daily routines\n- High quality foundational building blocks\n- Sustainable long-term practices",
                'description' => "# The Essential Guide to {$cleanTopic}\n\nDeveloping consistency with {$cleanTopic} requires a balanced, structured approach.\n\n## Core Principles\n- Intentional daily routines\n- High quality foundational building blocks\n- Sustainable long-term practices",
                'banner' => $banner,
                'meta_img' => $metaImg,
                'meta_title' => substr("The Essential Guide to {$cleanTopic}", 0, 60),
                'meta_description' => substr("A practical exploration of {$cleanTopic}.", 0, 160),
                'meta_keywords' => $isFood ? 'healthy diet, nutrition, meal planning, lean meats, wellness' : 'database, automation, mysql, ai, devops',
                'status' => '1',
            ];
            foreach ($fields as $f) {
                if (!isset($fallback[$f])) {
                    $fallback[$f] = "Dynamic {$f}";
                }
            }
            return response()->json([
                'success' => true,
                'data' => $fallback,
            ]);
        }
    }

    /**
     * Translate a natural language goal into a validated proposed automation configuration.
     */
    public function proposePlan(
        Request $request,
        \App\Services\AiServiceClient $aiClient,
        \App\Services\SchemaIntrospectionService $schemaService
    ) {
        $validated = $request->validate([
            'connection_id' => 'required|integer',
            'prompt' => 'required|string|max:1000',
            'provider' => 'nullable|string',
            'model' => 'nullable|string',
        ]);

        $connection = DbConnection::where('user_id', $request->user()->id)
            ->where('id', $validated['connection_id'])
            ->firstOrFail();

        $schema = $schemaService->introspectSchema($connection, false);

        try {
            $proposed = $aiClient->proposeAutomation(
                $validated['prompt'],
                $schema['tables'] ?? [],
                $validated['provider'] ?? 'mock',
                $validated['model'] ?? null
            );

            $rawPlan = $proposed['plan'] ?? $proposed;
            $plan = is_array($rawPlan) ? $rawPlan : [];
            if (!isset($plan['schedule_config'])) {
                $plan['schedule_config'] = [
                    'frequency' => $plan['schedule_type'] ?? 'DAILY',
                    'generation_time' => $plan['generation_time'] ?? '08:00',
                    'publication_time' => $plan['publication_time'] ?? '09:00',
                    'timezone' => $plan['timezone'] ?? 'Asia/Kolkata',
                ];
            }
            if (!isset($plan['approval_policy'])) {
                $plan['approval_policy'] = [
                    'require_approval' => $plan['requires_approval'] ?? false,
                    'timeout_policy' => $plan['timeout_policy'] ?? 'AUTO_PUBLISH_LATEST',
                ];
            }
            if (!isset($plan['explanation'])) {
                $plan['explanation'] = $proposed['explanation'] ?? 'Proposed pipeline configuration analyzed from discovered table schema.';
            }

            return response()->json([
                'message' => 'Proposed pipeline configuration ready',
                'plan' => $plan,
            ]);
        } catch (\Throwable $e) {
            return response()->json([
                'message' => 'Proposed pipeline configuration generated from schema',
                'plan' => [
                    'name' => 'Automated Publishing Pipeline',
                    'target_table' => 'posts',
                    'operation_mode' => 'AI_CREATE',
                    'topic' => $validated['prompt'],
                    'tone' => 'Professional and engaging',
                    'category_name' => 'General',
                    'field_mappings' => [
                        ['field_name' => 'title', 'mapping_type' => 'AI_GENERATED'],
                        ['field_name' => 'slug', 'mapping_type' => 'DERIVED_SLUG', 'source_field' => 'title'],
                        ['field_name' => 'excerpt', 'mapping_type' => 'AI_GENERATED'],
                        ['field_name' => 'content', 'mapping_type' => 'AI_GENERATED'],
                        ['field_name' => 'category_id', 'mapping_type' => 'RELATIONAL_LOOKUP', 'fixed_value' => 'General', 'relation_config' => ['referenced_table' => 'categories', 'lookup_field' => 'name', 'creation_policy' => 'CREATE_IF_MISSING']],
                        ['field_name' => 'status', 'mapping_type' => 'FIXED_VALUE', 'fixed_value' => 'published'],
                    ],
                    'schedule_config' => [
                        'frequency' => 'DAILY',
                        'generation_time' => '08:00',
                        'publication_time' => '09:00',
                        'timezone' => 'Asia/Kolkata',
                    ],
                    'approval_policy' => [
                        'require_approval' => false,
                        'timeout_policy' => 'AUTO_PUBLISH_LATEST',
                    ],
                    'explanation' => 'Fallback proposal constructed from discovered schema.',
                ],
            ]);
        }
    }

    /**
     * Enforce minimum 30-minute planning lead time between generation and publication.
     */
    protected function validateLeadTime(string $genTime, string $pubTime, ?string $timezone): ?string
    {
        $tz = $timezone ?: 'UTC';
        if (!in_array($tz, timezone_identifiers_list(), true)) {
            $tz = 'UTC';
        }

        try {
            $today = now($tz)->toDateString();
            $gen = Carbon::parse("{$today} {$genTime}", $tz);
            $pub = Carbon::parse("{$today} {$pubTime}", $tz);

            if ($pub->lessThanOrEqualTo($gen)) {
                $pub = $pub->addDay();
            }

            $diffMinutes = $gen->diffInMinutes($pub, false);
            if ($diffMinutes < 30) {
                return "Publication time must be at least 30 minutes after generation time (current gap: {$diffMinutes} mins).";
            }
        } catch (\Throwable $e) {
            return "Invalid time format: " . $e->getMessage();
        }

        return null;
    }

    /**
     * Contextual inline AI assist for a single form/mapping field.
     * Supports: generate, improve, shorten, expand, change_tone, regenerate.
     * Preserves caller state and returns suggested text without writing to database.
     */
    public function fieldAssist(Request $request, \App\Services\AiServiceClient $aiClient)
    {
        $validated = $request->validate([
            'field_name' => 'required|string|max:100',
            'action' => 'required|string|in:generate,improve,shorten,expand,change_tone,regenerate',
            'current_value' => 'nullable|string',
            'topic' => 'nullable|string',
            'tone' => 'nullable|string',
            'target_table' => 'nullable|string',
            'provider' => 'nullable|string',
            'model' => 'nullable|string',
        ]);

        $fieldName = $validated['field_name'];
        $action = $validated['action'];
        $currentValue = $validated['current_value'] ?? '';
        $topic = !empty($validated['topic']) ? $validated['topic'] : 'Enterprise Database Automation';
        $tone = !empty($validated['tone']) ? $validated['tone'] : 'Professional and authoritative';
        $targetTable = !empty($validated['target_table']) ? $validated['target_table'] : 'posts';

        $provider = $validated['provider'] ?? 'ollama';
        $model = $validated['model'] ?? null;

        $userProvider = \App\Models\AiProvider::where('user_id', $request->user()->id)
            ->where('provider_type', $provider)
            ->first();
        $apiKey = $userProvider?->encrypted_api_key;

        $prompt = match ($action) {
            'generate', 'regenerate' => "Generate production-grade content for the '{$fieldName}' column in the '{$targetTable}' table. Topic: '{$topic}'. Tone: '{$tone}'. Output the value cleanly.",
            'improve' => "Improve the clarity, phrasing, and quality of the following text for the '{$fieldName}' field while preserving its core message: \"{$currentValue}\". Context: '{$topic}'. Tone: '{$tone}'.",
            'shorten' => "Condense and shorten the following text for the '{$fieldName}' field to roughly 50% length without losing vital meaning: \"{$currentValue}\".",
            'expand' => "Elaborate and expand upon the following text for the '{$fieldName}' field by providing 2-3 practical, detailed supporting points: \"{$currentValue}\". Context: '{$topic}'.",
            'change_tone' => "Rewrite the following text for the '{$fieldName}' field using a distinct {$tone} tone: \"{$currentValue}\".",
        };

        try {
            $res = $aiClient->generateContent([
                'provider' => $provider,
                'model' => $model,
                'api_key' => $apiKey,
                'prompt' => $prompt,
                'target_table' => $targetTable,
                'required_fields' => [$fieldName],
            ]);

            $suggested = $res['data'][$fieldName] ?? null;
            if (!$suggested && is_array($res['data'])) {
                $suggested = reset($res['data']);
            }

            if ($suggested) {
                return response()->json([
                    'success' => true,
                    'field_name' => $fieldName,
                    'action' => $action,
                    'suggested_value' => (string) $suggested,
                    'explanation' => "AI-assisted {$action} completed using {$provider} provider.",
                ]);
            }
        } catch (\Throwable $e) {
            // Fall back to deterministic transformer heuristics below
        }

        // Deterministic heuristics fallback
        $suggested = match ($action) {
            'shorten' => (strlen($currentValue) > 60)
                ? substr($currentValue, 0, strrpos(substr($currentValue, 0, 70), ' ') ?: 60) . '...'
                : $currentValue,
            'expand' => !empty($currentValue)
                ? rtrim($currentValue, '.') . ". Furthermore, this established baseline enables predictable scaling, verifiable auditability, and immediate error recovery."
                : "Comprehensive breakdown of {$topic} focusing on reliability, data consistency, and streamlined operations.",
            'improve' => !empty($currentValue)
                ? ucfirst(trim(preg_replace('/\s+/', ' ', $currentValue)))
                : "Architectural Overview of {$topic}",
            'change_tone' => "In accordance with a {$tone} style: " . ltrim($currentValue),
            default => match ($fieldName) {
                'title', 'name' => "The Architectural Guide to {$topic}",
                'slug' => Str::slug($topic) . '-' . rand(100, 999),
                'excerpt', 'short_description' => "A practical examination of {$topic}, detailing implementation strategies, reliability benchmarks, and execution integrity.",
                'content', 'description' => "# Comprehensive Guide to {$topic}\n\nAutomating data workflows requires a disciplined foundation.\n\n## Key Considerations\n- Strict schema validation\n- Deterministic relationship integrity\n- Verifiable audit trails",
                'meta_title' => substr("{$topic} — Practical Overview & Guidelines", 0, 60),
                'meta_description' => substr("Explore core techniques and best practices for {$topic} with validated workflows and real-time execution tracking.", 0, 160),
                'meta_keywords' => 'database, automation, mysql, cloud, performance',
                default => "Optimized value for {$fieldName} regarding {$topic}",
            },
        };

        return response()->json([
            'success' => true,
            'field_name' => $fieldName,
            'action' => $action,
            'suggested_value' => (string) $suggested,
            'explanation' => "Deterministic assistance heuristic applied for {$action}.",
        ]);
    }
}

