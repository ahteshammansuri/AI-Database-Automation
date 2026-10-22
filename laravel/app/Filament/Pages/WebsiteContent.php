<?php

namespace App\Filament\Pages;

use App\Filament\Pages\Settings\SettingsPage;
use UnitEnum;

/**
 * Texts on the public website (hero, questions, closing, footer, search engines) and the announcement bar shown on
 * the website and in the portal. Served to the frontend by GET /api/site/content.
 */
class WebsiteContent extends SettingsPage
{
    protected static string $settingsGroup = 'content';

    protected static string $viewPermission = 'content.view';

    protected static string $managePermission = 'content.manage';

    protected static string|UnitEnum|null $navigationGroup = 'Website';

    protected static ?string $slug = 'website-content';

    protected static ?int $navigationSort = 1;
}
