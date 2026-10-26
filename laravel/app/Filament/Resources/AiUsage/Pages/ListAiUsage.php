<?php

namespace App\Filament\Resources\AiUsage\Pages;

use App\Filament\Resources\AiUsage\AiUsageResource;
use App\Filament\Resources\AiUsage\Widgets\AiUsageStats;
use Filament\Resources\Pages\ListRecords;

class ListAiUsage extends ListRecords
{
    protected static string $resource = AiUsageResource::class;

    public function getTitle(): string
    {
        return 'AI usage';
    }

    public function getSubheading(): ?string
    {
        return 'Every AI call made for customers: which model, what for, and how many tokens. Tokens are counted as the provider reports them.';
    }

    protected function getHeaderWidgets(): array
    {
        return [AiUsageStats::class];
    }
}
