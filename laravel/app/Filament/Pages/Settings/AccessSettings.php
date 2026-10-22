<?php

namespace App\Filament\Pages\Settings;

/** Settings > Sign-up & limits */
class AccessSettings extends SettingsPage
{
    protected static string $settingsGroup = 'access';

    protected static ?string $slug = 'settings/access';

    protected static ?int $navigationSort = 2;
}
