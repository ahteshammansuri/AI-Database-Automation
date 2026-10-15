<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class AutomationExecution extends Model
{
    use HasFactory;

    protected $table = 'automation_executions';

    protected $fillable = [
        'user_id',
        'automation_id',
        'status',
        'idempotency_key',
        'generation_started_at',
        'generation_completed_at',
        'publication_time',
        'published_at',
        'queue_wait_ms',
        'execution_duration_ms',
        'lease_expires_at',
        'retry_count',
        'max_retries',
        'failure_category',
        'error_message',
        'target_record_id',
        'result_details',
        'timeline_events',
        'relation_resolutions',
    ];

    protected $appends = ['payload', 'timeline'];

    public function getPayloadAttribute(): array
    {
        if (!empty($this->result_details['payload']) && is_array($this->result_details['payload'])) {
            return $this->result_details['payload'];
        }
        $latestVersion = $this->relationLoaded('versions') 
            ? $this->versions->last() 
            : $this->versions()->latest('version_number')->first();
        if ($latestVersion && !empty($latestVersion->payload)) {
            return $latestVersion->payload;
        }
        return is_array($this->result_details) ? $this->result_details : [];
    }

    public function getTimelineAttribute(): array
    {
        return $this->timeline_events ?? [];
    }

    protected static function booted(): void
    {
        static::creating(function (AutomationExecution $execution) {
            if (empty($execution->idempotency_key)) {
                $execution->idempotency_key = (string) \Illuminate\Support\Str::uuid();
            }
        });
    }

    protected function casts(): array
    {
        return [
            'generation_started_at' => 'datetime',
            'generation_completed_at' => 'datetime',
            'publication_time' => 'datetime',
            'published_at' => 'datetime',
            'lease_expires_at' => 'datetime',
            'queue_wait_ms' => 'integer',
            'execution_duration_ms' => 'integer',
            'retry_count' => 'integer',
            'max_retries' => 'integer',
            'result_details' => 'array',
            'timeline_events' => 'array',
            'relation_resolutions' => 'array',
        ];
    }

    /**
     * Append a structured event to this execution's timeline.
     */
    public function addTimelineEvent(string $stage, string $message, ?array $metadata = null): void
    {
        $events = $this->timeline_events ?? [];
        $events[] = [
            'timestamp' => now()->toIso8601String(),
            'stage' => $stage,
            'message' => $message,
            'metadata' => $metadata,
        ];
        $this->timeline_events = $events;
        $this->saveQuietly();
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function automation(): BelongsTo
    {
        return $this->belongsTo(Automation::class);
    }

    public function versions(): HasMany
    {
        return $this->hasMany(ContentVersion::class, 'execution_id');
    }
}
