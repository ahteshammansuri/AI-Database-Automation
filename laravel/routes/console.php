<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Schedule::command('automations:check-schedule')->everyMinute();
// Data autopilot: scheduled AI sample rows.
Schedule::command('data:run-autopilots')->everyMinute()->withoutOverlapping();
// Orbit's product knowledge lives in the database; a fresh or wiped AI service gets the published guides again.
Schedule::command('orbit:sync-knowledge')->everyTenMinutes()->withoutOverlapping();


// Orbit Remote: remove ended phone sessions (and unscanned codes) after a week.
Schedule::command('model:prune', ['--model' => [\App\Models\OrbitRemoteSession::class]])->daily();
