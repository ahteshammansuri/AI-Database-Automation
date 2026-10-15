<?php

namespace App\Http\Controllers;

use App\Services\FeatureFlagService;
use Illuminate\Http\JsonResponse;

class FeatureFlagController extends Controller
{
    public function __construct(
        protected FeatureFlagService $featureFlagService
    ) {}

    /**
     * Get status of all platform feature flags.
     */
    public function index(): JsonResponse
    {
        return response()->json([
            'features' => $this->featureFlagService->getAllFlags(),
        ]);
    }
}
