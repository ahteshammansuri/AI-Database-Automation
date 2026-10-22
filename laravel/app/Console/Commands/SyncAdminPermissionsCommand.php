<?php

namespace App\Console\Commands;

use App\Admin\AdminPermissions;
use App\Models\Admin;
use Illuminate\Console\Command;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role;
use Spatie\Permission\PermissionRegistrar;

class SyncAdminPermissionsCommand extends Command
{
    protected $signature = 'admin:sync-permissions';
    protected $description = 'Create the admin panel permissions, the super admin role and the starting roles (idempotent)';

    public function handle(): int
    {
        app(PermissionRegistrar::class)->forgetCachedPermissions();
        $wanted = AdminPermissions::all();

        foreach ($wanted as $name) {
            Permission::findOrCreate($name, 'admin');
        }
        // Permissions that no longer exist in the registry are removed (and so detached from roles).
        Permission::where('guard_name', 'admin')->whereNotIn('name', $wanted)->get()->each->delete();

        Role::findOrCreate(Admin::SUPER_ADMIN, 'admin');
        foreach (AdminPermissions::PRESET_ROLES as $role => $permissions) {
            if (!Role::where('name', $role)->where('guard_name', 'admin')->exists()) {
                Role::create(['name' => $role, 'guard_name' => 'admin'])->syncPermissions($permissions);
            }
        }

        app(PermissionRegistrar::class)->forgetCachedPermissions();
        $this->info(count($wanted) . ' admin permissions are in place.');
        return self::SUCCESS;
    }
}
