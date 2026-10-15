<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AgentMessage extends Model
{
    use HasFactory;

    protected $table = 'agent_messages';

    public $timestamps = false; // Has created_at only

    protected $fillable = [
        'conversation_id',
        'role',
        'content',
        'tool_calls',
        'tool_results',
        'secure_input_type',
        'is_voice',
        'meta',
        'created_at',
    ];

    protected $casts = [
        'tool_calls' => 'array',
        'tool_results' => 'array',
        'is_voice' => 'boolean',
        'meta' => 'array',
        'created_at' => 'datetime',
    ];

    public function conversation(): BelongsTo
    {
        return $this->belongsTo(AgentConversation::class, 'conversation_id');
    }
}
