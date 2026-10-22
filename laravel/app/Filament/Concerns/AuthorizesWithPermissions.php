<?php

namespace App\Filament\Concerns;

use App\Models\Admin;
use BackedEnum;
use Filament\Facades\Filament;
use Illuminate\Auth\Access\Response;
use Illuminate\Database\Eloquent\Model;
use UnitEnum;

/**
 * Resource authorization from admin permissions (see App\Admin\AdminPermissions). Viewing needs "{area}.view";
 * any other action is denied unless the resource maps it to a permission in actionPermissions(). Without this,
 * Filament allows every action on models that have no policy.
 */
trait AuthorizesWithPermissions
{
    public static function getAuthorizationResponse(string | UnitEnum $action, ?Model $record = null): Response
    {
        $name = match (true) {
            $action instanceof BackedEnum => (string) $action->value,
            $action instanceof UnitEnum => $action->name,
            default => $action,
        };
        $permission = static::actionPermissions()[$name] ?? (in_array($name, ['viewAny', 'view'], true) ? static::$permissionArea . '.view' : null);
        $admin = Filament::auth()->user();

        return $permission && $admin instanceof Admin && $admin->can($permission)
            ? Response::allow()
            : Response::deny('Your role does not allow this.');
    }

    /** Extra actions this resource allows, e.g. ['update' => 'customers.update']. */
    protected static function actionPermissions(): array
    {
        return [];
    }

    /** Whether the signed-in admin has a permission (for custom actions). */
    public static function adminCan(string $permission): bool
    {
        $admin = Filament::auth()->user();
        return $admin instanceof Admin && $admin->can($permission);
    }
}
