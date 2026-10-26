<?php

/*
 * Data Explorer, Data Manager and data autopilot (admin panel: Settings > Data assistant).
 */
return [
    // Most rows shown on one page of the Data Explorer.
    'max_page_size' => 100,
    // Most AI sample rows created in one go (now or per scheduled run).
    'max_sample_rows' => 25,
    // Most data autopilots one customer can have (0 = no limit).
    'max_autopilots_per_customer' => 10,
];
