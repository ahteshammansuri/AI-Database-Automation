<?php

namespace App\Http\Controllers;

use App\Services\SimulationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SimulationController extends Controller
{
    public function __construct(
        protected SimulationService $simulationService
    ) {}

    /**
     * Run simulation / dry-run for an automation.
     */
    public function dryRun(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        $overrides = $request->validate([
            'title' => 'nullable|string|max:255',
            'topic_prompt' => 'nullable|string',
            'content' => 'nullable|string',
        ]);

        try {
            $result = $this->simulationService->simulate($user, $id, $overrides);
            return response()->json($result);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::error('[SimulationDryRun] Exception: ' . $e->getMessage(), [
                'trace' => $e->getTraceAsString()
            ]);
            return response()->json([
                'success' => false,
                'error' => $e->getMessage(),
            ], 422);
        }
    }
}
