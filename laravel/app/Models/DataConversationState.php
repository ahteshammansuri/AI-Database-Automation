<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class DataConversationState extends Model
{
    use HasFactory;

    protected $fillable = [
        'user_id',
        'active_connection_id',
        'active_table',
        'last_result_id',
        'last_query_plan',
        'pending_clarification',
    ];

    protected $casts = [
        'last_query_plan' => 'array',
        'pending_clarification' => 'array',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function activeConnection(): BelongsTo
    {
        return $this->belongsTo(DbConnection::class, 'active_connection_id');
    }
}
