<?php

namespace App\Filament\Widgets;

use App\Filament\Widgets\Concerns\RequiresDashboardPermission;
use App\Models\AutomationExecution;
use Filament\Widgets\ChartWidget;
use Illuminate\Support\Carbon;

class RunsChart extends ChartWidget
{
    use RequiresDashboardPermission;

    protected static ?int $sort = 3;

    protected ?string $heading = 'Automation runs';

    protected ?string $description = 'Published, failed and missed per day, last 14 days';

    protected ?string $maxHeight = '260px';

    // Daily totals: no need to refresh every few seconds.
    protected ?string $pollingInterval = null;

    protected function getType(): string
    {
        return 'bar';
    }

    protected function getData(): array
    {
        $from = now()->subDays(13)->startOfDay();
        $rows = AutomationExecution::where('created_at', '>=', $from)
            ->whereIn('status', ['PUBLISHED', 'FAILED', 'MISSED'])
            ->selectRaw('DATE(created_at) as d, status, COUNT(*) as c')
            ->groupBy('d', 'status')
            ->get();
        $series = ['PUBLISHED' => [], 'FAILED' => [], 'MISSED' => []];
        $labels = [];
        for ($i = 0; $i < 14; $i++) {
            $day = Carbon::parse($from)->addDays($i);
            $labels[] = $day->format('M j');
            foreach (array_keys($series) as $status) {
                $series[$status][] = (int) ($rows->first(fn ($r) => $r->d === $day->toDateString() && $r->status === $status)?->c ?? 0);
            }
        }
        return [
            'datasets' => [
                ['label' => 'Published', 'data' => $series['PUBLISHED'], 'backgroundColor' => '#10B981', 'borderRadius' => 6, 'stack' => 'runs'],
                ['label' => 'Failed', 'data' => $series['FAILED'], 'backgroundColor' => '#F43F5E', 'borderRadius' => 6, 'stack' => 'runs'],
                ['label' => 'Missed', 'data' => $series['MISSED'], 'backgroundColor' => '#CBD5E1', 'borderRadius' => 6, 'stack' => 'runs'],
            ],
            'labels' => $labels,
        ];
    }

    protected function getOptions(): array
    {
        return ['scales' => ['x' => ['stacked' => true], 'y' => ['stacked' => true, 'beginAtZero' => true, 'ticks' => ['precision' => 0]]]];
    }
}
