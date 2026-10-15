<?php

namespace App\Http\Controllers;

use App\Services\CalendarService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class CalendarController extends Controller
{
    public function __construct(
        protected CalendarService $calendarService
    ) {}

    /**
     * Get scheduled and executed publications within a date window for calendar rendering.
     */
    public function events(Request $request): JsonResponse
    {
        $user = $request->user();
        $start = $request->query('start_date', now()->subDays(15)->toDateString());
        $end = $request->query('end_date', now()->addDays(30)->toDateString());

        try {
            $events = $this->calendarService->getCalendarEvents($user, $start, $end);
            return response()->json(['events' => $events]);
        } catch (\Throwable $e) {
            return response()->json([
                'success' => false,
                'error' => $e->getMessage(),
            ], 422);
        }
    }

    /**
     * Reschedule an automation run with lead-time verification.
     */
    public function reschedule(Request $request, int $automationId): JsonResponse
    {
        $user = $request->user();
        $validated = $request->validate([
            'new_datetime' => 'required|date',
        ]);

        try {
            $result = $this->calendarService->reschedule($user, $automationId, $validated['new_datetime']);
            return response()->json($result);
        } catch (\Throwable $e) {
            return response()->json([
                'success' => false,
                'error' => $e->getMessage(),
            ], 422);
        }
    }
}
