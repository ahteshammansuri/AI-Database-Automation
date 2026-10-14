<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ContentVersion extends Model
{
    use HasFactory;

    protected $table = 'content_versions';

    protected $fillable = [
        'user_id',
        'execution_id',
        'version_number',
        'payload',
        'rejection_feedback',
        'status',
    ];

    protected function casts(): array
    {
        return [
            'version_number' => 'integer',
            'payload' => 'array',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function execution(): BelongsTo
    {
        return $this->belongsTo(AutomationExecution::class, 'execution_id');
    }

    public function approvalTokens(): HasMany
    {
        return $this->hasMany(ApprovalToken::class, 'version_id');
    }
}
