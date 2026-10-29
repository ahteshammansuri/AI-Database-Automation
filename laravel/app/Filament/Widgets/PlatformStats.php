<?php

namespace App\Filament\Widgets;

use App\Models\AgentTask;
use App\Models\Automation;
use App\Models\AutomationExecution;
use App\Models\ContentVersion;
use App\Models\DbConnection;
use App\Models\OrbitRemoteSession;
use App\Models\User;
use App\Services\Automation\ScheduleCalculator;
use App\Filament\Widgets\Concerns\HasSkeletonPlaceholder;
use App\Filament\Widgets\Concerns\RequiresDashboardPermission;
use Filament\Widgets\StatsOverviewWidget;
use Filament\Widgets\StatsOverviewWidget\Stat;
use Illuminate\Support\Carbon;

/** Headline numbers: customers, usage, success rates. Every figure is counted from the database. */
class PlatformStats extends StatsOverviewWidget
{
    use HasSkeletonPlaceholder;
    use RequiresDashboardPermission;

    protected static ?int $sort = 1;

    protected ?string $pollingInterval = '60s';

    protected function getColumns(): int
    {
        return 4;
    }

    protected function getStats(): array
    {
        $now = now();
        $weekAgo = $now->copy()->subDays(7);

        $customers = User::count();
        $newThisWeek = User::where('created_at', '>=', $weekAgo)->count();
        // Active = used the portal API this week (our own marker, or Sanctum's last use of one of their tokens).
        $activeThisWeek = User::where(fn ($q) => $q->where('last_active_at', '>=', $weekAgo)
            ->orWhereHas('tokens', fn ($t) => $t->where('last_used_at', '>=', $weekAgo)))->count();
        $suspended = User::whereNotNull('suspended_at')->count();

        $connections = DbConnection::count();
        $connected = DbConnection::where('status', 'connected')->count();

        $automations = Automation::where('schedule_type', '!=', ScheduleCalculator::TYPE_NONE)->count();
        $activeAutomations = Automation::where('schedule_type', '!=', ScheduleCalculator::TYPE_NONE)->where('is_active', true)->count();

        $runs = AutomationExecution::where('created_at', '>=', $weekAgo);
        $published = (clone $runs)->where('status', 'PUBLISHED')->count();
        $failed = (clone $runs)->where('status', 'FAILED')->count();
        $missed = (clone $runs)->where('status', 'MISSED')->count();
        $runRate = $published + $failed > 0 ? round($published / ($published + $failed) * 100) : null;

        $tasks = AgentTask::where('created_at', '>=', $weekAgo);
        $orbitOk = (clone $tasks)->whereIn('status', ['SUCCEEDED', 'ANSWERED'])->count();
        $orbitBad = (clone $tasks)->whereIn('status', ['FAILED', 'PARTIAL_SUCCESS'])->count();
        $orbitRate = $orbitOk + $orbitBad > 0 ? round($orbitOk / ($orbitOk + $orbitBad) * 100) : null;

        $pendingApprovals = ContentVersion::where('status', 'PENDING_APPROVAL')->count();
        $phones = OrbitRemoteSession::where('status', 'active')->count();

        return [
            Stat::make('Customers', number_format($customers))
                ->description("+{$newThisWeek} this week" . ($suspended ? " · {$suspended} suspended" : ''))
                ->descriptionIcon('heroicon-m-arrow-trending-up')
                ->chart($this->dailyCounts(User::query(), 14))
                ->color('primary'),
            Stat::make('Active this week', number_format($activeThisWeek))
                ->description($customers ? round($activeThisWeek / $customers * 100) . '% of customers used the portal' : 'No customers yet')
                ->descriptionIcon('heroicon-m-user-group')
                ->color('info'),
            Stat::make('Database connections', number_format($connections))
                ->description("{$connected} connected")
                ->descriptionIcon('heroicon-m-circle-stack')
                ->color('gray'),
            Stat::make('Automations', number_format($automations))
                ->description("{$activeAutomations} running on a schedule")
                ->descriptionIcon('heroicon-m-arrow-path')
                ->color('gray'),
            Stat::make('Run success (7 days)', $runRate === null ? '—' : "{$runRate}%")
                ->description("{$published} published · {$failed} failed · {$missed} missed")
                ->descriptionIcon($runRate !== null && $runRate < 80 ? 'heroicon-m-exclamation-triangle' : 'heroicon-m-check-badge')
                ->chart($this->dailyCounts(AutomationExecution::where('status', 'PUBLISHED'), 14))
                ->color($runRate === null ? 'gray' : ($runRate >= 80 ? 'success' : ($runRate >= 50 ? 'warning' : 'danger'))),
            Stat::make('Orbit success (7 days)', $orbitRate === null ? '—' : "{$orbitRate}%")
                ->description("{$orbitOk} done · {$orbitBad} not finished")
                ->descriptionIcon('heroicon-m-sparkles')
                ->color($orbitRate === null ? 'gray' : ($orbitRate >= 80 ? 'success' : ($orbitRate >= 50 ? 'warning' : 'danger'))),
            Stat::make('Waiting for approval', number_format($pendingApprovals))
                ->description('Drafts a reviewer has not decided yet')
                ->descriptionIcon('heroicon-m-inbox-stack')
                ->color($pendingApprovals ? 'warning' : 'gray'),
            Stat::make('Phones connected', number_format($phones))
                ->description('Orbit Remote sessions right now')
                ->descriptionIcon('heroicon-m-device-phone-mobile')
                ->color('gray'),
        ];
    }

    /** Count per day for the last $days days (oldest first), for the small trend lines. */
    private function dailyCounts($query, int $days): array
    {
        $from = now()->subDays($days - 1)->startOfDay();
        $rows = (clone $query)->where('created_at', '>=', $from)
            ->selectRaw('DATE(created_at) as d, COUNT(*) as c')->groupBy('d')->pluck('c', 'd');
        $out = [];
        for ($i = 0; $i < $days; $i++) {
            $day = Carbon::parse($from)->addDays($i)->toDateString();
            $out[] = (int) ($rows[$day] ?? 0);
        }
        return $out;
    }
}
