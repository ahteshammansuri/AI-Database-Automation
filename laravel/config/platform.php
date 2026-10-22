<?php

/*
 * Platform-wide settings. These are the defaults; an admin can change each one in the admin panel
 * (Settings), where saved values override these at runtime (see App\Settings\PlatformSettings).
 */
return [
    'brand_name' => env('PLATFORM_BRAND_NAME', 'DataAuto'),
    'tagline' => env('PLATFORM_TAGLINE', 'Database automation'),
    'support_email' => env('PLATFORM_SUPPORT_EMAIL'),

    // Sign-up and accounts
    'registration_open' => (bool) env('PLATFORM_REGISTRATION_OPEN', true),
    'registration_closed_message' => 'New sign-ups are paused for now. Please check back soon.',
    'password_min_length' => 8,

    // Limits per customer (0 = no limit)
    'max_connections_per_customer' => 0,
    'max_automations_per_customer' => 0,
    'knowledge_max_upload_mb' => 10,
    'media_max_upload_mb' => 10,
];
