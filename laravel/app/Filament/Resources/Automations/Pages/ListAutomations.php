<?php

namespace App\Filament\Resources\Automations\Pages;

use App\Filament\Resources\Automations\AutomationResource;
use Filament\Resources\Pages\ListRecords;

class ListAutomations extends ListRecords
{
    protected static string $resource = AutomationResource::class;

    public function getSubheading(): ?string
    {
        return 'Every scheduled automation with its run success. Pausing stops new runs; resuming continues from now.';
    }
}
