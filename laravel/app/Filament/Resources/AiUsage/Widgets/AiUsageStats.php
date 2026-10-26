<?php

namespace App\Filament\Resources\AiUsage\Widgets;

use App\Models\AiUsageEvent;
use App\Services\AiUsage;
use Filament\Widgets\StatsOverviewWidget;
use Filament\Widgets\StatsOverviewWidget\Stat;

/** Tokens and calls over the last 30 days, the busiest model and how many customers used AI. */
class AiUsageStats extends StatsOverviewWidget
{
    protected ?string $pollingInterval = null;

    protected function getStats(): array
    {
        $since = now()->subDays(30);
        $sum = AiUsage::summarize(AiUsageEvent::where('created_at', '>=', $since));
        $previous = AiUsage::summarize(AiUsageEvent::whereBetween('created_at', [now()->subDays(60), $since]));
        $top = $sum['models'][0] ?? null;
        $customers = AiUsageEvent::where('created_at', '>=', $since)->whereNotNull('user_id')->distinct()->count('user_id');
        $change = $previous['total'] > 0 ? (int) round(($sum['total'] - $previous['total']) / $previous['total'] * 100) : null;

        return [
            Stat::make('Tokens, last 30 days', number_format($sum['total']))
                ->description(number_format($sum['prompt']) . ' sent · ' . number_format($sum['completion']) . ' written' . ($change !== null ? ' · ' . ($change >= 0 ? '+' : '') . $change . '% vs the 30 days before' : ''))
                ->descriptionIcon('heroicon-m-cpu-chip')
                ->color('primary'),
            Stat::make('AI calls, last 30 days', number_format($sum['calls']))
                ->description($customers . ' ' . str('customer')->plural($customers) . ' used AI')
                ->descriptionIcon('heroicon-m-users'),
            Stat::make('Most used model', $top ? ($top['model'] ?: 'unknown') : '—')
                ->description($top ? ucfirst($top['provider']) . ' · ' . number_format($top['total']) . ' tokens' : 'No calls yet')
                ->descriptionIcon('heroicon-m-sparkles')
                ->color('success'),
        ];
    }
}
