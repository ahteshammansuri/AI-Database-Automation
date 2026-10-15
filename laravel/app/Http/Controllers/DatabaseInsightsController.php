<?php

namespace App\Http\Controllers;

use App\Models\DbConnection;
use App\Services\DatabaseInsightsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DatabaseInsightsController extends Controller
{
    public function __construct(
        protected DatabaseInsightsService $insightsService
    ) {}

    /**
     * Get safe, parameterized database insights and publication velocity.
     */
    public function insights(Request $request, int $connectionId): JsonResponse
    {
        $user = $request->user();
        $connection = DbConnection::where('id', $connectionId)
            ->where('user_id', $user->id)
            ->first();

        if (!$connection) {
            return response()->json(['error' => 'Connection not found or unauthorized.'], 404);
        }

        try {
            $data = $this->insightsService->getInsights($user, $connection);
            return response()->json($data);
        } catch (\Throwable $e) {
            return response()->json([
                'success' => false,
                'error' => $e->getMessage(),
            ], 422);
        }
    }
}
