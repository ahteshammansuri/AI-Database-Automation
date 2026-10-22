<?php

namespace App\Filament\Resources\Roles\Tables;

use App\Admin\AdminActivity;
use App\Admin\AdminPermissions;
use App\Filament\Resources\Roles\RoleResource;
use App\Models\Admin;
use Filament\Actions\DeleteAction;
use Filament\Actions\EditAction;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Table;
use Spatie\Permission\Models\Role;

class RolesTable
{
    public static function configure(Table $table): Table
    {
        return $table
            ->modifyQueryUsing(fn ($query) => $query->withCount(['permissions', 'users']))
            ->columns([
                TextColumn::make('name')
                    ->formatStateUsing(fn ($state) => str($state)->replace('_', ' ')->title())
                    ->badge()
                    ->color(fn ($state) => $state === Admin::SUPER_ADMIN ? 'primary' : 'gray')
                    ->searchable()
                    ->sortable(),
                TextColumn::make('permissions_count')
                    ->label('Permissions')
                    ->formatStateUsing(fn ($state, Role $record) => $record->name === Admin::SUPER_ADMIN
                        ? 'All (' . count(AdminPermissions::all()) . ')'
                        : $state . ' of ' . count(AdminPermissions::all())),
                TextColumn::make('users_count')->label('Admins'),
                TextColumn::make('updated_at')->label('Changed')->since()->sortable(),
            ])
            ->defaultSort('name')
            ->recordActions([
                EditAction::make(),
                DeleteAction::make()
                    ->visible(fn (Role $record) => RoleResource::canDelete($record))
                    ->modalDescription('Admins with this role lose its permissions immediately.')
                    ->before(fn (Role $record) => AdminActivity::record('role.deleted', $record, ['permissions' => $record->permissions->pluck('name')->all()])),
            ]);
    }
}
