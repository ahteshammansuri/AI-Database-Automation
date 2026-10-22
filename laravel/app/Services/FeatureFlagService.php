<?php

namespace App\Services;

class FeatureFlagService
{
    /**
     * Default state of all platform feature flags.
     */
    protected const DEFAULT_FLAGS = [
        'FEATURE_DRY_RUN' => true,
        'FEATURE_SCHEMA_DRIFT' => true,
        'FEATURE_UNDO_CENTER' => true,
        'FEATURE_QUALITY_SCORE' => true,
        'FEATURE_CONTENT_CALENDAR' => true,
        'FEATURE_DB_INSIGHTS' => true,
        'FEATURE_TEMPLATES' => true,
    ];

    /**
     * Check if a specific feature flag is active.
     */
    public function isEnabled(string $flagName): bool
    {
        $flagName = strtoupper(trim($flagName));
        if (!str_starts_with($flagName, 'FEATURE_')) {
            $flagName = 'FEATURE_' . $flagName;
        }

        // config/features.php holds the defaults; admins switch flags in the admin panel (Settings > Features).
        $key = strtolower(substr($flagName, strlen('FEATURE_')));
        return filter_var(config("features.{$key}", self::DEFAULT_FLAGS[$flagName] ?? false), FILTER_VALIDATE_BOOLEAN);
    }

    /**
     * Get all feature flags with their current boolean states and metadata.
     */
    public function getAllFlags(): array
    {
        $flags = [];
        foreach (self::DEFAULT_FLAGS as $flag => $default) {
            $cleanKey = strtolower(str_replace('FEATURE_', '', $flag));
            $enabled = filter_var(config("features.{$cleanKey}", $default), FILTER_VALIDATE_BOOLEAN);
            $flags[$cleanKey] = [
                'key' => $flag,
                'name' => ucwords(str_replace('_', ' ', $cleanKey)),
                'enabled' => $enabled,
            ];
        }

        return $flags;
    }
}
