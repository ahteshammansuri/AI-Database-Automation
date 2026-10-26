<?php

/*
 * Platform-wide settings. These are the defaults; an admin can change each one in the admin panel
 * (Settings), where saved values override these at runtime (see App\Settings\PlatformSettings).
 */
return [
    'brand_name' => env('PLATFORM_BRAND_NAME', 'Rowpilot'),
    'tagline' => env('PLATFORM_TAGLINE', 'Database autopilot'),
    'support_email' => env('PLATFORM_SUPPORT_EMAIL'),

    // Sign-up and accounts
    'registration_open' => (bool) env('PLATFORM_REGISTRATION_OPEN', true),
    'registration_closed_message' => 'New sign-ups are paused for now. Please check back soon.',
    'password_min_length' => 6, // admins can raise it in Settings > Sign-up (6 is the lowest allowed)
    // Customers stay signed in this many hours (0 = until they sign out). Applied as sanctum.expiration.
    'session_hours' => 0,
    // Legal pages linked from the sign-up form and the website footer (empty = not shown).
    'terms_url' => env('PLATFORM_TERMS_URL'),
    'privacy_url' => env('PLATFORM_PRIVACY_URL'),

    // Limits per customer (0 = no limit)
    'max_connections_per_customer' => 0,
    'max_automations_per_customer' => 0,
    'knowledge_max_upload_mb' => 10,
    'media_max_upload_mb' => 10,
];
