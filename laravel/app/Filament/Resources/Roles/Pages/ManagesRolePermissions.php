<?php

namespace App\Filament\Resources\Roles\Pages;

use App\Admin\AdminPermissions;
use Spatie\Permission\Models\Role;

/** The role form groups permissions by area; these helpers convert to and from the role's permission list. */
trait ManagesRolePermissions
{
    /** Permissions chosen in the form (only ones that exist in the registry). */
    protected array $chosenPermissions = [];

    protected function takePermissions(array $data): array
    {
        $chosen = [];
        foreach ((array) ($data['permission_areas'] ?? []) as $list) {
            $chosen = array_merge($chosen, (array) $list);
        }
        $this->chosenPermissions = array_values(array_intersect(AdminPermissions::all(), $chosen));
        unset($data['permission_areas']);
        return $data;
    }

    protected static function areasFor(Role $role): array
    {
        $areas = [];
        foreach ($role->permissions->pluck('name') as $name) {
            $areas[explode('.', $name)[0]][] = $name;
        }
        return $areas;
    }
}
