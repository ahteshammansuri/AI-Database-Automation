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

    public function timelineEvents(): HasMany
    {
        return $this->hasMany(AgentTaskTimelineEvent::class, 'task_id')->orderBy('id', 'asc');
    }
}
