<?php

namespace App\Jobs;

use App\Models\AuditLog;
use App\Models\DataAutopilot;
use App\Models\DbConnection;
use App\Services\Data\DataChangeService;
use App\Services\Data\SampleDataService;
use App\Services\FeatureFlagService;
use App\Services\LiveEventService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Cache;

/**
 * One data autopilot run: AI sample rows for the table, every value validated, added in one transaction and recorded
 * as a data change (undoable for a day). The owner confirmed this when they set the autopilot up.
 */
class RunDataAutopilotJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 1;
    public int $timeout = 330;

    public function __construct(public int $autopilotId)
    {
        $this->onQueue('default');
    }

    public function handle(SampleDataService $samples, DataChangeService $changes): void
    {
        $lock = Cache::lock("data-autopilot:{$this->autopilotId}", $this->timeout + 30);
        if (!$lock->get()) {
            return; // another run of this autopilot is in progress
        }
        try {
            $this->run($samples, $changes);
        } finally {
            $lock->release();
        }
    }

    private function run(SampleDataService $samples, DataChangeService $changes): void
    {
        $pilot = DataAutopilot::with(['user', 'connection'])->find($this->autopilotId);
        if (!$pilot || !$pilot->is_active || !$pilot->user || !$pilot->connection) {
            return;
        }
        // Ownership is checked again in the background: the connection must belong to the autopilot's owner.
        if ((int) $pilot->connection->user_id !== (int) $pilot->user_id || $pilot->user->isSuspended()) {
            $pilot->update(['is_active' => false, 'last_status' => 'failed', 'last_message' => 'Paused: the connection or account is no longer available.']);
            return;
        }
        $flags = app(FeatureFlagService::class);
        if (!$flags->isEnabled('FEATURE_DATA_AUTOPILOT') || !$flags->isEnabled('FEATURE_DATA_MANAGER')) {
            $pilot->update(['next_run_at' => $pilot->nextRunAfter(), 'last_message' => 'Skipped: data autopilot is turned off by the administrator.']);
            return;
        }

        $status = 'failed';
        $message = '';
        $changeId = null;
        $added = 0;
        try {
            $gen = $samples->generate($pilot->connection, $pilot->user, $pilot->table_name, (int) $pilot->rows_per_run, (string) $pilot->instructions);
            if (!$gen['rows']) {
                $message = 'No usable rows came back' . ($gen['error'] ? ': ' . $gen['error'] : '.');
            } else {
                $preview = $changes->previewInsert($pilot->connection, $pilot->user, $pilot->table_name, $gen['rows'], 'autopilot');
                if (!$preview['success']) {
                    $message = 'The rows did not pass the final check.';
                } else {
                    $result = $changes->executeChange($pilot->user, $preview['change_request_id']);
                    $added = (int) ($result['affected_count'] ?? 0);
                    $changeId = $preview['change_request_id'];
                    $status = 'added';
                    $message = "Added {$added} row(s)" . ($gen['dropped'] ? '; ' . count($gen['dropped']) . ' proposed row(s) failed the checks and were left out.' : '.');
                }
            }
        } catch (\Throwable $e) {
            $message = DbConnection::explainFailure($e, $pilot->connection);
        }

        $failures = $status === 'added' ? 0 : $pilot->failures_in_a_row + 1;
        $pause = $failures >= DataAutopilot::PAUSE_AFTER_FAILURES;
        $next = $pilot->nextRunAfter();
        $pilot->update([
            'last_run_at' => now(),
            'last_status' => $status,
            'last_message' => mb_substr($pause ? $message . ' Paused after ' . $failures . ' failed runs in a row.' : $message, 0, 1000),
            'last_change_id' => $changeId,
            'runs_count' => $pilot->runs_count + 1,
            'rows_added' => $pilot->rows_added + $added,
            'failures_in_a_row' => $failures,
            'is_active' => $pause ? false : ($next !== null),
            'next_run_at' => $pause ? null : $next,
        ]);

        AuditLog::log($pilot->user_id, $status === 'added' ? 'DATA_AUTOPILOT_RAN' : 'DATA_AUTOPILOT_FAILED', 'DataAutopilot', (string) $pilot->id, [
            'table' => $pilot->table_name, 'rows' => $added, 'change_request_id' => $changeId, 'paused' => $pause,
        ]);
        LiveEventService::publish($pilot->user_id, 'data.autopilot_ran', [
            'autopilot_id' => $pilot->id, 'status' => $status, 'rows' => $added, 'message' => $message,
        ], 'DataAutopilot', (string) $pilot->id);
    }
}
