<?php

namespace App\Filament\Resources\OrbitTools\Pages;

use App\Admin\AdminActivity;
use App\Filament\Resources\OrbitTools\OrbitToolResource;
use App\Services\Agent\AgentToolRegistry;
use Filament\Facades\Filament;
use Filament\Resources\Pages\EditRecord;

class EditOrbitTool extends EditRecord
{
    protected static string $resource = OrbitToolResource::class;

    private array $attributesBefore = [];

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
        AgentToolRegistry::flushCache();
        $changes = AdminActivity::diff($this->record, $this->attributesBefore);
        unset($changes['updated_by']);
        if ($changes) {
            AdminActivity::record('orbit_tool.updated', $this->record, $changes);
        }
    }

    protected function getRedirectUrl(): string
    {
        return $this->getResource()::getUrl('index');
    }
}
