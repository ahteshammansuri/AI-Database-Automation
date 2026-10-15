<?php

namespace App\Http\Controllers;

use App\Models\DbConnection;
use App\Services\SchemaDriftService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SchemaDriftController extends Controller
{
    public function __construct(
        protected SchemaDriftService $driftService
    ) {}

    /**
     * Detect schema drift between target database and baseline snapshot.
     */
    public function detectDrift(Request $request, int $connectionId): JsonResponse
    {
        $user = $request->user();
        $connection = DbConnection::where('id', $connectionId)
            ->where('user_id', $user->id)
            ->first();

        if (!$connection) {
            return response()->json(['error' => 'Connection not found or unauthorized.'], 404);
        }

        try {
            $report = $this->driftService->detectDrift($connection);
            return response()->json($report);
        } catch (\Throwable $e) {
            return response()->json([
                'success' => false,
                'error' => $e->getMessage(),
            ], 422);
        }
    }
}
