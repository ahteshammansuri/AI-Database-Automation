<?php

namespace App\Filament\Resources\Admins\Schemas;

use App\Models\Admin;
use Filament\Infolists\Components\IconEntry;
use Filament\Infolists\Components\TextEntry;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;

class AdminInfolist
{
    public static function configure(Schema $schema): Schema
    {
        return $schema
            ->columns(1)
            ->components([
                Section::make('Account')
                    ->columns(3)
                    ->components([
                        TextEntry::make('name'),
                        TextEntry::make('email')->label('Email address')->copyable(),
                        IconEntry::make('is_active')->label('Can sign in')->boolean(),
                        TextEntry::make('roles.name')
                            ->label('Roles')
                            ->badge()
                            ->formatStateUsing(fn ($state) => str($state)->replace('_', ' ')->title())
                            ->color(fn ($state) => $state === Admin::SUPER_ADMIN ? 'primary' : 'gray'),
                        IconEntry::make('two_factor')
                            ->label('Two-factor sign-in')
                            ->state(fn (Admin $record) => filled($record->getAppAuthenticationSecret()))
                            ->boolean(),
                        TextEntry::make('last_login_at')->label('Last sign-in')->since()->placeholder('Never'),
                        TextEntry::make('last_login_ip')->label('From')->placeholder('—'),
                        TextEntry::make('created_at')->label('Added')->dateTime(),
                    ]),
            ]);
    }
}
