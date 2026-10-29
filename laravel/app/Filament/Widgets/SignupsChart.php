<?php

namespace App\Filament\Widgets;

use App\Filament\Widgets\Concerns\HasSkeletonPlaceholder;
use App\Filament\Widgets\Concerns\RequiresDashboardPermission;
use App\Models\User;
use Filament\Widgets\ChartWidget;
use Illuminate\Support\Carbon;

class SignupsChart extends ChartWidget
{
    use HasSkeletonPlaceholder;
    use RequiresDashboardPermission;

    protected static ?int $sort = 2;

    protected ?string $heading = 'New customers';

    protected ?string $description = 'Sign-ups per day, last 30 days';

    protected ?string $maxHeight = '260px';

    // Daily totals: no need to refresh every few seconds.
    protected ?string $pollingInterval = null;

    protected function getType(): string
    {
        return 'line';
    }

    protected function getData(): array
    {
        $from = now()->subDays(29)->startOfDay();
        $rows = User::where('created_at', '>=', $from)->selectRaw('DATE(created_at) as d, COUNT(*) as c')->groupBy('d')->pluck('c', 'd');
        $labels = [];
        $data = [];
        for ($i = 0; $i < 30; $i++) {
            $day = Carbon::parse($from)->addDays($i);
            $labels[] = $day->format('M j');
            $data[] = (int) ($rows[$day->toDateString()] ?? 0);
        }
        return [
            'datasets' => [[
                'label' => 'Sign-ups',
                'data' => $data,
                'borderColor' => '#6366F1',
                'backgroundColor' => 'rgba(99,102,241,0.12)',
                'fill' => true,
                'tension' => 0.35,
                'pointRadius' => 0,
            ]],
            'labels' => $labels,
        ];
    }

    protected function getOptions(): array
    {
        return ['plugins' => ['legend' => ['display' => false]], 'scales' => ['y' => ['beginAtZero' => true, 'ticks' => ['precision' => 0]]]];
    }
}
