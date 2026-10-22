<?php

namespace App\Filament\Resources\Admins\Schemas;

use App\Models\Admin;
use Filament\Facades\Filament;
use Filament\Forms\Components\CheckboxList;
use Filament\Forms\Components\TextInput;
use Filament\Forms\Components\Toggle;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;
use Illuminate\Validation\Rules\Password;
use Spatie\Permission\Models\Role;

class AdminForm
{
    public static function configure(Schema $schema): Schema
    {
        $me = Filament::auth()->user();
        $isSelf = fn (?Admin $record) => $record && $me && $record->getKey() === $me->getKey();

        return $schema
            ->columns(1)
            ->components([
                Section::make('Account')
                    ->description('Admins sign in at /admin with this email. They are not customer accounts.')
                    ->columns(2)
                    ->components([
                        TextInput::make('name')
                            ->required()
                            ->maxLength(120),
                        TextInput::make('email')
                            ->label('Email address')
                            ->email()
                            ->required()
                            ->maxLength(255)
                            ->unique(ignoreRecord: true),
                        TextInput::make('password')
                            ->password()
                            ->revealable()
                            ->rule(Password::min(12)->letters()->numbers())
                            ->required(fn (string $operation) => $operation === 'create')
                            ->dehydrated(fn (?string $state) => filled($state))
                            ->confirmed()
                            ->helperText(fn (string $operation) => $operation === 'edit'
                                ? 'Leave empty to keep the current password. 12+ characters with letters and numbers.'
                                : '12+ characters with letters and numbers. Share it securely; they can change it in their profile.'),
                        TextInput::make('password_confirmation')
                            ->label('Confirm password')
                            ->password()
                            ->revealable()
                            ->required(fn (string $operation, $get) => $operation === 'create' || filled($get('password')))
                            ->dehydrated(false),
                        Toggle::make('is_active')
                            ->label('Can sign in')
                            ->default(true)
                            ->helperText(fn (?Admin $record) => $isSelf($record) ? 'You cannot deactivate your own account.' : 'Turn off to block sign-in without deleting the account.')
                            ->disabled(fn (?Admin $record) => $isSelf($record)),
                    ]),
                Section::make('Roles')
                    ->description('What this admin may see and do. Super admin has every permission.')
                    ->components([
                        CheckboxList::make('roles')
                            ->hiddenLabel()
                            ->relationship(
                                'roles',
                                'name',
                                // Only super admins may hand out the super admin role.
                                fn ($query) => $query->where('guard_name', 'admin')
                                    ->when(!$me?->isSuperAdmin(), fn ($q) => $q->where('name', '!=', Admin::SUPER_ADMIN))
                            )
                            ->getOptionLabelFromRecordUsing(fn (Role $role) => str($role->name)->replace('_', ' ')->title())
                            ->descriptions(fn () => Role::where('guard_name', 'admin')->withCount('permissions')->get()
                                ->mapWithKeys(fn (Role $r) => [$r->id => $r->name === Admin::SUPER_ADMIN ? 'Everything, including the admin team' : "{$r->permissions_count} permissions"])
                                ->all())
                            ->columns(2)
                            ->bulkToggleable()
                            ->disabled(fn (?Admin $record) => $isSelf($record))
                            ->helperText(fn (?Admin $record) => $isSelf($record) ? 'Ask another super admin to change your own roles.' : null),
                    ]),
            ]);
    }
}
