<?php

namespace App\Filament\Resources\OrbitTasks\Pages;

use App\Filament\Resources\OrbitTasks\OrbitTaskResource;
use Filament\Resources\Pages\ListRecords;

class ListOrbitTasks extends ListRecords
{
    protected static string $resource = OrbitTaskResource::class;

    public function getSubheading(): ?string
    {
        return 'What customers asked Orbit, what it did, and whether it finished.';
    }
}
