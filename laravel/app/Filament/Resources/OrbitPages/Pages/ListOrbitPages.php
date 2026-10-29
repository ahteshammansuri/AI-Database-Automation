<?php

namespace App\Filament\Resources\OrbitPages\Pages;

use App\Filament\Resources\OrbitPages\OrbitPageResource;
use Filament\Actions\CreateAction;
use Filament\Resources\Pages\ListRecords;

class ListOrbitPages extends ListRecords
{
    protected static string $resource = OrbitPageResource::class;

    public function getSubheading(): ?string
    {
        return 'All portal pages and routes that Orbit recognizes and navigates to.';
    }

    protected function getHeaderActions(): array
    {
        return [
            CreateAction::make()->label('New page'),
        ];
    }
}
