<?php

namespace App\Filament\Resources\Runs\Pages;

use App\Filament\Resources\Runs\RunResource;
use Filament\Resources\Pages\ViewRecord;

class ViewRun extends ViewRecord
{
    protected static string $resource = RunResource::class;

    public function getTitle(): string
    {
        return 'Run #' . $this->record->id;
    }
}
