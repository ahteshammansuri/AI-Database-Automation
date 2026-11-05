<?php

namespace App\Jobs;

use App\Models\DbConnection;
use App\Services\Data\TableInsightService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeUniqueUntilProcessing;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;

/**
 * Reads one table with the customer's model in the background, one step per job (TableInsightService::analyze), and
 * queues the next step until every column is read; each step stays below the queue's retry_after. Runs on the
 * `insights` queue, which the worker serves after `default`, so publishing and generation never wait behind it. The
 * owner and the connection are checked again before every step.
 */
class AnalyzeTableInsightsJob implements ShouldQueue, ShouldBeUniqueUntilProcessing
{
    use Dispatchable, InteractsWithQueue, Queueable;

    /** The model calls of one step (reading a batch, then checking doubtful links) end within this many seconds. */
    public const STEP_SECONDS = 600;

    public int $timeout = 650;
    public int $tries = 1;
    public int $uniqueFor = 900;

    public function __construct(
        public int $connectionId,
        public int $userId,
        public string $table,
    ) {
        $this->onQueue('insights');
    }

    public function uniqueId(): string
    {
        return "{$this->connectionId}:{$this->table}";
    }

    public function handle(TableInsightService $insights): void
    {
        $connection = DbConnection::where('id', $this->connectionId)->where('user_id', $this->userId)->first();
        if (!$connection || !$connection->is_active) {
            return;
        }
        if ($insights->analyze($connection, $this->table)) {
            self::dispatch($this->connectionId, $this->userId, $this->table);
        }
    }
}
