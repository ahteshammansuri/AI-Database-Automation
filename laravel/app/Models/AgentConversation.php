<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class AgentConversation extends Model
{
    use HasFactory;

    protected $table = 'agent_conversations';

    protected $fillable = [
        'user_id',
        'title',
        'status',
        'metadata',
    ];

    protected $casts = [
        'metadata' => 'array',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function messages(): HasMany
    {
        return $this->hasMany(AgentMessage::class, 'conversation_id')->orderBy('id', 'asc');
    }

    public function tasks(): HasMany
    {
        return $this->hasMany(AgentTask::class, 'conversation_id')->orderBy('id', 'desc');
    }

    public function latestTask(): ?AgentTask
    {
        return $this->tasks()->first();
    }
}
