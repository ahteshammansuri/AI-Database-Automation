<?php

namespace App\Services\Agent;

use App\Models\AgentTask;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * Honest status for a queued Orbit turn: how many agent turns are ahead of it and
 * whether any agent worker is alive to run it (instead of an open-ended "starting").
 */
class AgentQueueStatus
{
    protected const HEARTBEAT_KEY = 'orbit-agent-worker-heartbeat';
    protected const HEARTBEAT_TTL = 90;

    public static function workerHeartbeat(): void
    {
        Cache::put(self::HEARTBEAT_KEY, now()->timestamp, self::HEARTBEAT_TTL);
    }

    /**
     * @return array{position: int, ahead: int, running: int, worker_alive: bool}|null  null when not waiting in a queue
     */
    public static function forTask(AgentTask $task): ?array
    {
        if ($task->status !== 'QUEUED' || config('queue.default') !== 'database' || !$task->current_turn_id) {
            return null;
        }

        $jobs = DB::table('jobs')->where('queue', 'agent');
        $ownId = (clone $jobs)->where('payload', 'like', '%' . $task->current_turn_id . '%')->value('id');
        $running = (clone $jobs)->whereNotNull('reserved_at')->count();
        $ahead = $ownId ? (clone $jobs)->where('id', '<', $ownId)->count() : 0;
        $beat = Cache::get(self::HEARTBEAT_KEY);
        $alive = ($beat && now()->timestamp - (int) $beat <= self::HEARTBEAT_TTL) || $running > 0;

        return ['position' => $ahead + 1, 'ahead' => $ahead, 'running' => $running, 'worker_alive' => $alive];
    }
}
