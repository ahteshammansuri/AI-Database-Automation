<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Prunable;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A phone paired with one DataAuto tab (see OrbitRemoteService). Codes and device tokens are stored hashed.
 */
class OrbitRemoteSession extends Model
{
    use Prunable;

    protected $fillable = [
        'user_id', 'public_id', 'status', 'pairing_code_hash', 'pairing_expires_at', 'device_token_hash', 'device_label',
        'device_ip', 'desktop_instance', 'desktop_token_id', 'desktop_label', 'desktop_state', 'claimed_at', 'last_device_seen_at',
        'last_desktop_seen_at', 'expires_at', 'ended_at', 'end_reason',
    ];

    protected $hidden = ['pairing_code_hash', 'device_token_hash', 'device_ip', 'desktop_instance', 'desktop_token_id'];

    protected function casts(): array
    {
        return [
            'desktop_state' => 'array',
            'pairing_expires_at' => 'datetime',
            'claimed_at' => 'datetime',
            'last_device_seen_at' => 'datetime',
            'last_desktop_seen_at' => 'datetime',
            'expires_at' => 'datetime',
            'ended_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function commands(): HasMany
    {
        return $this->hasMany(OrbitRemoteCommand::class, 'session_id');
    }

    /** Ended sessions (and pairings nobody scanned) are removed after a week. */
    public function prunable()
    {
        return static::where(fn ($q) => $q->where('status', 'ended')->where('ended_at', '<', now()->subDays(7)))
            ->orWhere(fn ($q) => $q->where('status', 'pending')->where('created_at', '<', now()->subDays(7)));
    }
}
