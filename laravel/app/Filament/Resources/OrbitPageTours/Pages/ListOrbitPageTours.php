<?php

namespace App\Filament\Resources\OrbitPageTours\Pages;

use App\Filament\Resources\OrbitPageTours\OrbitPageTourResource;
use Filament\Actions\CreateAction;
use Filament\Resources\Pages\ListRecords;

class ListOrbitPageTours extends ListRecords
{
    protected static string $resource = OrbitPageTourResource::class;

    public function getSubheading(): ?string
    {
        return 'How Orbit explains each portal page: the overview it says in the portal tour, and the step by step walkthrough it gives when a user wants the details. Changes are live as soon as you save.';
    }

    protected function getHeaderActions(): array
    {
        return [CreateAction::make()->label('New page tour')];
    }
}
