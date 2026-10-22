<?php

namespace App\Filament\Resources\Roles\Pages;

use App\Admin\AdminActivity;
use App\Filament\Resources\Roles\RoleResource;
use Filament\Resources\Pages\CreateRecord;

class CreateRole extends CreateRecord
{
    use ManagesRolePermissions;

    protected static string $resource = RoleResource::class;

    protected function mutateFormDataBeforeCreate(array $data): array
    {
        return $this->takePermissions($data) + ['guard_name' => 'admin'];
    }

    protected function afterCreate(): void
    {
        $this->record->syncPermissions($this->chosenPermissions);
        AdminActivity::record('role.created', $this->record, ['permissions' => $this->chosenPermissions]);
    }
}
