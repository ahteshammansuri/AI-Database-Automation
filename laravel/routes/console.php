<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Schedule::command('automations:check-schedule')->everyMinute();


// Orbit Remote: remove ended phone sessions (and unscanned codes) after a week.
Schedule::command('model:prune', ['--model' => [\App\Models\OrbitRemoteSession::class]])->daily();
