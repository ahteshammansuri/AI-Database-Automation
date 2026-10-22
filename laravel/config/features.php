<?php

/*
 * Feature flags (defaults; switch them in the admin panel: Settings > Features).
 */
return [
    'dry_run' => (bool) env('FEATURE_DRY_RUN', true),
    'schema_drift' => (bool) env('FEATURE_SCHEMA_DRIFT', true),
    'undo_center' => (bool) env('FEATURE_UNDO_CENTER', true),
    'quality_score' => (bool) env('FEATURE_QUALITY_SCORE', true),
    'content_calendar' => (bool) env('FEATURE_CONTENT_CALENDAR', true),
    'db_insights' => (bool) env('FEATURE_DB_INSIGHTS', true),
    'templates' => (bool) env('FEATURE_TEMPLATES', true),
];
