<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AgentUiAction extends Model
{
    protected $table = 'agent_ui_actions';

    protected $fillable = ['task_id', 'user_id', 'correlation_id', 'action', 'payload', 'status', 'result', 'acked_at'];

    protected $casts = [
        'payload' => 'array',
        'result' => 'array',
        'acked_at' => 'datetime',
    ];

    public function task(): BelongsTo
    {
        return $this->belongsTo(AgentTask::class, 'task_id');
    }
}
