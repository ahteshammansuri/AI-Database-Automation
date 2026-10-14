<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AgentTaskTimelineEvent extends Model
{
    use HasFactory;

    protected $table = 'agent_task_timeline_events';

    public $timestamps = false;

    protected $fillable = [
        'task_id',
        'step_name',
        'status',
        'message',
        'details',
        'correlation_id',
        'created_at',
    ];

    protected $casts = [
        'details' => 'array',
        'created_at' => 'datetime',
    ];

    public function task(): BelongsTo
    {
        return $this->belongsTo(AgentTask::class, 'task_id');
    }
}
