<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class AgentTask extends Model
{
    use HasFactory;

    protected $table = 'agent_tasks';

    /** States of a task that is not finished: a new utterance in its conversation continues it. */
    public const OPEN_STATUSES = ['QUEUED', 'RUNNING', 'WAITING_FOR_INPUT', 'WAITING_FOR_APPROVAL', 'PAUSE_REQUESTED', 'PAUSED'];

    protected $fillable = [
        'user_id',
        'conversation_id',
        'task_type',
        'goal',
        'status',
        'autonomy_level',
        'active_plan',
        'slots',
        'current_step_index',
        'plan_version',
        'stage',
        'iteration_count',
        'current_turn_id',
        'turn_started_at',
        'pending_user_turn',
        'pending_tool_call',
        'page_context',
        'last_decision',
        'final_verification',
        'idempotency_key',
        'target_resource_type',
        'target_resource_id',
        'error_message',
        'cancelled_at',
        'paused_at',
        'completed_at',
    ];

    protected $casts = [
        'active_plan' => 'array',
        'slots' => 'array',
        'current_step_index' => 'integer',
        'plan_version' => 'integer',
        'iteration_count' => 'integer',
        'turn_started_at' => 'datetime',
        'pending_user_turn' => 'boolean',
        'pending_tool_call' => 'array',
        'page_context' => 'array',
        'last_decision' => 'array',
        'final_verification' => 'array',
        'cancelled_at' => 'datetime',
        'paused_at' => 'datetime',
        'completed_at' => 'datetime',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function conversation(): BelongsTo
    {
        return $this->belongsTo(AgentConversation::class);
    }

    public function toolCalls(): HasMany
    {
        return $this->hasMany(AgentToolCall::class, 'task_id')->orderBy('id', 'asc');
    }

    public function timelineEvents(): HasMany
    {
        return $this->hasMany(AgentTaskTimelineEvent::class, 'task_id')->orderBy('id', 'asc');
    }
}
