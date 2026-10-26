<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DbConnection;
use App\Models\Automation;
use App\Models\AutomationExecution;
use App\Models\ContentVersion;
use App\Models\KnowledgeDocument;
use App\Models\AiProvider;
use App\Models\AuditLog;
use App\Services\AiServiceClient;
use Illuminate\Http\Request;
use Carbon\Carbon;

class DashboardController extends Controller
{
    public function __construct(
        protected AiServiceClient $aiClient
    ) {}

    public function stats(Request $request)
    {
        $userId = $request->user()->id;
        $range = $request->query('range', '7d'); // 24h, 7d, 30d

        $startDate = match ($range) {
            '24h' => now()->subHours(24),
            '30d' => now()->subDays(30),
            default => now()->subDays(7),
        };

        // 1. Core KPIs
        $connections = DbConnection::where('user_id', $userId)->get();
        $connectionsCount = $connections->count();
        $connectedDbCount = $connections->where('status', 'connected')->count();
        $errorDbCount = $connections->where('status', 'connection_error')->count();

        $automations = Automation::where('user_id', $userId)->get();
        $automationsCount = $automations->count();
        $activeAutomationsCount = $automations->where('is_active', true)->count();

        $allExecutions = AutomationExecution::where('user_id', $userId)->get();
        $executionsCount = $allExecutions->count();
        $runningCount = $allExecutions->whereIn('status', ['GENERATING', 'PUBLISHING', 'RUNNING'])->count();
        $queueBacklogCount = $allExecutions->where('status', 'QUEUED')->count();
        $publishedCount = $allExecutions->where('status', 'PUBLISHED')->count();
        $failedCount = $allExecutions->where('status', 'FAILED')->count();

        $todayStart = now()->startOfDay();
        $publishedTodayCount = AutomationExecution::where('user_id', $userId)
            ->where('status', 'PUBLISHED')
            ->where('published_at', '>=', $todayStart)
            ->count();

        $pendingApprovalsCount = ContentVersion::where('user_id', $userId)
            ->where('status', 'PENDING_APPROVAL')
            ->count();

        $knowledgeDocsCount = KnowledgeDocument::where('user_id', $userId)->count();
        $knowledgeIndexedCount = KnowledgeDocument::where('user_id', $userId)->where('status', 'indexed')->count();

        // 2. Range-filtered Execution Analytics
        $rangeExecutions = AutomationExecution::where('user_id', $userId)
            ->where('created_at', '>=', $startDate)
            ->get();

        $rangePublished = $rangeExecutions->where('status', 'PUBLISHED')->count();
        $rangeFailed = $rangeExecutions->where('status', 'FAILED')->count();
        $rangeCancelled = $rangeExecutions->where('status', 'CANCELLED')->count();

        // Average duration & queue wait
        $avgDurationMs = (int) round($rangeExecutions->where('status', 'PUBLISHED')->avg('execution_duration_ms') ?: 0);
        $avgQueueWaitMs = (int) round($rangeExecutions->avg('queue_wait_ms') ?: 0);

        // Failure categories breakdown
        $failureBreakdown = $rangeExecutions->where('status', 'FAILED')
            ->groupBy('failure_category')
            ->map(fn($group) => $group->count());

        // Timeseries Day-by-Day or Hour-by-Hour Distribution
        $daysCount = match ($range) {
            '24h' => 24,
            '30d' => 30,
            default => 7,
        };

        $dailyVolume = [];
        if ($range === '24h') {
            for ($i = 23; $i >= 0; $i--) {
                $hStart = now()->subHours($i)->startOfHour();
                $hEnd = $hStart->copy()->endOfHour();
                $pubCount = $rangeExecutions->where('status', 'PUBLISHED')
                    ->filter(fn($e) => $e->created_at >= $hStart && $e->created_at <= $hEnd)
                    ->count();
                $failCount = $rangeExecutions->where('status', 'FAILED')
                    ->filter(fn($e) => $e->created_at >= $hStart && $e->created_at <= $hEnd)
                    ->count();
                $dailyVolume[] = [
                    'label' => $hStart->format('H:00'),
                    'published' => $pubCount,
                    'failed' => $failCount,
                    'total' => $pubCount + $failCount,
                ];
            }
        } else {
            for ($i = $daysCount - 1; $i >= 0; $i--) {
                $dStart = now()->subDays($i)->startOfDay();
                $dEnd = $dStart->copy()->endOfDay();
                $pubCount = $rangeExecutions->where('status', 'PUBLISHED')
                    ->filter(fn($e) => $e->created_at >= $dStart && $e->created_at <= $dEnd)
                    ->count();
                $failCount = $rangeExecutions->where('status', 'FAILED')
                    ->filter(fn($e) => $e->created_at >= $dStart && $e->created_at <= $dEnd)
                    ->count();
                $dailyVolume[] = [
                    'label' => $dStart->format('M d'),
                    'published' => $pubCount,
                    'failed' => $failCount,
                    'total' => $pubCount + $failCount,
                ];
            }
        }

        // Live Operational Feed from Security Audit Logs
        $operationalFeed = AuditLog::where('user_id', $userId)
            ->latest('created_at')
            ->take(8)
            ->get()
            ->map(function ($log) {
                return [
                    'id' => $log->id,
                    'action' => $log->action,
                    'entity_type' => $log->entity_type,
                    'entity_id' => $log->entity_id,
                    'details' => $log->details,
                    'created_at' => $log->created_at->toIso8601String(),
                ];
            });

        // 3. Upcoming Next Work (from active automations)
        $userTz = $automations->firstWhere('timezone')?->timezone ?: 'UTC';
        if (!in_array($userTz, timezone_identifiers_list(), true)) {
            $userTz = 'UTC';
        }
        $todayStr = now($userTz)->toDateString();

        $upcomingRuns = array_map(fn (array $n) => [
            'automation_id' => $n['automation_id'],
            'name' => $n['name'],
            'target_table' => $n['target_table'],
            'next_generation_at' => $n['generation_at'],
            'next_publication_at' => $n['publication_at'],
            'timezone' => $n['timezone'],
            'requires_approval' => $n['requires_approval'],
        ], $this->upcomingOccurrences($automations));

        usort($upcomingRuns, fn($a, $b) => strcmp($a['next_generation_at'], $b['next_generation_at']));
        $nextUpcoming = $upcomingRuns[0] ?? null;

        // 4. AI Provider Health Summary
        $activeProvider = AiProvider::where('user_id', $userId)->where('is_active', true)->first();
        $providerType = $activeProvider?->provider_type ?: 'ollama';
        $providerModel = $activeProvider?->model_name ?: 'llama3.2:1b';
        $aiHealth = [
            'provider' => $providerType,
            'model' => $providerModel,
            'is_configured' => !is_null($activeProvider),
        ];

        // 5. Recent Executions (Rich)
        $recentExecutions = AutomationExecution::where('user_id', $userId)
            ->with(['automation:id,name,target_table', 'versions'])
            ->latest('created_at')
            ->take(8)
            ->get();

        // Real worker liveness (heartbeat of the queue that generates and publishes runs).
        $queue = \App\Admin\SystemHealth::queues()['default'] ?? null;
        $workerHealth = [
            'status' => ($queue['status'] ?? 'down') === 'down' ? 'offline' : 'operational',
            'is_healthy' => ($queue['status'] ?? 'down') !== 'down',
            'waiting_jobs' => (int) ($queue['waiting'] ?? 0),
            'running_jobs' => (int) ($queue['running'] ?? 0),
        ];

        return response()->json([
            'connections_count' => $connectionsCount,
            'connected_db_count' => $connectedDbCount,
            'error_db_count' => $errorDbCount,
            'automations_count' => $automationsCount,
            'active_automations_count' => $activeAutomationsCount,
            'executions_count' => $executionsCount,
            'running_count' => $runningCount,
            'queue_backlog_count' => $queueBacklogCount,
            'published_count' => $publishedCount,
            'published_today_count' => $publishedTodayCount,
            'failed_count' => $failedCount,
            'pending_approvals_count' => $pendingApprovalsCount,
            'knowledge_docs_count' => $knowledgeDocsCount,
            'knowledge_indexed_count' => $knowledgeIndexedCount,
            'analytics' => [
                'range' => $range,
                'range_published' => $rangePublished,
                'range_failed' => $rangeFailed,
                'range_cancelled' => $rangeCancelled,
                'avg_duration_ms' => $avgDurationMs,
                'avg_queue_wait_ms' => $avgQueueWaitMs,
                'failure_breakdown' => $failureBreakdown,
                'daily_volume' => $dailyVolume,
            ],
            'upcoming' => [
                'next_run' => $nextUpcoming,
                'total_scheduled_active' => count($upcomingRuns),
            ],
            'ai_health' => $aiHealth,
            'worker_health' => $workerHealth,
            'operational_feed' => $operationalFeed,
            'recent_executions' => $recentExecutions,
            'timezone' => $userTz,
            'server_time' => now()->toIso8601String(),
        ]);
    }

    /**
     * The dashboard's live card: the run in progress (or one that just finished), the next scheduled run of any
     * active automation (from the real schedule), and the last published item. Times are ISO-8601 UTC.
     */
    public function nextUp(Request $request)
    {
        $userId = $request->user()->id;
        $automations = Automation::where('user_id', $userId)->get();

        $inFlight = AutomationExecution::where('user_id', $userId)
            ->whereIn('status', ['PENDING_GENERATION', 'GENERATING', 'PENDING_APPROVAL', 'APPROVED', 'PUBLISHING'])
            ->with('automation:id,name,target_table,requires_approval')
            ->orderByRaw('COALESCE(publication_time, scheduled_generation_at, created_at) ASC')
            ->first();
        $justFinished = $inFlight ? null : AutomationExecution::where('user_id', $userId)
            ->whereIn('status', ['PUBLISHED', 'FAILED'])
            ->where('updated_at', '>=', now()->subMinutes(30))
            ->with('automation:id,name,target_table,requires_approval')
            ->latest('updated_at')
            ->first();
        $current = $inFlight ?? $justFinished;

        $upcoming = $this->upcomingOccurrences($automations);
        if ($current) {
            // The in-flight run is already shown; "next" is the next one after it.
            $upcoming = array_values(array_filter($upcoming, fn ($n) => !($n['automation_id'] === $current->automation_id
                && $current->scheduled_generation_at && $n['generation_at'] === $current->scheduled_generation_at->toIso8601String())));
        }

        $lastPublished = AutomationExecution::where('user_id', $userId)->where('status', 'PUBLISHED')
            ->with('automation:id,name,target_table,requires_approval')->latest('published_at')->first();

        return response()->json([
            'server_time' => now()->toIso8601String(),
            'current' => $current ? $this->runCard($current) : null,
            'next' => $upcoming[0] ?? null,
            'later' => array_slice($upcoming, 1, 3),
            'active_schedules' => count(array_unique(array_column($upcoming, 'automation_id'))),
            'last_published' => $lastPublished ? $this->runCard($lastPublished) : null,
        ]);
    }

    /** One run as the card shows it. */
    private function runCard(AutomationExecution $e): array
    {
        $stage = match ($e->status) {
            'PENDING_GENERATION' => 'queued',
            'GENERATING' => 'writing',
            'PENDING_APPROVAL' => 'awaiting_approval',
            'APPROVED' => 'scheduled_publish',
            'PUBLISHING' => 'publishing',
            'PUBLISHED' => 'published',
            default => 'failed',
        };
        $title = null;
        if (in_array($e->status, ['PENDING_APPROVAL', 'APPROVED', 'PUBLISHING', 'PUBLISHED'], true)) {
            $version = $e->versions()->latest('version_number')->first();
            $payload = (array) ($version?->payload ?? []);
            foreach (['title', 'name', 'headline', 'question', 'subject'] as $k) {
                if (!empty($payload[$k]) && is_string($payload[$k])) {
                    $title = mb_substr($payload[$k], 0, 160);
                    break;
                }
            }
        }
        return [
            'execution_id' => $e->id,
            'automation_id' => $e->automation_id,
            'automation_name' => $e->automation?->name ?? 'Manual publication',
            'target_table' => $e->automation?->target_table,
            'status' => $e->status,
            'stage' => $stage,
            'title' => $title,
            'requires_approval' => (bool) ($e->automation?->requires_approval ?? false),
            'generation_at' => $e->scheduled_generation_at?->toIso8601String(),
            'publication_at' => $e->publication_time?->toIso8601String(),
            'published_at' => $e->published_at?->toIso8601String(),
            'record_id' => $e->target_record_id,
            'error' => $stage === 'failed' ? mb_substr((string) $e->error_message, 0, 240) : null,
            'updated_at' => $e->updated_at?->toIso8601String(),
        ];
    }

    /**
     * Next real occurrence of every active scheduled automation, soonest first.
     *
     * @return list<array{automation_id: int, name: string, target_table: string, generation_at: string, publication_at: string, timezone: string, requires_approval: bool}>
     */
    private function upcomingOccurrences($automations): array
    {
        $calc = app(\App\Services\Automation\ScheduleCalculator::class);
        $out = [];
        foreach ($automations as $a) {
            if (!$a->is_active || $a->completed_at || \App\Services\Automation\ScheduleCalculator::scheduleType($a) === \App\Services\Automation\ScheduleCalculator::TYPE_NONE) {
                continue;
            }
            try {
                $occ = $calc->nextOccurrence($a);
            } catch (\Throwable) {
                continue;
            }
            if (!$occ) {
                continue;
            }
            $o = \App\Services\Automation\ScheduleCalculator::occurrenceToArray($occ);
            $out[] = [
                'automation_id' => $a->id,
                'name' => $a->name,
                'target_table' => $a->target_table,
                'generation_at' => $o['generation_at'],
                'publication_at' => $o['publication_at'],
                'timezone' => $o['timezone'],
                'requires_approval' => (bool) $a->requires_approval,
            ];
        }
        usort($out, fn ($x, $y) => strcmp($x['generation_at'], $y['generation_at']));
        return $out;
    }
}
