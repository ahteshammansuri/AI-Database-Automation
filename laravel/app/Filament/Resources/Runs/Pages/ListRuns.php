<?php

namespace App\Filament\Resources\Runs\Pages;

use App\Filament\Resources\Runs\RunResource;
use Filament\Resources\Pages\ListRecords;

class ListRuns extends ListRecords
{
    protected static string $resource = RunResource::class;

    public function getTitle(): string
    {
        return 'Automation runs';
    }

    public function getSubheading(): ?string
    {
        return 'Each time an automation wrote (or tried to write) content, across all customers: what happened, when it publishes, the tokens it used, and why a run failed.';
    }
}
