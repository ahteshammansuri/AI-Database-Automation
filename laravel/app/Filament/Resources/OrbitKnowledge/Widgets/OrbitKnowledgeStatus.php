<?php

namespace App\Filament\Resources\OrbitKnowledge\Widgets;

use App\Admin\OrbitKnowledge;
use App\Filament\Resources\OrbitKnowledge\OrbitKnowledgeResource;
use App\Models\OrbitKnowledgeGuide;
use Filament\Widgets\StatsOverviewWidget;
use Filament\Widgets\StatsOverviewWidget\Stat;
use Illuminate\Support\Carbon;
use Livewire\Attributes\On;

/** What Orbit is actually using, as reported by the AI service, next to what is waiting to be published. */
class OrbitKnowledgeStatus extends StatsOverviewWidget
{
    protected ?string $pollingInterval = null;

    /** Re-render after publishing or restoring, so the cards show what the AI service reports now. */
    #[On('orbit-knowledge-changed')]
    public function refreshStatus(): void
    {
    }

    protected function getColumns(): int
    {
        return 3;
    }

    protected function getStats(): array
    {
        $live = OrbitKnowledge::liveStatus();
        $waiting = OrbitKnowledgeResource::unpublishedCount();
        $waitingStat = Stat::make('Waiting to go live', $waiting ? "{$waiting} " . str('change')->plural($waiting) : 'Nothing')
            ->description($waiting ? 'Publish to Orbit to apply them' : 'Orbit has the latest guides')
            ->descriptionIcon($waiting ? 'heroicon-m-clock' : 'heroicon-m-check-circle')
            ->color($waiting ? 'warning' : 'success');

        if ($live === null) {
            return [
                Stat::make('Orbit is using', 'Unknown')->description('The AI service cannot be reached')->descriptionIcon('heroicon-m-exclamation-triangle')->color('danger'),
                Stat::make('Sections Orbit can find', '—')->description('Shown when the AI service is reachable'),
                $waitingStat,
            ];
        }

        $published = ($live['source'] ?? '') === 'published';
        $lost = !$published && OrbitKnowledgeGuide::whereNotNull('published_hash')->exists();
        $guides = (int) ($live['guides'] ?? 0);
        $backend = (string) ($live['embedding_backend'] ?? '');
        $indexed = !empty($live['indexed_at']) ? Carbon::parse($live['indexed_at'])->diffForHumans() : null;

        return [
            Stat::make('Orbit is using', $guides . ' ' . ($published ? 'published' : 'built-in') . ' ' . str('guide')->plural($guides))
                ->description($lost
                    ? 'The AI service lost the published guides. Publish again.'
                    : ($published ? 'Version ' . ($live['version'] ?? '—') : 'The guides that ship with the app'))
                ->descriptionIcon($lost ? 'heroicon-m-exclamation-triangle' : 'heroicon-m-book-open')
                ->color($lost ? 'danger' : 'primary'),
            Stat::make('Sections Orbit can find', (string) ($live['chunks'] ?? 0))
                ->description(($backend === '' ? 'Not indexed yet' : (str_starts_with($backend, 'ollama')
                    ? 'Semantic search · ' . substr($backend, 7)
                    : 'Keyword search (embedding model not reachable)')) . ($indexed ? " · indexed {$indexed}" : ''))
                ->descriptionIcon('heroicon-m-magnifying-glass')
                ->color(str_starts_with($backend, 'ollama') ? 'success' : 'warning'),
            $waitingStat,
        ];
    }
}
