<?php

namespace App\Filament\Resources\OrbitPages\Pages;

use App\Admin\AdminActivity;
use App\Filament\Resources\OrbitPages\OrbitPageResource;
use App\Services\Agent\SurfaceCatalog;
use Filament\Facades\Filament;
use Filament\Resources\Pages\CreateRecord;

class CreateOrbitPage extends CreateRecord
{
    protected static string $resource = OrbitPageResource::class;

    protected function mutateFormDataBeforeCreate(array $data): array
    {
        return $data + ['updated_by' => Filament::auth()->id()];
    }

    protected function afterCreate(): void
    {
        SurfaceCatalog::flushCache();
        AdminActivity::record('orbit_page.created', $this->record, ['route' => $this->record->route]);
    }

    protected function getRedirectUrl(): string
    {
        return $this->getResource()::getUrl('index');
    }
}
