<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * Short-lived encrypted secret captured through the secure channel (masked field or
 * redacted utterance). Only SecretVault reads the payload; it is never serialized.
 */
class AgentSecureInput extends Model
{
    protected $table = 'agent_secure_inputs';

    protected $fillable = ['handle', 'user_id', 'task_id', 'kind', 'payload', 'expires_at', 'consumed_at'];

    protected $hidden = ['payload'];

    protected $casts = [
        'payload' => 'encrypted:array',
        'expires_at' => 'datetime',
        'consumed_at' => 'datetime',
    ];
}
