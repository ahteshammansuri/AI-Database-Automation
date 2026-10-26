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
    // How long the Approve / Reject link in a review email works.
    'approval_link_hours' => 24,
    // Times a run is retried when its worker stopped before finishing (crash, restart, timeout).
    'max_retries' => 3,
    // Existing linked records (e.g. categories) the AI may choose from when filling a foreign key.
    'relation_options' => 40,
];
