<?php

namespace Tests\Unit;

use App\Models\Automation;
use App\Services\Automation\ScheduleCalculator;
use Carbon\CarbonImmutable;
use Tests\TestCase;

class ScheduleCalculatorTest extends TestCase
{
    private ScheduleCalculator $calc;

    protected function setUp(): void
    {
        parent::setUp();
        $this->calc = new ScheduleCalculator();
    }

    private function automation(array $attrs): Automation
    {
        $a = new Automation();
        $a->forceFill($attrs + ['timezone' => 'UTC', 'generation_time' => '08:30', 'publication_time' => '09:00', 'is_active' => true]);
        return $a;
    }

    public function test_gap_rules_minimum_fifteen_minutes_and_midnight_wrap(): void
    {
        $this->assertSame(15, ScheduleCalculator::gapMinutes('08:45', '09:00'));
        $this->assertSame(14, ScheduleCalculator::gapMinutes('08:46', '09:00'));
        $this->assertSame(0, ScheduleCalculator::gapMinutes('09:00', '09:00'));
        $this->assertSame(20, ScheduleCalculator::gapMinutes('23:50', '00:10'));
        $this->assertNull(ScheduleCalculator::gapMinutes('25:00', '09:00'));
    }

    public function test_validate_rejects_short_gap_equal_times_and_end_before_start(): void
    {
        $now = CarbonImmutable::parse('2026-10-16 06:00', 'UTC');
        $base = ['schedule_type' => 'DAILY', 'timezone' => 'UTC', 'start_date' => '2026-10-17'];

        $r = $this->calc->validate($base + ['generation_time' => '08:50', 'publication_time' => '09:00'], $now);
        $this->assertArrayHasKey('publication_time', $r['errors']);

        $r = $this->calc->validate($base + ['generation_time' => '09:00', 'publication_time' => '09:00'], $now);
        $this->assertStringContainsString('after the generation time', $r['errors']['publication_time']);

        $r = $this->calc->validate($base + ['generation_time' => '08:45', 'publication_time' => '09:00', 'end_date' => '2026-10-16'], $now);
        $this->assertArrayHasKey('end_date', $r['errors']);

        $r = $this->calc->validate($base + ['generation_time' => '08:45', 'publication_time' => '09:00', 'end_date' => '2026-10-21'], $now);
        $this->assertSame([], $r['errors']);
    }

    public function test_one_time_in_the_past_is_rejected_and_future_is_accepted(): void
    {
        $now = CarbonImmutable::parse('2026-10-16 10:00', 'Asia/Kolkata')->utc();
        $past = $this->calc->validate([
            'schedule_type' => 'ONE_TIME', 'timezone' => 'Asia/Kolkata', 'start_date' => '2026-10-16',
            'generation_time' => '09:30', 'publication_time' => '10:30',
        ], $now);
        $this->assertArrayHasKey('start_date', $past['errors']);

        $future = $this->calc->validate([
            'schedule_type' => 'ONE_TIME', 'timezone' => 'Asia/Kolkata', 'start_date' => '2026-10-16',
            'generation_time' => '11:00', 'publication_time' => '11:15',
        ], $now);
        $this->assertSame([], $future['errors']);
        $this->assertNull($future['values']['end_date'], 'one-time schedules never carry an end date');
    }

    public function test_daily_with_end_date_has_exact_run_count_and_ends(): void
    {
        $a = $this->automation(['schedule_type' => 'DAILY', 'start_date' => '2026-10-17', 'end_date' => '2026-10-21']);
        $this->assertSame(5, $this->calc->totalOccurrences($a));

        $after = CarbonImmutable::parse('2026-10-21 08:31', 'UTC');
        $this->assertNull($this->calc->nextOccurrence($a, $after), 'no run after the last generation time');

        $next = $this->calc->nextOccurrence($a, CarbonImmutable::parse('2026-10-16 12:00', 'UTC'));
        $this->assertSame('2026-10-17', $next['run_date']);
        $this->assertSame('2026-10-17T08:30:00+00:00', $next['generation_at']->toIso8601String());
        $this->assertSame('2026-10-17T09:00:00+00:00', $next['publication_at']->toIso8601String());
    }

    public function test_daily_without_end_date_is_open_ended(): void
    {
        $a = $this->automation(['schedule_type' => 'DAILY', 'start_date' => '2026-10-17']);
        $this->assertNull($this->calc->totalOccurrences($a));
        $this->assertCount(5, $this->calc->upcoming($a, 5, CarbonImmutable::parse('2026-10-16', 'UTC')));
    }

    public function test_weekly_runs_only_on_selected_weekdays(): void
    {
        // 2026-10-19 is a Monday
        $a = $this->automation(['schedule_type' => 'WEEKLY', 'start_date' => '2026-10-17', 'end_date' => '2026-10-31', 'weekly_days' => [1, 4]]);
        $runs = array_map(fn($o) => $o['run_date'], $this->calc->upcoming($a, 10, CarbonImmutable::parse('2026-10-16', 'UTC')));
        $this->assertSame(['2026-10-19', '2026-10-22', '2026-10-26', '2026-10-29'], $runs);
        $this->assertSame(4, $this->calc->totalOccurrences($a));
        $this->assertStringContainsString('every Monday and Thursday', $this->calc->describe($a));
    }

    public function test_one_time_runs_once_then_has_no_next_run(): void
    {
        $a = $this->automation(['schedule_type' => 'ONE_TIME', 'start_date' => '2026-10-17']);
        $this->assertSame(1, $this->calc->totalOccurrences($a));
        $this->assertNotNull($this->calc->nextOccurrence($a, CarbonImmutable::parse('2026-10-17 08:00', 'UTC')));
        $this->assertNull($this->calc->nextOccurrence($a, CarbonImmutable::parse('2026-10-17 08:30', 'UTC')));
    }

    public function test_publication_before_generation_on_the_clock_means_next_day(): void
    {
        $a = $this->automation(['schedule_type' => 'DAILY', 'start_date' => '2026-10-17', 'generation_time' => '23:50', 'publication_time' => '00:10']);
        $occ = $this->calc->occurrenceOn($a, '2026-10-17');
        $this->assertSame('2026-10-18T00:10:00+00:00', $occ['publication_at']->toIso8601String());
        $this->assertTrue($this->calc->summary($a, CarbonImmutable::parse('2026-10-16', 'UTC'))['publishes_next_day']);
    }

    public function test_timezone_alias_and_wall_clock_across_dst(): void
    {
        $this->assertSame('Asia/Kolkata', ScheduleCalculator::normalizeTimezone('Asia/Calcutta'));
        $this->assertSame('UTC', ScheduleCalculator::normalizeTimezone('Not/AZone'));

        // US DST ended 2026-11-01; 09:00 local must stay 09:00 local on both sides.
        $a = $this->automation(['schedule_type' => 'DAILY', 'timezone' => 'America/New_York', 'start_date' => '2026-10-31', 'generation_time' => '09:00', 'publication_time' => '09:30']);
        $before = $this->calc->occurrenceOn($a, '2026-10-31');
        $after = $this->calc->occurrenceOn($a, '2026-11-02');
        $this->assertSame('13:00', $before['generation_at']->format('H:i'));
        $this->assertSame('14:00', $after['generation_at']->format('H:i'));
        $this->assertSame('09:00', $after['generation_at']->setTimezone('America/New_York')->format('H:i'));
    }

    public function test_summary_states(): void
    {
        $now = CarbonImmutable::parse('2026-10-16 12:00', 'UTC');
        $future = $this->automation(['schedule_type' => 'DAILY', 'start_date' => '2026-10-20']);
        $this->assertSame('SCHEDULED', $this->calc->summary($future, $now)['state']);

        $paused = $this->automation(['schedule_type' => 'DAILY', 'start_date' => '2026-10-10', 'is_active' => false]);
        $this->assertSame('PAUSED', $this->calc->summary($paused, $now)['state']);

        $done = $this->automation(['schedule_type' => 'ONE_TIME', 'start_date' => '2026-10-15']);
        $this->assertSame('COMPLETED', $this->calc->summary($done, $now)['state']);
        $this->assertSame('FINISHING', $this->calc->summary($done, $now, 1)['state']);

        $manual = $this->automation(['schedule_type' => 'NONE']);
        $this->assertSame('MANUAL', $this->calc->summary($manual, $now)['state']);
        $this->assertFalse($this->calc->runsOnDate($manual, '2026-10-16'));
    }
}
