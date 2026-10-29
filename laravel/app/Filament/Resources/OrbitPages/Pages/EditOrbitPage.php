<?php

namespace App\Filament\Resources\OrbitPages\Pages;

use App\Admin\AdminActivity;
use App\Filament\Resources\OrbitPages\OrbitPageResource;
use App\Services\Agent\SurfaceCatalog;
use Filament\Actions\DeleteAction;
use Filament\Facades\Filament;
use Filament\Resources\Pages\EditRecord;

class EditOrbitPage extends EditRecord
{
    protected static string $resource = OrbitPageResource::class;

    private array $attributesBefore = [];

    protected function getHeaderActions(): array
    {
        return [
            DeleteAction::make()
                ->modalDescription('Orbit will no longer navigate to this route.')
                ->before(function () {
                    AdminActivity::record('orbit_page.deleted', $this->record, ['route' => $this->record->route]);
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
            AdminActivity::record('orbit_page.updated', $this->record, $changes);
        }
    }

    protected function getRedirectUrl(): string
    {
        return $this->getResource()::getUrl('index');
    }
}
