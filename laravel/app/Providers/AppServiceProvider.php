<?php

namespace App\Providers;

use App\Admin\AdminActivity;
use App\Admin\SystemHealth;
use App\Models\Admin;
use App\Services\Agent\AgentQueueStatus;
use App\Settings\PlatformSettings;
use Illuminate\Auth\Events\Login;
use Illuminate\Console\Events\ScheduledTaskStarting;
use Illuminate\Queue\Events\JobProcessing;
use Illuminate\Queue\Events\Looping;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Gate;
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
        // Settings saved in the admin panel override config (see App\Settings\PlatformSettings).
        PlatformSettings::boot();

        // Super admins may do everything in the admin panel; other admins only what their roles allow.
        Gate::before(fn ($user) => $user instanceof Admin && $user->isSuperAdmin() ? true : null);

        Event::listen(Login::class, function (Login $e) {
            if ($e->guard === 'admin' && $e->user instanceof Admin) {
                $e->user->forceFill(['last_login_at' => now(), 'last_login_ip' => request()->ip()])->saveQuietly();
                AdminActivity::record('admin.signed_in', $e->user);
            }
        });

        // Orbit agent workers report liveness so a queued turn can say whether anything will pick it up.
        Event::listen(Looping::class, function (Looping $e) {
            SystemHealth::workerBeat((string) $e->queue);
            if (str_contains((string) $e->queue, 'agent')) {
                AgentQueueStatus::workerHeartbeat();
            }
        });
        // The admin panel's System health page shows whether the scheduler is running.
        Event::listen(ScheduledTaskStarting::class, fn () => SystemHealth::schedulerBeat());
        // AI usage attribution belongs to one request; a long-lived server must not carry it into the next one.
        Event::listen(\Illuminate\Foundation\Http\Events\RequestHandled::class, fn () => \App\Services\AiUsage::reset());
        Event::listen(JobProcessing::class, function (JobProcessing $e) {
            // Workers run for hours: pick up settings an admin changed since this worker started.
            PlatformSettings::refreshIfStale();
            \App\Services\AiUsage::reset();
            if (str_contains((string) $e->job->getQueue(), 'agent')) {
                AgentQueueStatus::workerHeartbeat();
            }
        });
    }
}
