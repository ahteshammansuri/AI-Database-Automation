<?php

/*
 * Automation engine defaults (editable in the admin panel: Settings > Automations).
 */
return [
    // Publication is always at least this long after generation, so reviewers have time to decide.
    'min_gap_minutes' => 15,
    // Rejected drafts are rewritten at most this many times per run, then the run stops.
    'max_regenerations' => 3,
    // Runs of one customer that may execute at the same time (fair scheduling between customers).
    'tenant_concurrency' => 3,
];
