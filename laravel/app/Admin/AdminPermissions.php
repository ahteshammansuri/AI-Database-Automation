<?php

namespace App\Admin;

/**
 * Every permission an admin role can be given, grouped by area of the admin panel. `super_admin` has all of them
 * (Gate::before). Synced to the database by `php artisan admin:sync-permissions` (also run by `admin:create`).
 */
final class AdminPermissions
{
    /** area => [label, description, [ability => what it allows]] */
    public const AREAS = [
        'dashboard' => ['Overview', 'Platform KPIs and charts.', [
            'view' => 'See the overview dashboard',
        ]],
        'customers' => ['Customers', 'Customer accounts and their usage.', [
            'view' => 'See customers and their usage',
            'update' => 'Suspend, reactivate and sign customers out',
            'delete' => 'Delete customer accounts',
        ]],
        'connections' => ['Database connections', 'Customer database connections (never their passwords).', [
            'view' => 'See connections',
            'update' => 'Switch a connection to read-only',
        ]],
        'automations' => ['Automations', 'Customer automations and their runs.', [
            'view' => 'See automations and runs',
            'update' => 'Pause and resume automations',
        ]],
        'orbit' => ['Orbit activity', 'Orbit tasks and paired phones.', [
            'view' => 'See Orbit tasks and phone sessions',
            'manage' => 'Disconnect paired phones',
        ]],
        'orbit_knowledge' => ['Orbit knowledge', 'What Orbit knows about the website.', [
            'view' => 'Read the guides',
            'manage' => 'Edit and publish the guides',
        ]],
        'content' => ['Website content', 'Landing page and announcement texts.', [
            'view' => 'See website content',
            'manage' => 'Edit website content',
        ]],
        'settings' => ['Platform settings', 'Platform, Orbit, automation and security settings.', [
            'view' => 'See settings',
            'manage' => 'Change settings',
        ]],
        'audit' => ['Audit logs', 'Customer and admin activity logs.', [
            'view' => 'See audit logs',
        ]],
        'system' => ['System health', 'Services, queues and failed jobs.', [
            'view' => 'See system health',
            'manage' => 'Retry or delete failed jobs and clear caches',
        ]],
        'admins' => ['Admin team', 'Admin accounts.', [
            'view' => 'See admins',
            'manage' => 'Create, edit, deactivate and delete admins',
        ]],
        'roles' => ['Roles', 'Roles and their permissions.', [
            'view' => 'See roles',
            'manage' => 'Create, edit and delete roles',
        ]],
    ];

    /** Starting roles created once (never overwritten): a super admin can change or delete them. */
    public const PRESET_ROLES = [
        'support' => ['dashboard.view', 'customers.view', 'connections.view', 'automations.view', 'orbit.view', 'audit.view'],
        'operations' => [
            'dashboard.view', 'customers.view', 'customers.update', 'connections.view', 'connections.update', 'automations.view',
            'automations.update', 'orbit.view', 'orbit.manage', 'audit.view', 'system.view', 'system.manage',
        ],
        'content_editor' => ['dashboard.view', 'content.view', 'content.manage', 'orbit_knowledge.view', 'orbit_knowledge.manage'],
    ];

    /** @return string[] e.g. ["customers.view", ...] */
    public static function all(): array
    {
        $out = [];
        foreach (self::AREAS as $area => [, , $abilities]) {
            foreach (array_keys($abilities) as $ability) {
                $out[] = "{$area}.{$ability}";
            }
        }
        return $out;
    }

    /** Options for a role form: area label => [permission => description]. */
    public static function grouped(): array
    {
        $out = [];
        foreach (self::AREAS as $area => [$label, , $abilities]) {
            foreach ($abilities as $ability => $text) {
                $out[$label]["{$area}.{$ability}"] = $text;
            }
        }
        return $out;
    }
}
