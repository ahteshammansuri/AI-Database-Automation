<?php

namespace App\Filament\Resources\OrbitPageTours\Pages;

use App\Admin\AdminActivity;
use App\Filament\Resources\OrbitPageTours\OrbitPageTourResource;
use Filament\Facades\Filament;
use Filament\Resources\Pages\CreateRecord;

class CreateOrbitPageTour extends CreateRecord
{
    protected static string $resource = OrbitPageTourResource::class;

    protected function mutateFormDataBeforeCreate(array $data): array
    {
        OrbitPageTourResource::assertStepsRun($data);

        return ['steps' => array_values((array) ($data['steps'] ?? []))] + $data + ['updated_by' => Filament::auth()->id()];
    }

    protected function afterCreate(): void
    {
        AdminActivity::record('orbit_page_tour.created', $this->record, ['route' => $this->record->route, 'steps' => count((array) $this->record->steps)]);
    }

    protected function getRedirectUrl(): string
    {
        return $this->getResource()::getUrl('index');
    }
}
