<?php

namespace App\Filament\Resources\OrbitTasks\Pages;

use App\Filament\Resources\OrbitTasks\OrbitTaskResource;
use Filament\Resources\Pages\ViewRecord;

class ViewOrbitTask extends ViewRecord
{
    protected static string $resource = OrbitTaskResource::class;

    public function getTitle(): string
    {
        return 'Orbit request #' . $this->record->id;
    }
}
