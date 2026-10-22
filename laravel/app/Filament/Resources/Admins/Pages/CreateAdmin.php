<?php

namespace App\Filament\Resources\Admins\Pages;

use App\Admin\AdminActivity;
use App\Filament\Resources\Admins\AdminResource;
use Filament\Resources\Pages\CreateRecord;

class CreateAdmin extends CreateRecord
{
    protected static string $resource = AdminResource::class;

    protected function afterCreate(): void
    {
        AdminActivity::record('admin.created', $this->record, ['roles' => $this->record->roles()->pluck('name')->all()]);
    }
}
