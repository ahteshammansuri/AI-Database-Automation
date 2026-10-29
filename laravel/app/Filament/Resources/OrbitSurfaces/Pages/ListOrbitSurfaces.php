<?php

namespace App\Filament\Resources\OrbitSurfaces\Pages;

use App\Filament\Resources\OrbitSurfaces\OrbitSurfaceResource;
use Filament\Actions\CreateAction;
use Filament\Resources\Pages\ListRecords;

class ListOrbitSurfaces extends ListRecords
{
    protected static string $resource = OrbitSurfaceResource::class;

    public function getSubheading(): ?string
    {
        return 'Interactive forms, cards, and sections on portal pages. Orbit reads their fields, types visibly into inputs, and presses buttons based on these definitions.';
    }

    protected function getHeaderActions(): array
    {
        return [
            CreateAction::make()->label('New surface'),
        ];
    }
}
