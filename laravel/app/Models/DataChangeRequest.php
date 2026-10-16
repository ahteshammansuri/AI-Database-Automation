<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class DataChangeRequest extends Model
{
    use HasFactory;

    protected $fillable = [
        'user_id',
        'connection_id',
        'task_id',
        'action',
        'target_table',
        'primary_keys',
        'filter_spec',
        'patch_values',
        'affected_count',
        'preview_rows',
        'diff_summary',
        'impact_analysis',
        'confirmation_phrase',
        'status',
        'before_image',
        'after_image',
        'expires_at',
        'executed_at',
        'undone_at',
    ];

    protected $casts = [
        'primary_keys' => 'array',
        'filter_spec' => 'array',
        'patch_values' => 'array',
        'preview_rows' => 'array',
        'diff_summary' => 'array',
        'impact_analysis' => 'array',
        'before_image' => 'encrypted',
        'after_image' => 'encrypted',
        'expires_at' => 'datetime',
        'executed_at' => 'datetime',
        'undone_at' => 'datetime',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function connection(): BelongsTo
    {
        return $this->belongsTo(DbConnection::class, 'connection_id');
    }

    public function task(): BelongsTo
    {
        return $this->belongsTo(AgentTask::class, 'task_id');
    }
}
