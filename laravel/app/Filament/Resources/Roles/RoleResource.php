<?php

namespace App\Filament\Resources\Roles;

use App\Filament\Concerns\AuthorizesWithPermissions;
use App\Filament\Resources\Roles\Pages\CreateRole;
use App\Filament\Resources\Roles\Pages\EditRole;
use App\Filament\Resources\Roles\Pages\ListRoles;
use App\Filament\Resources\Roles\Schemas\RoleForm;
use App\Filament\Resources\Roles\Tables\RolesTable;
use App\Models\Admin;
use BackedEnum;
use Filament\Resources\Resource;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Spatie\Permission\Models\Role;
use UnitEnum;

/** Admin roles and their permissions (see App\Admin\AdminPermissions). The super admin role is built in. */
class RoleResource extends Resource
{
    use AuthorizesWithPermissions;

    protected static ?string $model = Role::class;

    protected static string $permissionArea = 'roles';

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedKey;

    protected static string|UnitEnum|null $navigationGroup = 'Team & access';

    protected static ?int $navigationSort = 2;

    protected static ?string $recordTitleAttribute = 'name';

    protected static function actionPermissions(): array
    {
        return ['create' => 'roles.manage', 'update' => 'roles.manage', 'delete' => 'roles.manage'];
    }

    public static function canEdit(Model $record): bool
    {
        return parent::canEdit($record) && $record->name !== Admin::SUPER_ADMIN;
    }

    public static function canDelete(Model $record): bool
    {
        return parent::canDelete($record) && $record->name !== Admin::SUPER_ADMIN;
    }

    public static function getEloquentQuery(): Builder
    {
        return parent::getEloquentQuery()->where('guard_name', 'admin');
    }

    public static function form(Schema $schema): Schema
    {
        return RoleForm::configure($schema);
    }

    public static function table(Table $table): Table
    {
        return RolesTable::configure($table);
    }

    public static function getPages(): array
    {
        return [
            'index' => ListRoles::route('/'),
            'create' => CreateRole::route('/create'),
            'edit' => EditRole::route('/{record}/edit'),
        ];
    }
}
