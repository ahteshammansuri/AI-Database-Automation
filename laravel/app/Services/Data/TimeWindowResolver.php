<?php

namespace App\Services\Data;

use Carbon\Carbon;

class TimeWindowResolver
{
    /**
     * Resolve a natural language or structured time window descriptor into concrete bounds.
     *
     * @param string|array|null $window 'today' | 'yesterday' | 'this_week' | 'last_7_days' | array
     * @param string $timezone e.g. 'Asia/Kolkata', 'UTC'
     * @return array{label: string, timezone: string, from_iso: string, to_iso: string, from_utc: string, to_utc: string}
     */
    public static function resolve(string|array|null $window, string $timezone = 'Asia/Kolkata'): array
    {
        $tz = self::normalizeTimezone($timezone);
        $now = Carbon::now($tz);

        $label = 'today';
        $from = null;
        $to = null;

        if (is_array($window)) {
            $label = (string) ($window['label'] ?? 'custom');
            $rawFrom = $window['from'] ?? null;
            $rawTo = $window['to'] ?? null;

            if ($rawFrom === 'start_of_day' || $label === 'today') {
                $from = $now->copy()->startOfDay();
                $to = $now->copy()->endOfDay();
                $label = 'today';
            } elseif ($rawFrom === 'start_of_yesterday' || $label === 'yesterday') {
                $from = $now->copy()->subDay()->startOfDay();
                $to = $now->copy()->subDay()->endOfDay();
                $label = 'yesterday';
            } elseif ($rawFrom) {
                try {
                    $from = Carbon::parse($rawFrom, $tz);
                } catch (\Throwable) {
                    $from = $now->copy()->startOfDay();
                }
                try {
                    $to = $rawTo ? Carbon::parse($rawTo, $tz) : $now->copy()->endOfDay();
                } catch (\Throwable) {
                    $to = $now->copy()->endOfDay();
                }
            } else {
                $from = $now->copy()->startOfDay();
                $to = $now->copy()->endOfDay();
            }
        } elseif (is_string($window)) {
            $w = strtolower(trim($window));
            $label = $w;
            switch ($w) {
                case 'yesterday':
                    $from = $now->copy()->subDay()->startOfDay();
                    $to = $now->copy()->subDay()->endOfDay();
                    break;
                case 'this_week':
                case 'this week':
                    $from = $now->copy()->startOfWeek();
                    $to = $now->copy()->endOfWeek();
                    $label = 'this_week';
                    break;
                case 'last_week':
                case 'last week':
                    $from = $now->copy()->subWeek()->startOfWeek();
                    $to = $now->copy()->subWeek()->endOfWeek();
                    $label = 'last_week';
                    break;
                case 'last_7_days':
                case 'last 7 days':
                    $from = $now->copy()->subDays(7)->startOfDay();
                    $to = $now->copy()->endOfDay();
                    $label = 'last_7_days';
                    break;
                case 'this_month':
                case 'this month':
                    $from = $now->copy()->startOfMonth();
                    $to = $now->copy()->endOfMonth();
                    $label = 'this_month';
                    break;
                case 'last_30_days':
                case 'last 30 days':
                    $from = $now->copy()->subDays(30)->startOfDay();
                    $to = $now->copy()->endOfDay();
                    $label = 'last_30_days';
                    break;
                case 'today':
                default:
                    $from = $now->copy()->startOfDay();
                    $to = $now->copy()->endOfDay();
                    $label = 'today';
                    break;
            }
        } else {
            $from = $now->copy()->startOfDay();
            $to = $now->copy()->endOfDay();
        }

        return [
            'label' => $label,
            'timezone' => $tz,
            'from_iso' => $from->format('Y-m-d H:i:s'),
            'to_iso' => $to->format('Y-m-d H:i:s'),
            'from_utc' => $from->copy()->utc()->format('Y-m-d H:i:s'),
            'to_utc' => $to->copy()->utc()->format('Y-m-d H:i:s'),
        ];
    }

    /**
     * Choose the most appropriate timestamp column for time-relative filters.
     */
    public static function detectTimestampColumn(array $tableColumns): ?string
    {
        // 1. Check for temporal_role 'created'
        foreach ($tableColumns as $col => $meta) {
            if (($meta['temporal_role'] ?? null) === 'created') {
                return $col;
            }
        }

        // 2. Fallback to common naming
        $candidates = ['created_at', 'crt_dt', 'creation_date', 'registered_at', 'reg_dt', 'signup_date', 'timestamp', 'created_on'];
        foreach ($candidates as $cand) {
            if (isset($tableColumns[$cand])) {
                return $cand;
            }
        }

        // 3. Any column with temporal_role
        foreach ($tableColumns as $col => $meta) {
            if (!empty($meta['temporal_role'])) {
                return $col;
            }
        }

        return null;
    }

    private static function normalizeTimezone(string $tz): string
    {
        $tz = trim($tz);
        if (in_array($tz, \DateTimeZone::listIdentifiers(), true)) {
            return $tz;
        }
        return 'Asia/Kolkata';
    }
}
