<?php

namespace App\Models;

use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** AI sample rows added to a table on a schedule (see RunDataAutopilotJob). */
class DataAutopilot extends Model
{
    public const FREQUENCIES = ['hourly', 'daily', 'weekly'];
    /** Consecutive failed runs after which the autopilot pauses itself. */
    public const PAUSE_AFTER_FAILURES = 3;

    protected $fillable = [
        'user_id', 'connection_id', 'table_name', 'name', 'rows_per_run', 'instructions', 'frequency', 'every_hours',
        'run_time', 'weekdays', 'timezone', 'ends_on', 'is_active', 'next_run_at', 'last_run_at', 'last_status',
        'last_message', 'last_change_id', 'runs_count', 'rows_added', 'failures_in_a_row',
    ];

    protected function casts(): array
    {
        return [
            'weekdays' => 'array',
            'is_active' => 'boolean',
            'ends_on' => 'date',
            'next_run_at' => 'datetime',
            'last_run_at' => 'datetime',
            'rows_per_run' => 'integer',
            'every_hours' => 'integer',
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

    /** The first run strictly after $after (UTC), or null when the schedule has ended. */
    public function nextRunAfter(?\DateTimeInterface $after = null): ?CarbonImmutable
    {
        $tz = in_array($this->timezone, timezone_identifiers_list(), true) ? $this->timezone : 'UTC';
        $after = CarbonImmutable::instance($after ?? now())->setTimezone($tz);

        if ($this->frequency === 'hourly') {
            $next = $after->addHours(max(1, (int) $this->every_hours))->startOfMinute();
        } else {
            [$h, $m] = array_map('intval', explode(':', $this->run_time ?: '09:00') + [1 => 0]);
            $next = null;
            for ($d = 0; $d <= 8; $d++) {
                $candidate = $after->startOfDay()->addDays($d)->setTime($h, $m);
                if ($candidate->lte($after)) {
                    continue;
                }
                if ($this->frequency === 'weekly' && !in_array($candidate->isoWeekday(), (array) ($this->weekdays ?: [1]), true)) {
                    continue;
                }
                $next = $candidate;
                break;
            }
        }
        if (!$next || ($this->ends_on && $next->toDateString() > $this->ends_on->toDateString())) {
            return null;
        }
        return $next->utc();
    }

    public function describeSchedule(): string
    {
        return match ($this->frequency) {
            'hourly' => (int) $this->every_hours === 1 ? 'Every hour' : "Every {$this->every_hours} hours",
            'weekly' => 'Every ' . implode(', ', array_map(fn ($d) => ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][(int) $d] ?? '?', (array) ($this->weekdays ?: [1]))) . " at {$this->run_time}",
            default => "Every day at {$this->run_time}",
        } . " ({$this->timezone})";
    }
}
