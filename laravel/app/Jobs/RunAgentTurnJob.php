<?php

namespace App\Jobs;

use App\Models\AgentTask;
use App\Services\Agent\AgentOrchestrator;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

/**
 * Runs one Orbit turn in the background so work continues if the browser closes.
 * Persisted on the database queue ("agent"), so it also survives application restarts.
 */
class RunAgentTurnJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    /** Above orbit.max_turn_seconds (1500) and below the agent worker's --timeout (1600). */
    public int $timeout = 1560;
    public int $tries = 1;

    public function __construct(public int $taskId, public string $turnId)
    {
        $this->onQueue('agent');
        if (config('queue.default') === 'database') {
            $this->onConnection('agent');
        }
    }

    public function handle(AgentOrchestrator $orchestrator): void
    {
        $orchestrator->runTurn($this->taskId, $this->turnId);
    }

    public function failed(\Throwable $e): void
    {
        $task = AgentTask::find($this->taskId);
        if ($task && $task->current_turn_id === $this->turnId && in_array($task->status, ['QUEUED', 'RUNNING'], true)) {
            $task->update(['status' => 'FAILED', 'stage' => 'DONE', 'error_message' => 'The background worker stopped before this turn finished.']);
            app(AgentOrchestrator::class)->broadcastTaskUpdate($task);
        }
    }
}
