<?php

namespace App\Filament\Resources\OrbitSurfaces\Pages;

use App\Admin\AdminActivity;
use App\Filament\Resources\OrbitSurfaces\OrbitSurfaceResource;
use App\Services\Agent\SurfaceCatalog;
use Filament\Actions\DeleteAction;
use Filament\Facades\Filament;
use Filament\Resources\Pages\EditRecord;

class EditOrbitSurface extends EditRecord
{
    protected static string $resource = OrbitSurfaceResource::class;

    private array $attributesBefore = [];

    protected function getHeaderActions(): array
    {
        return [
            DeleteAction::make()
                ->modalDescription('Orbit will no longer recognize or operate this surface.')
                ->before(function () {
                    AdminActivity::record('orbit_surface.deleted', $this->record, ['id' => $this->record->id]);
                    SurfaceCatalog::flushCache();
                }),
        ];
    }

    protected function beforeSave(): void
    {
        $this->attributesBefore = $this->record->getAttributes();
    }

    protected function mutateFormDataBeforeSave(array $data): array
    {
        return ['updated_by' => Filament::auth()->id()] + $data;
    }

    protected function afterSave(): void
    {
        SurfaceCatalog::flushCache();
        $changes = AdminActivity::diff($this->record, $this->attributesBefore);
        unset($changes['updated_by']);
        if ($changes) {
            AdminActivity::record('orbit_surface.updated', $this->record, $changes);
        }
    }

    protected function getRedirectUrl(): string
    {
        return $this->getResource()::getUrl('index');
    }
}
