<?php

namespace App\Services\Automation;

use App\Models\Automation;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use DateTimeZone;

/**
 * Pure schedule arithmetic for automations. All instants it returns are UTC; all wall-clock
 * reasoning (start/end dates, weekdays, generation/publication times) happens in the
 * automation's own IANA timezone, so DST shifts never move a run to the wrong local time.
 *
 * Schedule model:
 *  - ONE_TIME: exactly one run on start_date.
 *  - DAILY:    every day from start_date until end_date (inclusive, optional).
 *  - WEEKLY:   on the chosen ISO weekdays (1 = Mon .. 7 = Sun) between start_date and end_date.
 * Each run generates at generation_time and publishes at publication_time on the same local
 * date, or on the next day when publication_time is earlier on the clock than generation_time.
 */
class ScheduleCalculator
{
    public const MIN_GAP_MINUTES = 15;
    public const TYPES = ['ONE_TIME', 'DAILY', 'WEEKLY'];
    /** Container automations used by manual publishing; never run by the scheduler. */
    public const TYPE_NONE = 'NONE';

    /** Upper bound for forward searches (weekly schedules need at most 7 days; this covers long gaps). */
    private const SEARCH_HORIZON_DAYS = 400;
    /** Upper bound when counting a bounded schedule's runs. */
    private const MAX_COUNT_DAYS = 4000;

    private const WEEKDAY_NAMES = [1 => 'Monday', 2 => 'Tuesday', 3 => 'Wednesday', 4 => 'Thursday', 5 => 'Friday', 6 => 'Saturday', 7 => 'Sunday'];

    // ------------------------------------------------------------------
    // Normalisation helpers
    // ------------------------------------------------------------------

    public static function isValidTimezone(?string $tz): bool
    {
        return is_string($tz) && $tz !== '' && in_array($tz, DateTimeZone::listIdentifiers(DateTimeZone::ALL_WITH_BC), true);
    }

    /** Canonical IANA id; legacy aliases browsers still emit are mapped, anything invalid becomes UTC. */
    public static function normalizeTimezone(?string $tz): string
    {
        $tz = trim((string) $tz);
        if ($tz === 'Asia/Calcutta') {
            return 'Asia/Kolkata';
        }
        return self::isValidTimezone($tz) ? $tz : 'UTC';
    }

    /** @return array{0:int,1:int}|null [hour, minute] */
    public static function parseTime(mixed $time): ?array
    {
        if (!is_string($time) || !preg_match('/^(\d{1,2}):(\d{2})(?::\d{2})?$/', trim($time), $m)) {
            return null;
        }
        $h = (int) $m[1];
        $i = (int) $m[2];
        if ($h > 23 || $i > 59) {
            return null;
        }
        return [$h, $i];
    }

    public static function formatTime(mixed $time): ?string
    {
        $t = self::parseTime($time);
        return $t ? sprintf('%02d:%02d', $t[0], $t[1]) : null;
    }

    /**
     * Minutes from generation to publication on the wall clock. Publication earlier on the clock
     * than generation means "next day". Equal times return 0, which is never a valid schedule.
     */
    public static function gapMinutes(mixed $generationTime, mixed $publicationTime): ?int
    {
        $g = self::parseTime($generationTime);
        $p = self::parseTime($publicationTime);
        if (!$g || !$p) {
            return null;
        }
        $diff = ($p[0] * 60 + $p[1]) - ($g[0] * 60 + $g[1]);
        if ($diff < 0) {
            $diff += 1440;
        }
        return $diff;
    }

    public static function isValidDate(mixed $date): bool
    {
        if (!is_string($date) || !preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $date, $m)) {
            return false;
        }
        return checkdate((int) $m[2], (int) $m[3], (int) $m[1]);
    }

    public static function scheduleType(Automation $a): string
    {
        $t = strtoupper((string) $a->schedule_type);
        if ($t === self::TYPE_NONE) {
            return self::TYPE_NONE;
        }
        return in_array($t, self::TYPES, true) ? $t : 'DAILY';
    }

    public function timezone(Automation $a): string
    {
        return self::normalizeTimezone($a->timezone);
    }

    /** Local start date. Falls back to the local date the automation was created (or today). */
    public function startDate(Automation $a): string
    {
        $raw = $this->dateString($a->start_date);
        if ($raw !== null) {
            return $raw;
        }
        $base = $a->created_at ? CarbonImmutable::instance($a->created_at) : CarbonImmutable::now();
        return $base->setTimezone($this->timezone($a))->toDateString();
    }

    /** Local last date (inclusive) or null when open-ended. One-time schedules end on their start date. */
    public function endDate(Automation $a): ?string
    {
        if (self::scheduleType($a) === 'ONE_TIME') {
            return $this->startDate($a);
        }
        return $this->dateString($a->end_date);
    }

    /** @return int[] ISO weekdays this automation runs on (WEEKLY only). */
    public function weekdays(Automation $a): array
    {
        $days = is_array($a->weekly_days) ? $a->weekly_days : [];
        $days = array_values(array_unique(array_filter(array_map('intval', $days), fn($d) => $d >= 1 && $d <= 7)));
        sort($days);
        if (empty($days)) {
            $days = [CarbonImmutable::createFromFormat('!Y-m-d', $this->startDate($a), $this->timezone($a))->dayOfWeekIso];
        }
        return $days;
    }

    // ------------------------------------------------------------------
    // Occurrences
    // ------------------------------------------------------------------

    public function runsOnDate(Automation $a, string $localDate): bool
    {
        if (self::scheduleType($a) === self::TYPE_NONE) {
            return false;
        }
        $start = $this->startDate($a);
        $end = $this->endDate($a);
        if ($localDate < $start || ($end !== null && $localDate > $end)) {
            return false;
        }

        return match (self::scheduleType($a)) {
            'ONE_TIME' => $localDate === $start,
            'WEEKLY' => in_array(
                CarbonImmutable::createFromFormat('!Y-m-d', $localDate, $this->timezone($a))->dayOfWeekIso,
                $this->weekdays($a),
                true
            ),
            default => true,
        };
    }

    /**
     * The run that belongs to a local date (whether or not the schedule actually runs that day).
     *
     * @return array{run_date:string, timezone:string, generation_at:CarbonImmutable, publication_at:CarbonImmutable}
     */
    public function occurrenceOn(Automation $a, string $localDate): array
    {
        $tz = $this->timezone($a);
        $g = self::parseTime($a->generation_time) ?? [8, 0];
        $p = self::parseTime($a->publication_time) ?? [$g[0], min(59, $g[1] + 30)];

        $gen = CarbonImmutable::createFromFormat('!Y-m-d H:i', sprintf('%s %02d:%02d', $localDate, $g[0], $g[1]), $tz);
        $pub = CarbonImmutable::createFromFormat('!Y-m-d H:i', sprintf('%s %02d:%02d', $localDate, $p[0], $p[1]), $tz);
        if ($pub->lessThanOrEqualTo($gen)) {
            $pub = CarbonImmutable::createFromFormat(
                '!Y-m-d H:i',
                sprintf('%s %02d:%02d', $gen->addDay()->toDateString(), $p[0], $p[1]),
                $tz
            );
        }

        return [
            'run_date' => $localDate,
            'timezone' => $tz,
            'generation_at' => $gen->utc(),
            'publication_at' => $pub->utc(),
        ];
    }

    /**
     * Runs whose generation instant lies in [$fromUtc, $toUtc], oldest first.
     *
     * @return array<int, array{run_date:string, timezone:string, generation_at:CarbonImmutable, publication_at:CarbonImmutable}>
     */
    public function occurrencesBetween(Automation $a, CarbonInterface $fromUtc, CarbonInterface $toUtc, int $limit = 500): array
    {
        $tz = $this->timezone($a);
        $from = CarbonImmutable::instance($fromUtc)->utc();
        $to = CarbonImmutable::instance($toUtc)->utc();
        if ($to->lessThan($from)) {
            return [];
        }

        $day = $from->setTimezone($tz)->subDay()->startOfDay();
        $lastDay = $to->setTimezone($tz)->addDay()->startOfDay();
        $start = CarbonImmutable::createFromFormat('!Y-m-d', $this->startDate($a), $tz);
        if ($day->lessThan($start)) {
            $day = $start;
        }

        $out = [];
        $guard = 0;
        while ($day->lessThanOrEqualTo($lastDay) && count($out) < $limit && $guard++ < self::MAX_COUNT_DAYS) {
            $d = $day->toDateString();
            if ($this->runsOnDate($a, $d)) {
                $occ = $this->occurrenceOn($a, $d);
                if ($occ['generation_at']->greaterThanOrEqualTo($from) && $occ['generation_at']->lessThanOrEqualTo($to)) {
                    $out[] = $occ;
                }
            }
            $day = $day->addDay();
        }

        return $out;
    }

    /** First run whose generation instant is strictly after $afterUtc, or null if the schedule has ended. */
    public function nextOccurrence(Automation $a, ?CarbonInterface $afterUtc = null): ?array
    {
        return $this->upcoming($a, 1, $afterUtc)[0] ?? null;
    }

    /** Up to $count runs whose generation instant is strictly after $afterUtc. */
    public function upcoming(Automation $a, int $count = 5, ?CarbonInterface $afterUtc = null): array
    {
        $tz = $this->timezone($a);
        $after = CarbonImmutable::instance($afterUtc ?? CarbonImmutable::now())->utc();
        $end = $this->endDate($a);

        $day = $after->setTimezone($tz)->subDay()->startOfDay();
        $start = CarbonImmutable::createFromFormat('!Y-m-d', $this->startDate($a), $tz);
        if ($day->lessThan($start)) {
            $day = $start;
        }

        $out = [];
        for ($i = 0; $i < self::SEARCH_HORIZON_DAYS && count($out) < $count; $i++) {
            $d = $day->toDateString();
            if ($end !== null && $d > $end) {
                break;
            }
            if ($this->runsOnDate($a, $d)) {
                $occ = $this->occurrenceOn($a, $d);
                if ($occ['generation_at']->greaterThan($after)) {
                    $out[] = $occ;
                }
            }
            $day = $day->addDay();
        }

        return $out;
    }

    /** Total number of runs in a bounded schedule; null when it has no end date. */
    public function totalOccurrences(Automation $a): ?int
    {
        $end = $this->endDate($a);
        if ($end === null) {
            return null;
        }
        if (self::scheduleType($a) === 'ONE_TIME') {
            return 1;
        }

        $tz = $this->timezone($a);
        $day = CarbonImmutable::createFromFormat('!Y-m-d', $this->startDate($a), $tz);
        $count = 0;
        for ($i = 0; $i < self::MAX_COUNT_DAYS; $i++) {
            $d = $day->toDateString();
            if ($d > $end) {
                break;
            }
            if ($this->runsOnDate($a, $d)) {
                $count++;
            }
            $day = $day->addDay();
        }
        return $count;
    }

    // ------------------------------------------------------------------
    // Presentation
    // ------------------------------------------------------------------

    public static function occurrenceToArray(array $occ): array
    {
        $tz = $occ['timezone'];
        return [
            'run_date' => $occ['run_date'],
            'timezone' => $tz,
            'generation_at' => $occ['generation_at']->toIso8601String(),
            'publication_at' => $occ['publication_at']->toIso8601String(),
            'generation_local' => $occ['generation_at']->setTimezone($tz)->toIso8601String(),
            'publication_local' => $occ['publication_at']->setTimezone($tz)->toIso8601String(),
        ];
    }

    /**
     * Everything the UI needs to explain a schedule. $pendingRuns is the number of this
     * automation's executions that have not reached a terminal state.
     */
    public function summary(Automation $a, ?CarbonInterface $now = null, int $pendingRuns = 0, int $finishedRuns = 0): array
    {
        $now = CarbonImmutable::instance($now ?? CarbonImmutable::now())->utc();
        $type = self::scheduleType($a);
        $tz = $this->timezone($a);
        $upcoming = $this->upcoming($a, 5, $now);
        $next = $upcoming[0] ?? null;
        $total = $this->totalOccurrences($a);
        $gap = self::gapMinutes($a->generation_time, $a->publication_time);
        $genStr = self::formatTime($a->generation_time);
        $pubStr = self::formatTime($a->publication_time);

        if ($type === self::TYPE_NONE) {
            $state = 'MANUAL';
        } elseif ($a->completed_at) {
            $state = 'COMPLETED';
        } elseif (!$a->is_active) {
            $state = 'PAUSED';
        } elseif ($next === null) {
            $state = $pendingRuns > 0 ? 'FINISHING' : 'COMPLETED';
        } elseif ($finishedRuns === 0 && $pendingRuns === 0 && $this->startDate($a) > $now->setTimezone($tz)->toDateString()) {
            $state = 'SCHEDULED';
        } else {
            $state = 'ACTIVE';
        }

        $remaining = null;
        if ($total !== null) {
            $remaining = 0;
            if ($next !== null) {
                $remaining = count($this->occurrencesBetween($a, $next['generation_at'], CarbonImmutable::createFromFormat('!Y-m-d', $this->endDate($a), $tz)->addDays(2)->utc(), self::MAX_COUNT_DAYS));
            }
        }

        return [
            'state' => $state,
            'frequency' => $type,
            'timezone' => $tz,
            'starts_on' => $this->startDate($a),
            'ends_on' => $this->endDate($a),
            'weekly_days' => $type === 'WEEKLY' ? $this->weekdays($a) : [],
            'generation_time' => $genStr,
            'publication_time' => $pubStr,
            'gap_minutes' => $gap,
            'publishes_next_day' => $genStr !== null && $pubStr !== null && strcmp($pubStr, $genStr) < 0,
            'total_runs' => $total,
            'remaining_runs' => $remaining,
            'finished_runs' => $finishedRuns,
            'pending_runs' => $pendingRuns,
            'next_run' => $next ? self::occurrenceToArray($next) : null,
            'upcoming' => array_map([self::class, 'occurrenceToArray'], $upcoming),
            'completed_at' => $a->completed_at ? CarbonImmutable::instance($a->completed_at)->toIso8601String() : null,
            'description' => $this->describe($a),
        ];
    }

    /** One plain-English sentence describing when the automation runs. */
    public function describe(Automation $a): string
    {
        $type = self::scheduleType($a);
        $tz = $this->timezone($a);
        $gen = self::formatTime($a->generation_time) ?? '--:--';
        $pub = self::formatTime($a->publication_time) ?? '--:--';
        $fmt = fn(string $d) => CarbonImmutable::createFromFormat('!Y-m-d', $d, $tz)->format('D, j M Y');
        $nextDay = (self::gapMinutes($a->generation_time, $a->publication_time) ?? 0) > 0
            && strcmp($pub, $gen) < 0 ? ' the next day' : '';
        $times = "content is generated at {$gen} and published at {$pub}{$nextDay} ({$tz})";

        if ($type === self::TYPE_NONE) {
            return 'Manual publishing: records are written only when you publish or schedule them yourself.';
        }
        if ($type === 'ONE_TIME') {
            return "Runs once on {$fmt($this->startDate($a))}: {$times}.";
        }

        $when = $type === 'WEEKLY'
            ? 'every ' . $this->joinWords(array_map(fn($d) => self::WEEKDAY_NAMES[$d], $this->weekdays($a)))
            : 'every day';
        $range = "from {$fmt($this->startDate($a))}";
        $end = $this->endDate($a);
        if ($end !== null) {
            $total = $this->totalOccurrences($a);
            $range .= " to {$fmt($end)} ({$total} " . ($total === 1 ? 'run' : 'runs') . ')';
        } else {
            $range .= ' with no end date';
        }

        return 'Runs ' . $when . ' ' . $range . '; ' . $times . '.';
    }

    // ------------------------------------------------------------------
    // Validation
    // ------------------------------------------------------------------

    /**
     * Validate and normalise schedule input. Returns ['errors' => [field => message], 'values' => [...]].
     * Rules: known frequency; valid IANA timezone; HH:MM times; publication at least 15 minutes after
     * generation; real dates; end date not before start date; at least one weekday for WEEKLY; and the
     * schedule must still have a run in the future.
     */
    public function validate(array $input, ?CarbonInterface $now = null): array
    {
        $errors = [];
        $now = CarbonImmutable::instance($now ?? CarbonImmutable::now())->utc();

        $type = strtoupper((string) ($input['schedule_type'] ?? 'DAILY'));
        if (!in_array($type, self::TYPES, true)) {
            $errors['schedule_type'] = 'Frequency must be one-time, daily or weekly.';
            $type = 'DAILY';
        }

        $rawTz = (string) ($input['timezone'] ?? 'UTC');
        if (!self::isValidTimezone($rawTz)) {
            $errors['timezone'] = "'{$rawTz}' is not a valid timezone. Pick one from the list, for example Asia/Kolkata.";
        }
        $tz = self::normalizeTimezone($rawTz);

        $gen = self::formatTime($input['generation_time'] ?? null);
        $pub = self::formatTime($input['publication_time'] ?? null);
        if ($gen === null) {
            $errors['generation_time'] = 'Generation time must be a valid time (HH:MM).';
        }
        if ($pub === null) {
            $errors['publication_time'] = 'Publication time must be a valid time (HH:MM).';
        }
        if ($gen !== null && $pub !== null) {
            $gap = self::gapMinutes($gen, $pub);
            if ($gap === 0) {
                $errors['publication_time'] = 'Publication time must be after the generation time.';
            } elseif ($gap < self::MIN_GAP_MINUTES) {
                $errors['publication_time'] = 'Publication time must be at least ' . self::MIN_GAP_MINUTES . " minutes after generation time (current gap: {$gap} minutes).";
            }
        }

        $start = $input['start_date'] ?? null;
        if ($start === null || $start === '') {
            if ($type === 'ONE_TIME') {
                $errors['start_date'] = 'Choose the date this one-time run should happen.';
            }
            $start = $now->setTimezone($tz)->toDateString();
        } elseif (!self::isValidDate($start)) {
            $errors['start_date'] = 'Start date must be a valid date (YYYY-MM-DD).';
            $start = $now->setTimezone($tz)->toDateString();
        }

        $end = $type === 'ONE_TIME' ? null : ($input['end_date'] ?? null);
        if ($end === '') {
            $end = null;
        }
        if ($end !== null) {
            if (!self::isValidDate($end)) {
                $errors['end_date'] = 'End date must be a valid date (YYYY-MM-DD).';
                $end = null;
            } elseif ($end < $start) {
                $errors['end_date'] = 'End date cannot be before the start date.';
            }
        }

        $weekdays = null;
        if ($type === 'WEEKLY') {
            $weekdays = array_values(array_unique(array_filter(
                array_map('intval', (array) ($input['weekly_days'] ?? [])),
                fn($d) => $d >= 1 && $d <= 7
            )));
            sort($weekdays);
            if (empty($weekdays)) {
                $weekdays = [CarbonImmutable::createFromFormat('!Y-m-d', $start, $tz)->dayOfWeekIso];
            }
        }

        $values = [
            'schedule_type' => $type,
            'timezone' => $tz,
            'generation_time' => $gen,
            'publication_time' => $pub,
            'start_date' => $start,
            'end_date' => $end,
            'weekly_days' => $weekdays,
        ];

        if (empty($errors)) {
            $probe = new Automation();
            $probe->forceFill($values + ['is_active' => true]);
            if ($this->nextOccurrence($probe, $now) === null) {
                if ($type === 'ONE_TIME') {
                    $when = CarbonImmutable::createFromFormat('!Y-m-d H:i', "{$start} {$gen}", $tz)->format('D, j M Y H:i');
                    $errors['start_date'] = "That run time has already passed ({$when}, {$tz}). Choose a later date or time.";
                } else {
                    $errors['end_date'] = 'No run is left between the start and end dates. Extend the end date or change the days.';
                }
            }
        }

        return ['errors' => $errors, 'values' => $values];
    }

    // ------------------------------------------------------------------

    private function dateString(mixed $value): ?string
    {
        if ($value instanceof CarbonInterface || $value instanceof \DateTimeInterface) {
            return $value->format('Y-m-d');
        }
        if (is_string($value) && preg_match('/^\d{4}-\d{2}-\d{2}/', $value)) {
            return substr($value, 0, 10);
        }
        return null;
    }

    private function joinWords(array $words): string
    {
        if (count($words) <= 1) {
            return $words[0] ?? '';
        }
        $last = array_pop($words);
        return implode(', ', $words) . ' and ' . $last;
    }
}
