<?php

namespace App\Providers;

use App\Services\Agent\AgentQueueStatus;
use Illuminate\Queue\Events\JobProcessing;
use Illuminate\Queue\Events\Looping;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // Orbit agent workers report liveness so a queued turn can say whether anything will pick it up.
        Event::listen(Looping::class, function (Looping $e) {
            if (str_contains((string) $e->queue, 'agent')) {
                AgentQueueStatus::workerHeartbeat();
            }
        });
        Event::listen(JobProcessing::class, function (JobProcessing $e) {
            if (str_contains((string) $e->job->getQueue(), 'agent')) {
                AgentQueueStatus::workerHeartbeat();
            }
        });
    }
}
