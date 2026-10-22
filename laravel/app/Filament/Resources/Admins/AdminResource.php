<?php

namespace App\Filament\Resources\Admins;

use App\Filament\Concerns\AuthorizesWithPermissions;
use App\Filament\Resources\Admins\Pages\CreateAdmin;
use App\Filament\Resources\Admins\Pages\EditAdmin;
use App\Filament\Resources\Admins\Pages\ListAdmins;
use App\Filament\Resources\Admins\Pages\ViewAdmin;
use App\Filament\Resources\Admins\Schemas\AdminForm;
use App\Filament\Resources\Admins\Schemas\AdminInfolist;
use App\Filament\Resources\Admins\Tables\AdminsTable;
use App\Models\Admin;
use BackedEnum;
use Filament\Facades\Filament;
use Filament\Resources\Resource;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Model;
use UnitEnum;

/**
 * The admin team. Guard rails: nobody can change their own roles or deactivate/delete themselves, only super admins
 * can manage super admins, and the last active super admin can never be removed.
 */
class AdminResource extends Resource
{
    use AuthorizesWithPermissions;

    protected static ?string $model = Admin::class;

    protected static string $permissionArea = 'admins';

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedShieldCheck;

    protected static string|UnitEnum|null $navigationGroup = 'Team & access';

    protected static ?string $navigationLabel = 'Admins';

    protected static ?int $navigationSort = 1;

    protected static ?string $recordTitleAttribute = 'name';

    protected static function actionPermissions(): array
    {
        return ['create' => 'admins.manage', 'update' => 'admins.manage', 'delete' => 'admins.manage'];
    }

    public static function canEdit(Model $record): bool
    {
        return parent::canEdit($record) && self::mayManage($record);
    }

    public static function canDelete(Model $record): bool
    {
        return parent::canDelete($record)
            && self::mayManage($record)
            && $record->getKey() !== Filament::auth()->id()
            && !self::isLastSuperAdmin($record);
    }

    /** Only super admins manage super admins. */
    public static function mayManage(Model $record): bool
    {
        $me = Filament::auth()->user();
        return $me instanceof Admin && (!$record->isSuperAdmin() || $me->isSuperAdmin());
    }

    public static function isLastSuperAdmin(Model $record): bool
    {
        return $record->isSuperAdmin() && Admin::role(Admin::SUPER_ADMIN)->where('is_active', true)->count() <= 1;
    }

    public static function form(Schema $schema): Schema
    {
        return AdminForm::configure($schema);
    }

    public static function infolist(Schema $schema): Schema
    {
        return AdminInfolist::configure($schema);
    }

    public static function table(Table $table): Table
    {
        return AdminsTable::configure($table);
    }

    public static function getPages(): array
    {
        return [
            'index' => ListAdmins::route('/'),
            'create' => CreateAdmin::route('/create'),
            'view' => ViewAdmin::route('/{record}'),
            'edit' => EditAdmin::route('/{record}/edit'),
        ];
    }
}
