<?php

namespace App\Filament\Resources\Automations\Pages;

use App\Filament\Resources\Automations\AutomationResource;
use Filament\Resources\Pages\ViewRecord;

class ViewAutomation extends ViewRecord
{
    protected static string $resource = AutomationResource::class;

    protected function getHeaderActions(): array
    {
        return [AutomationResource::pauseAction(), AutomationResource::resumeAction()];
    }
}
