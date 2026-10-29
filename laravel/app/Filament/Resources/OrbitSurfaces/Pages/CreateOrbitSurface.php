<?php

namespace App\Filament\Resources\OrbitSurfaces\Pages;

use App\Admin\AdminActivity;
use App\Filament\Resources\OrbitSurfaces\OrbitSurfaceResource;
use App\Services\Agent\SurfaceCatalog;
use Filament\Facades\Filament;
use Filament\Resources\Pages\CreateRecord;

class CreateOrbitSurface extends CreateRecord
{
    protected static string $resource = OrbitSurfaceResource::class;

    protected function mutateFormDataBeforeCreate(array $data): array
    {
        return $data + ['updated_by' => Filament::auth()->id()];
    }

    protected function afterCreate(): void
    {
        SurfaceCatalog::flushCache();
        AdminActivity::record('orbit_surface.created', $this->record, ['id' => $this->record->id]);
    }

    protected function getRedirectUrl(): string
    {
        return $this->getResource()::getUrl('index');
    }
}
