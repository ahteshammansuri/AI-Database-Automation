<?php

namespace App\Filament\Concerns;

use App\Models\Admin;
use Filament\Facades\Filament;
use Filament\Resources\RelationManagers\RelationManager;
use Illuminate\Database\Eloquent\Model;

/**
 * A read-only tab on a record page (e.g. a customer's connections). Shown only when the admin's role includes the
 * area's view permission; admins never edit customer data through these tabs.
 */
abstract class ReadOnlyRelationManager extends RelationManager
{
    protected static string $permission;

    public function isReadOnly(): bool
    {
        return true;
    }

    public static function canViewForRecord(Model $ownerRecord, string $pageClass): bool
    {
        $admin = Filament::auth()->user();
        return $admin instanceof Admin && $admin->can(static::$permission);
    }
}
