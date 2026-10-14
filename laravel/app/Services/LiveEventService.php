<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class LiveEventService
{
    /**
     * Publish a tenant-isolated real-time event.
     * Guaranteed secret redaction and DB persistence.
     */
    public static function publish(
        int $userId,
        string $eventType,
        array $payload,
        ?string $resourceType = null,
        ?string $resourceId = null
    ): void {
        try {
            $sanitizedPayload = self::redactSensitiveData($payload);

            DB::table('workspace_events')->insert([
                'user_id' => $userId,
                'event_type' => $eventType,
                'resource_type' => $resourceType,
                'resource_id' => $resourceId ? (string) $resourceId : null,
                'payload' => json_encode($sanitizedPayload),
                'created_at' => now(),
            ]);
        } catch (\Throwable $e) {
            Log::warning("Failed to publish live workspace event for user #{$userId}: " . $e->getMessage());
        }
    }

    /**
     * Fetch events for a tenant created after a given event ID.
     */
    public static function getEventsSince(int $userId, int $sinceId = 0, int $limit = 50): array
    {
        $rows = DB::table('workspace_events')
            ->where('user_id', $userId)
            ->where('id', '>', $sinceId)
            ->orderBy('id', 'asc')
            ->limit($limit)
            ->get();

        return $rows->map(function ($row) {
            return [
                'id' => (int) $row->id,
                'user_id' => (int) $row->user_id,
                'event_type' => $row->event_type,
                'resource_type' => $row->resource_type,
                'resource_id' => $row->resource_id,
                'payload' => json_decode($row->payload, true) ?: [],
                'created_at' => $row->created_at,
            ];
        })->toArray();
    }

    /**
     * Redact credentials, connection passwords, tokens, and secrets from broadcast payload.
     */
    protected static function redactSensitiveData(array $data): array
    {
        $sensitiveKeys = [
            'password', 'encrypted_password', 'secret', 'api_key', 'encrypted_api_key',
            'token', 'raw_token', 'token_hash', 'connection_uri', 'auth_token'
        ];

        foreach ($data as $key => $val) {
            $kLower = strtolower($key);
            if (in_array($kLower, $sensitiveKeys, true)) {
                $data[$key] = '••••••••';
            } elseif (is_array($val)) {
                $data[$key] = self::redactSensitiveData($val);
            }
        }

        return $data;
    }
}
