<?php

namespace App\Filament\Pages;

use App\Models\Admin;
use BackedEnum;
use Filament\Facades\Filament;
use Filament\Pages\Dashboard as BaseDashboard;
use Filament\Support\Icons\Heroicon;

/** Platform overview: customers, usage, automation and Orbit success, recent sign-ups and failures. */
class Dashboard extends BaseDashboard
{
    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedHome;

    protected static ?string $title = 'Overview';

    protected static ?string $navigationLabel = 'Overview';

    public static function canAccess(): bool
    {
        $admin = Filament::auth()->user();
        return $admin instanceof Admin && $admin->can('dashboard.view');
    }

    public function getSubheading(): ?string
    {
        return 'How the platform is used, today and over the last weeks.';
    }

    public function getColumns(): int|array
    {
        return ['default' => 1, 'lg' => 2];
    }
}
