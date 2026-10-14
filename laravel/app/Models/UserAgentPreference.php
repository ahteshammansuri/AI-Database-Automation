<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class UserAgentPreference extends Model
{
    use HasFactory;

    protected $table = 'user_agent_preferences';

    protected $fillable = [
        'user_id',
        'autonomy_level',
        'voice_enabled',
        'preferred_model',
    ];

    protected $casts = [
        'voice_enabled' => 'boolean',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
