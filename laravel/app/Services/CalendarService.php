<?php

namespace App\Services;

use App\Models\Automation;
use App\Models\AutomationExecution;
use App\Models\User;
use Carbon\Carbon;
use Exception;

class CalendarService
{
    public function __construct(
        protected FeatureFlagService $featureFlagService
    ) {}

    /**
     * Get scheduled runs and executed publications within a date window for calendar rendering.
     */
    public function getCalendarEvents(User $user, string $startDate, string $endDate): array
    {
        if (!$this->featureFlagService->isEnabled('FEATURE_CONTENT_CALENDAR')) {
            throw new Exception("Content Calendar is disabled by platform feature flag.");
        }

        $start = Carbon::parse($startDate)->startOfDay();
        $end = Carbon::parse($endDate)->endOfDay();

        // 1. Historical & pending executions
        $executions = AutomationExecution::with(['automation.connection'])
            ->where('user_id', $user->id)
            ->whereBetween('created_at', [$start, $end])
            ->get();

        $events = [];
        foreach ($executions as $exec) {
            $events[] = [
                'id' => 'exec_' . $exec->id,
                'execution_id' => $exec->id,
                'automation_id' => $exec->automation_id,
                'title' => ($exec->automation->name ?? 'Automation') . ' (Run #' . $exec->id . ')',
                'start' => Carbon::parse($exec->published_at ?: $exec->created_at)->toIso8601String(),
                'status' => $exec->status,
                'type' => 'execution',
                'target_table' => $exec->automation->target_table ?? 'posts',
                'connection_name' => $exec->automation->connection->name ?? 'Default DB',
                'is_draggable' => false,
            ];
        }

        // 2. Projected future schedule runs for active automations
        $automations = Automation::where('user_id', $user->id)
            ->where('is_active', true)
            ->get();

        foreach ($automations as $auto) {
            $nextRun = $this->calculateNextRun($auto, now());
            if ($nextRun && $nextRun->between($start, $end)) {
                $events[] = [
                    'id' => 'sched_' . $auto->id,
                    'execution_id' => null,
                    'automation_id' => $auto->id,
                    'title' => $auto->name . ' (Scheduled)',
                    'start' => $nextRun->toIso8601String(),
                    'status' => 'SCHEDULED',
                    'type' => 'projected_schedule',
                    'target_table' => $auto->target_table,
                    'connection_name' => $auto->connection->name ?? 'Default DB',
                    'is_draggable' => true,
                ];
            }
        }

        return $events;
    }

    /**
     * Reschedule an automation's next run, keeping its generation-to-publication gap (minimum 15 minutes).
     */
    public function reschedule(User $user, int $automationId, string $newDateTime): array
    {
        if (!$this->featureFlagService->isEnabled('FEATURE_CONTENT_CALENDAR')) {
            throw new Exception("Content Calendar is disabled by platform feature flag.");
        }

        $automation = Automation::where('id', $automationId)
            ->where('user_id', $user->id)
            ->first();

        if (!$automation) {
            throw new Exception("Automation #{$automationId} not found or unauthorized.");
        }

        $targetTime = Carbon::parse($newDateTime);
        $leadTime = max(\App\Services\Automation\ScheduleCalculator::minGapMinutes(), (int) ($automation->lead_time_minutes ?? 30));
        $minAllowed = now()->addMinutes($leadTime);

        if ($targetTime->lt($minAllowed)) {
            throw new Exception("Reschedule policy error: Publication time must be at least {$leadTime} minutes into the future to allow safe generation and review.");
        }

        $newPub = $targetTime->format('H:i');
        $newGen = $targetTime->copy()->subMinutes($leadTime)->format('H:i');

        $automation->update([
            'publication_time' => $newPub,
            'generation_time' => $newGen,
            'start_date' => $targetTime->format('Y-m-d'),
            'schedule_anchor_at' => now(),
            'completed_at' => null,
        ]);

        return [
            'success' => true,
            'automation_id' => $automation->id,
            'new_publication_time' => $newPub,
            'new_generation_time' => $newGen,
            'new_datetime' => $targetTime->toIso8601String(),
            'message' => "Successfully rescheduled '{$automation->name}' to {$targetTime->toIso8601String()}.",
        ];
    }

    protected function calculateNextRun(Automation $auto, Carbon $from): ?Carbon
    {
        $next = app(\App\Services\Automation\ScheduleCalculator::class)->nextOccurrence($auto, $from);
        return $next ? Carbon::instance($next['publication_at']) : null;
    }
}
