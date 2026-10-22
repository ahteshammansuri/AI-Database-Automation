<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * A queue job that failed (Laravel's failed_jobs table). Only the job name and the error's first line are shown:
 * payloads and stack traces can contain customer data.
 */
class FailedJob extends Model
{
    public $timestamps = false;

    protected function casts(): array
    {
        return ['failed_at' => 'datetime'];
    }

    public function jobName(): string
    {
        return class_basename((string) (json_decode((string) $this->payload, true)['displayName'] ?? 'Unknown job'));
    }

    public function errorLine(): string
    {
        $first = strtok((string) $this->exception, "\n") ?: '';
        return mb_substr(trim($first), 0, 400);
    }
}
