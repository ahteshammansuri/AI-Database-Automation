<?php

namespace App\Console\Commands;

use App\Jobs\RunDataAutopilotJob;
use App\Models\DataAutopilot;
use App\Services\FeatureFlagService;
use Illuminate\Console\Command;

/** Every minute: queue the data autopilots that are due (their next run moves on before they are queued). */
class RunDataAutopilotsCommand extends Command
{
    protected $signature = 'data:run-autopilots';

    protected $description = 'Queue the data autopilots (scheduled AI sample rows) that are due';

    public function handle(): int
    {
        if (!app(FeatureFlagService::class)->isEnabled('FEATURE_DATA_AUTOPILOT')) {
            return self::SUCCESS;
        }
        $due = DataAutopilot::where('is_active', true)->whereNotNull('next_run_at')->where('next_run_at', '<=', now())->limit(200)->get();
        foreach ($due as $pilot) {
            // Claim this occurrence: only one scheduler tick queues it.
            $claimed = DataAutopilot::whereKey($pilot->id)->where('next_run_at', $pilot->next_run_at)
                ->update(['next_run_at' => $pilot->nextRunAfter(now())]);
            if ($claimed) {
                RunDataAutopilotJob::dispatch($pilot->id);
            }
        }
        $this->line(count($due) . ' due');
        return self::SUCCESS;
    }
}
