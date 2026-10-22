<?php

namespace App\Filament\Resources\Admins\Tables;

use App\Admin\AdminActivity;
use App\Filament\Resources\Admins\AdminResource;
use App\Models\Admin;
use Filament\Actions\DeleteAction;
use Filament\Actions\EditAction;
use Filament\Actions\ViewAction;
use Filament\Tables\Columns\IconColumn;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Filters\TernaryFilter;
use Filament\Tables\Table;

class AdminsTable
{
    public static function configure(Table $table): Table
    {
        return $table
            ->columns([
                TextColumn::make('name')
                    ->description(fn (Admin $record) => $record->email)
                    ->searchable(['name', 'email'])
                    ->sortable(),
                TextColumn::make('roles.name')
                    ->label('Roles')
                    ->badge()
                    ->formatStateUsing(fn ($state) => str($state)->replace('_', ' ')->title())
                    ->color(fn ($state) => $state === Admin::SUPER_ADMIN ? 'primary' : 'gray'),
                IconColumn::make('is_active')->label('Active')->boolean(),
                IconColumn::make('two_factor')
                    ->label('2FA')
                    ->state(fn (Admin $record) => filled($record->getAppAuthenticationSecret()))
                    ->boolean()
                    ->trueIcon('heroicon-o-shield-check')
                    ->falseIcon('heroicon-o-shield-exclamation')
                    ->falseColor('warning'),
                TextColumn::make('last_login_at')->label('Last sign-in')->since()->sortable()->placeholder('Never'),
                TextColumn::make('created_at')->label('Added')->date()->sortable()->toggleable(isToggledHiddenByDefault: true),
            ])
            ->defaultSort('name')
            ->filters([
                SelectFilter::make('roles')->relationship('roles', 'name', fn ($query) => $query->where('guard_name', 'admin'))->multiple()->preload(),
                TernaryFilter::make('is_active')->label('Can sign in'),
            ])
            ->recordActions([
                ViewAction::make(),
                EditAction::make(),
                DeleteAction::make()
                    ->modalDescription('The admin loses access immediately. Their past activity stays in the activity log.')
                    ->visible(fn (Admin $record) => AdminResource::canDelete($record))
                    ->before(fn (Admin $record) => AdminActivity::record('admin.deleted', $record)),
            ]);
    }
}
