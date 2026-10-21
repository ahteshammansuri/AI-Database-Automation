<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** A request sent from a paired phone to the web Orbit ("say" = a spoken or typed request, "stop" = stop the task). */
class OrbitRemoteCommand extends Model
{
    protected $fillable = ['session_id', 'user_id', 'kind', 'text', 'status', 'reason', 'received_at'];

    protected function casts(): array
    {
        return ['received_at' => 'datetime'];
    }

    public function session(): BelongsTo
    {
        return $this->belongsTo(OrbitRemoteSession::class, 'session_id');
    }
}
