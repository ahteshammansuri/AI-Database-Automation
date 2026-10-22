<?php

namespace App\Filament\Resources\Admins\Pages;

use App\Admin\AdminActivity;
use App\Filament\Resources\Admins\AdminResource;
use Filament\Actions\DeleteAction;
use Filament\Actions\ViewAction;
use Filament\Facades\Filament;
use Filament\Resources\Pages\EditRecord;

class EditAdmin extends EditRecord
{
    protected static string $resource = AdminResource::class;

    /** Roles before saving, to record role changes (they are not model attributes). */
    private array $rolesBefore = [];

    private array $attributesBefore = [];

    protected function getHeaderActions(): array
    {
        return [
            ViewAction::make(),
            DeleteAction::make()
                ->visible(fn () => AdminResource::canDelete($this->record))
                ->before(fn () => AdminActivity::record('admin.deleted', $this->record)),
        ];
    }

    protected function mutateFormDataBeforeSave(array $data): array
    {
        // Never let an admin lock themselves out, whatever the request says.
        if ($this->record->getKey() === Filament::auth()->id()) {
            $data['is_active'] = true;
        }
        return $data;
    }

    protected function beforeSave(): void
    {
        $this->rolesBefore = $this->record->roles()->pluck('name')->sort()->values()->all();
        $this->attributesBefore = $this->record->getAttributes();
    }

    protected function afterSave(): void
    {
        $changes = AdminActivity::diff($this->record, $this->attributesBefore);
        $after = $this->record->roles()->pluck('name')->sort()->values()->all();
        if ($after !== $this->rolesBefore) {
            $changes['roles'] = ['from' => $this->rolesBefore, 'to' => $after];
        }
        if ($changes) {
            AdminActivity::record('admin.updated', $this->record, $changes);
        }
    }
}
