<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AgentToolCall extends Model
{
    protected $table = 'agent_tool_calls';

    protected $fillable = [
        'task_id', 'user_id', 'turn_id', 'plan_version', 'iteration', 'tool', 'tool_version',
        'args_redacted', 'args_hash', 'status', 'error_category', 'side_effect_committed', 'verified',
        'result_sanitized', 'trace_id', 'idempotency_key', 'started_at', 'finished_at',
    ];

    protected $casts = [
        'args_redacted' => 'array',
        'result_sanitized' => 'array',
        'side_effect_committed' => 'boolean',
        'verified' => 'boolean',
        'started_at' => 'datetime',
        'finished_at' => 'datetime',
    ];

    public function task(): BelongsTo
    {
        return $this->belongsTo(AgentTask::class, 'task_id');
    }
}
