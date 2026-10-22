<?php

namespace App\Filament\Resources\Roles\Pages;

use App\Admin\AdminActivity;
use App\Filament\Resources\Roles\RoleResource;
use Filament\Actions\DeleteAction;
use Filament\Resources\Pages\EditRecord;

class EditRole extends EditRecord
{
    use ManagesRolePermissions;

    protected static string $resource = RoleResource::class;

    private array $permissionsBefore = [];

    private array $attributesBefore = [];

    protected function getHeaderActions(): array
    {
        return [
            DeleteAction::make()
                ->visible(fn () => RoleResource::canDelete($this->record))
                ->before(fn () => AdminActivity::record('role.deleted', $this->record)),
        ];
    }

    protected function mutateFormDataBeforeFill(array $data): array
    {
        $data['permission_areas'] = self::areasFor($this->record);
        return $data;
    }

    protected function mutateFormDataBeforeSave(array $data): array
    {
        $this->permissionsBefore = $this->record->permissions->pluck('name')->sort()->values()->all();
        $this->attributesBefore = $this->record->getAttributes();
        return $this->takePermissions($data);
    }

    protected function afterSave(): void
    {
        $this->record->syncPermissions($this->chosenPermissions);
        $after = collect($this->chosenPermissions)->sort()->values()->all();
        $changes = AdminActivity::diff($this->record, $this->attributesBefore);
        if ($after !== $this->permissionsBefore) {
            $changes['permissions'] = [
                'added' => array_values(array_diff($after, $this->permissionsBefore)),
                'removed' => array_values(array_diff($this->permissionsBefore, $after)),
            ];
        }
        if ($changes) {
            AdminActivity::record('role.updated', $this->record, $changes);
        }
    }
}
