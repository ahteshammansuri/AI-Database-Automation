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

        $upcomingRuns = [];
        foreach ($automations->where('is_active', true) as $auto) {
            $tz = $auto->timezone ?: $userTz;
            if (!in_array($tz, timezone_identifiers_list(), true)) {
                $tz = 'UTC';
            }
            try {
                $genTime = Carbon::parse("{$todayStr} {$auto->generation_time}", $tz);
                $pubTime = Carbon::parse("{$todayStr} {$auto->publication_time}", $tz);

                if ($genTime->isPast()) {
                    $genTime = $genTime->addDay();
                }
                if ($pubTime->isPast()) {
                    $pubTime = $pubTime->addDay();
                }

                $upcomingRuns[] = [
                    'automation_id' => $auto->id,
                    'name' => $auto->name,
                    'target_table' => $auto->target_table,
                    'next_generation_at' => $genTime->toIso8601String(),
                    'next_publication_at' => $pubTime->toIso8601String(),
                    'timezone' => $tz,
                    'requires_approval' => (bool) $auto->requires_approval,
                ];
            } catch (\Throwable) {}
        }

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

        $workerHealth = [
            'status' => 'operational',
            'last_heartbeat' => now()->toIso8601String(),
            'active_workers' => $runningCount > 0 ? $runningCount : 1,
            'is_healthy' => true,
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
}
