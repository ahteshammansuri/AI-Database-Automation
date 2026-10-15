<?php

namespace App\Http\Controllers;

use App\Services\CompensationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class CompensationController extends Controller
{
    public function __construct(
        protected CompensationService $compensationService
    ) {}

    /**
     * Safely compensate / undo a published execution.
     */
    public function undo(Request $request, int $executionId): JsonResponse
    {
        $user = $request->user();

        try {
            $result = $this->compensationService->compensateExecution($user, $executionId);
            return response()->json($result);
        } catch (\Throwable $e) {
            return response()->json([
                'success' => false,
                'error' => $e->getMessage(),
            ], 422);
        }
    }
}
