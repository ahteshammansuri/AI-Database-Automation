<?php

namespace App\Filament\Widgets\Concerns;

use App\Models\Admin;
use Filament\Facades\Filament;

/** Dashboard widgets are shown only to admins whose role includes "dashboard.view". */
trait RequiresDashboardPermission
{
    public static function canView(): bool
    {
        $admin = Filament::auth()->user();
        return $admin instanceof Admin && $admin->can('dashboard.view');
    }
}
