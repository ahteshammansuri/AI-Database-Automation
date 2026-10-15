<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Automation extends Model
{
    use HasFactory;

    protected $table = 'automations';

    protected $fillable = [
        'user_id',
        'connection_id',
        'name',
        'target_table',
        'operation_mode',
        'field_mappings',
        'ai_provider',
        'ai_model',
        'prompt_context',
        'knowledge_document_ids',
        'schedule_type',
        'generation_time',
        'publication_time',
        'timezone',
        'start_date',
        'requires_approval',
        'reviewer_email',
        'timeout_policy',
        'safe_deadline_policy',
        'is_active',
    ];

    protected $attributes = [
        'field_mappings' => '[]',
        'operation_mode' => 'AI_CREATE',
        'schedule_type' => 'DAILY',
        'generation_time' => '08:00',
        'publication_time' => '09:00',
        'timezone' => 'UTC',
        'requires_approval' => true,
        'is_active' => true,
    ];

    protected $appends = [
        'lead_time_minutes',
    ];

    public function getLeadTimeMinutesAttribute(): int
    {
        if (empty($this->generation_time) || empty($this->publication_time)) {
            return 30;
        }

        try {
            $gen = \Carbon\Carbon::createFromFormat('H:i', substr($this->generation_time, 0, 5));
            $pub = \Carbon\Carbon::createFromFormat('H:i', substr($this->publication_time, 0, 5));
            if ($pub->lt($gen)) {
                $pub->addDay();
            }
            return (int) $gen->diffInMinutes($pub);
        } catch (\Throwable $e) {
            return 30;
        }
    }

    protected function casts(): array
    {
        return [
            'field_mappings' => 'array',
            'knowledge_document_ids' => 'array',
            'requires_approval' => 'boolean',
            'is_active' => 'boolean',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function connection(): BelongsTo
    {
        return $this->belongsTo(DbConnection::class, 'connection_id');
    }

    public function executions(): HasMany
    {
        return $this->hasMany(AutomationExecution::class, 'automation_id');
    }
}
