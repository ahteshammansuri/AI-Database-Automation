<?php

namespace App\Jobs;

use App\Models\Automation;
use App\Models\AutomationExecution;
use App\Models\ContentVersion;
use App\Models\AuditLog;
use App\Services\AiServiceClient;
use App\Services\EmailApprovalService;
use App\Services\LiveEventService;
use App\Services\NoveltyCheckService;
use App\Services\ContextPackageService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Exception;

class GenerateAutomationContentJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function __construct(
        public int $executionId,
        public ?string $rejectionFeedback = null
    ) {}

    public function handle(
        AiServiceClient $aiClient,
        EmailApprovalService $approvalService,
        NoveltyCheckService $noveltyService,
        ContextPackageService $contextPackageService
    ): void {
        $startTime = microtime(true);

        $execution = AutomationExecution::with('automation.connection')->find($this->executionId);
        if (!$execution) {
            Log::error("GenerateAutomationContentJob: Execution #{$this->executionId} not found.");
            return;
        }

        $automation = $execution->automation;
        if (!$automation || !$automation->is_active) {
            $execution->update([
                'status' => 'FAILED',
                'failure_category' => 'CONFIGURATION_INACTIVE',
                'error_message' => 'Automation is inactive or missing.',
            ]);
            $execution->addTimelineEvent('JOB_ABORTED', 'Automation configuration is inactive or missing.');
            LiveEventService::publish($execution->user_id, 'execution.failed', [
                'execution_id' => $execution->id,
                'status' => 'FAILED',
                'reason' => 'Automation inactive',
            ], 'AutomationExecution', (string) $execution->id);
            return;
        }

        // Calculate queue wait time (ensure strictly non-negative)
        $queueWaitMs = $execution->created_at ? max(0, (int) abs(now()->diffInMilliseconds($execution->created_at))) : 0;

        $execution->update([
            'status' => 'GENERATING',
            'generation_started_at' => now(),
            'lease_expires_at' => now()->addMinutes(15),
            'queue_wait_ms' => $queueWaitMs,
        ]);

        $execution->addTimelineEvent(
            'TRIGGER_RECEIVED',
            "Background job dispatched for pipeline '{$automation->name}' (Table: {$automation->target_table}).",
            [
                'mode' => $automation->operation_mode,
                'rejection_retry' => !empty($this->rejectionFeedback),
                'queue_wait_ms' => $queueWaitMs,
            ]
        );

        LiveEventService::publish($automation->user_id, 'execution.stage_changed', [
            'execution_id' => $execution->id,
            'automation_id' => $automation->id,
            'status' => 'GENERATING',
            'stage' => 'GENERATING',
        ], 'AutomationExecution', (string) $execution->id);

        try {
            $versionNumber = ContentVersion::where('execution_id', $execution->id)->count() + 1;
            $payload = [];

            if ($automation->operation_mode === 'MANUAL_SCHEDULE') {
                $execution->addTimelineEvent('MANUAL_MODE', 'Compiling manual mapping values without external AI invocation.');
                foreach ($automation->field_mappings as $mapping) {
                    $fieldName = $mapping['field_name'] ?? null;
                    if (!$fieldName) continue;

                    $type = $mapping['mapping_type'] ?? 'FIXED_VALUE';
                    if ($type === 'FIXED_VALUE') {
                        $payload[$fieldName] = $mapping['fixed_value'] ?? '';
                    } elseif ($type === 'RUNTIME_NOW') {
                        $payload[$fieldName] = now()->toDateTimeString();
                    } elseif ($type === 'DERIVED_SLUG') {
                        $src = $mapping['source_field'] ?? 'title';
                        $payload[$fieldName] = Str::slug($payload[$src] ?? 'post') . '-' . rand(100, 999);
                    }
                }
            } else {
                // AI-driven structured generation
                $requiredFields = array_map(fn($m) => $m['field_name'], $automation->field_mappings);
                if (empty($requiredFields)) {
                    $requiredFields = ['title', 'slug', 'content', 'excerpt'];
                }

                // Query RAG context if knowledge documents configured
                $contextPassages = [];
                if (!empty($automation->knowledge_document_ids)) {
                    $query = $automation->prompt_context ?? $automation->name;
                    $chunks = $aiClient->queryKnowledge($automation->user_id, $query, 3);
                    $ragDetails = [];
                    foreach ($chunks as $c) {
                        $txt = $c['text'] ?? $c['content'] ?? '';
                        if (!empty($txt)) {
                            $contextPassages[] = $txt;
                            $ragDetails[] = [
                                'document_id' => $c['document_id'] ?? null,
                                'chunk_id' => $c['chunk_id'] ?? null,
                                'score' => (float) ($c['score'] ?? $c['similarity_score'] ?? 0.85),
                                'snippet' => substr($txt, 0, 300),
                            ];
                        }
                    }
                    $execution->addTimelineEvent(
                        'RAG_CONTEXT_RETRIEVED',
                        "Retrieved " . count($contextPassages) . " relevant passages from FAISS knowledge base matching query '{$query}'.",
                        [
                            'query' => $query,
                            'doc_count' => count($automation->knowledge_document_ids),
                            'chunks' => count($contextPassages),
                            'retrieved_passages' => $ragDetails,
                        ]
                    );
                }

                // Resolve effective AI provider & model (respecting user configuration)
                $provider = $automation->ai_provider;
                $model = $automation->ai_model;

                if (empty($provider)) {
                    $activeUserProvider = \App\Models\AiProvider::where('user_id', $automation->user_id)
                        ->where('is_active', true)
                        ->first();
                    if ($activeUserProvider) {
                        $provider = $activeUserProvider->provider_type;
                        $model = $activeUserProvider->model_name;
                    } else {
                        try {
                            $health = $aiClient->checkHealth('ollama');
                            if (!empty($health['available'])) {
                                $provider = 'ollama';
                                $model = $model ?: ($health['models'][0] ?? 'llama3.2:1b');
                            } else {
                                $provider = 'mock';
                                $model = 'mock-llama3-synthetic';
                            }
                        } catch (\Throwable) {
                            $provider = 'mock';
                            $model = 'mock-llama3-synthetic';
                        }
                    }
                }

                $userProvider = \App\Models\AiProvider::where('user_id', $automation->user_id)
                    ->where('provider_type', $provider)
                    ->first();
                $apiKey = $userProvider?->encrypted_api_key;

                $promptContext = $automation->prompt_context;
                if (!empty($promptContext) && trim($promptContext) !== '') {
                    $finalPrompt = "Topic & Content Direction: {$promptContext}\nTarget Table: '{$automation->target_table}'. Workflow: {$automation->name}.";
                } else {
                    $finalPrompt = "Topic: {$automation->name}. Generate rich, comprehensive publication-grade content for table '{$automation->target_table}'.";
                }

                $execution->addTimelineEvent(
                    'AI_INFERENCE_STARTED',
                    "Requesting dynamic structured generation via provider '{$provider}' (Model: {$model}).",
                    [
                        'provider' => $provider,
                        'model' => $model,
                        'required_fields' => $requiredFields,
                        'has_rag_context' => !empty($contextPassages),
                        'prompt_preview' => substr($finalPrompt, 0, 400),
                    ]
                );

                $recentTitles = $contextPackageService->loadRecentTitles($automation, 50);

                $aiResult = $aiClient->generateContent([
                    'provider' => $provider,
                    'model' => $model,
                    'api_key' => $apiKey,
                    'prompt' => $finalPrompt,
                    'target_table' => $automation->target_table,
                    'required_fields' => $requiredFields,
                    'context_passages' => $contextPassages,
                    'rejection_feedback' => $this->rejectionFeedback,
                    'recent_titles' => $recentTitles,
                ]);

                $payload = $aiResult['data'] ?? [];

                // Novelty / duplicate title verification
                if (!empty($payload['title']) && !empty($recentTitles)) {
                    $novelty = $noveltyService->check($payload['title'], $automation, 0.92);
                    if ($novelty['is_duplicate']) {
                        $execution->addTimelineEvent(
                            'NOVELTY_DUPLICATE_DETECTED',
                            "Candidate title '{$payload['title']}' has similarity {$novelty['highest_similarity']} with recent title '{$novelty['matched_title']}'. Regenerating with angle variation.",
                            $novelty
                        );

                        $anglePrompt = $finalPrompt . "\n\nCRITICAL NOVELTY DIRECTIVE: The proposed title '{$payload['title']}' is too similar to existing publication '{$novelty['matched_title']}'. " . ($novelty['angle_suggestion'] ?? "Provide a fresh title and unique perspective.");
                        try {
                            $retryResult = $aiClient->generateContent([
                                'provider' => $provider,
                                'model' => $model,
                                'api_key' => $apiKey,
                                'prompt' => $anglePrompt,
                                'target_table' => $automation->target_table,
                                'required_fields' => $requiredFields,
                                'context_passages' => $contextPassages,
                                'rejection_feedback' => $this->rejectionFeedback,
                                'recent_titles' => $recentTitles,
                            ]);
                            if (!empty($retryResult['data']['title'])) {
                                $oldTitle = $payload['title'];
                                $payload = $retryResult['data'];
                                $execution->addTimelineEvent(
                                    'NOVELTY_ANGLE_APPLIED',
                                    "Successfully regenerated fresh title '{$payload['title']}' via angle variation.",
                                    [
                                        'new_title' => $payload['title'],
                                        'previous_candidate' => $oldTitle,
                                        'duplicate_of' => $novelty['matched_title'],
                                    ]
                                );
                            }
                        } catch (\Throwable $e) {
                            Log::warning("Novelty angle regeneration failed: " . $e->getMessage());
                        }
                    } else {
                        $execution->addTimelineEvent(
                            'NOVELTY_VERIFIED',
                            "Title novelty verified against recent publications (Max similarity: {$novelty['highest_similarity']})."
                        );
                    }
                }

                $execution->addTimelineEvent(
                    'AI_INFERENCE_COMPLETED',
                    "Received schema-validated JSON with " . count($payload) . " fields from provider '{$provider}'.",
                    [
                        'provider' => $provider,
                        'model' => $model,
                        'field_count' => count($payload),
                        'latency_seconds' => $aiResult['latency_seconds'] ?? null,
                    ]
                );

                // Apply any fixed or runtime overrides from mappings
                foreach ($automation->field_mappings as $mapping) {
                    $fieldName = $mapping['field_name'] ?? null;
                    $type = $mapping['mapping_type'] ?? null;
                    if ($type === 'FIXED_VALUE' && isset($mapping['fixed_value'])) {
                        $payload[$fieldName] = $mapping['fixed_value'];
                    } elseif ($type === 'RUNTIME_NOW') {
                        $payload[$fieldName] = now()->toDateTimeString();
                    } elseif ($type === 'DERIVED_SLUG' && isset($payload[$mapping['source_field'] ?? 'title'])) {
                        $payload[$fieldName] = Str::slug($payload[$mapping['source_field'] ?? 'title']) . '-' . rand(100, 999);
                    }
                }
            }

            // Record duration
            $durationMs = (int) round((microtime(true) - $startTime) * 1000);

            // Compute content quality metrics (Readability, SEO, Factual grounding)
            if (app(\App\Services\FeatureFlagService::class)->isEnabled('FEATURE_QUALITY_SCORE')) {
                $payload['quality_metrics'] = app(\App\Services\QualityScoreService::class)->evaluateContent($payload, $contextPassages);
            }

            // Determine approval requirement
            $requiresApproval = (bool) $automation->requires_approval;
            $versionStatus = $requiresApproval ? 'PENDING_APPROVAL' : 'APPROVED';

            // Create immutable ContentVersion
            $version = ContentVersion::create([
                'user_id' => $automation->user_id,
                'execution_id' => $execution->id,
                'version_number' => $versionNumber,
                'payload' => $payload,
                'rejection_feedback' => $this->rejectionFeedback,
                'status' => $versionStatus,
            ]);

            $pubTime = $execution->publication_time;
            $isPublicationInFuture = $pubTime && $pubTime->isFuture();

            // Set target execution status
            if ($requiresApproval) {
                $targetStatus = 'PENDING_APPROVAL';
            } elseif ($isPublicationInFuture) {
                $targetStatus = 'READY_TO_PUBLISH';
            } else {
                $targetStatus = 'READY_TO_PUBLISH';
            }

            $execution->update([
                'generation_completed_at' => now(),
                'execution_duration_ms' => $durationMs,
                'status' => $targetStatus,
                'lease_expires_at' => null, // Release lease
            ]);

            $execution->addTimelineEvent(
                'VERSION_RECORDED',
                "Created immutable ContentVersion #{$versionNumber}.",
                [
                    'status' => $version->status,
                    'requires_approval' => $requiresApproval,
                    'duration_ms' => $durationMs,
                ]
            );

            AuditLog::log(
                $automation->user_id,
                'VERSION_GENERATED',
                'AutomationExecution',
                (string) $execution->id,
                [
                    'version_number' => $versionNumber,
                    'requires_approval' => $requiresApproval,
                    'status' => $targetStatus,
                ]
            );

            // Branch based on approval toggle
            if ($requiresApproval) {
                if (!empty($automation->reviewer_email)) {
                    $approvalService->dispatchApprovalNotification($version, $automation->reviewer_email);
                    $execution->addTimelineEvent(
                        'NOTIFICATION_SENT',
                        "Sent email preview and single-use approval token to {$automation->reviewer_email}."
                    );
                }
                LiveEventService::publish($automation->user_id, 'execution.stage_changed', [
                    'execution_id' => $execution->id,
                    'status' => 'PENDING_APPROVAL',
                    'version_id' => $version->id,
                ], 'AutomationExecution', (string) $execution->id);
            } else {
                // Approval is OFF: No email notification sent!
                if ($isPublicationInFuture) {
                    $execution->addTimelineEvent(
                        'READY_FOR_SCHEDULED_PUBLICATION',
                        "Content valid and verified. Approval toggle is OFF. Held in READY_TO_PUBLISH until publication time {$pubTime->toIso8601String()}.",
                        ['publication_time' => $pubTime->toIso8601String()]
                    );
                    LiveEventService::publish($automation->user_id, 'execution.stage_changed', [
                        'execution_id' => $execution->id,
                        'status' => 'READY_TO_PUBLISH',
                        'publication_time' => $pubTime->toIso8601String(),
                    ], 'AutomationExecution', (string) $execution->id);
                } else {
                    $execution->addTimelineEvent(
                        'AUTO_PUBLISHING_DISPATCHED',
                        'Approval toggle is OFF and publication time reached; queued for immediate database write.'
                    );
                    LiveEventService::publish($automation->user_id, 'execution.stage_changed', [
                        'execution_id' => $execution->id,
                        'status' => 'READY_TO_PUBLISH',
                    ], 'AutomationExecution', (string) $execution->id);

                    PublishAutomationContentJob::dispatch($execution->id);
                }
            }
        } catch (Exception $e) {
            Log::error("Generation failed for execution #{$execution->id}: " . $e->getMessage());
            $execution->update([
                'status' => 'FAILED',
                'failure_category' => 'GENERATION_ERROR',
                'error_message' => $e->getMessage(),
                'lease_expires_at' => null,
            ]);
            $execution->addTimelineEvent('GENERATION_FAILED', "Generation error: {$e->getMessage()}");

            LiveEventService::publish($automation->user_id, 'execution.failed', [
                'execution_id' => $execution->id,
                'status' => 'FAILED',
                'error' => $e->getMessage(),
            ], 'AutomationExecution', (string) $execution->id);
        }
    }
}
