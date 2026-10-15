<?php

namespace App\Http\Controllers;

use App\Services\QualityScoreService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class QualityScoreController extends Controller
{
    public function __construct(
        protected QualityScoreService $qualityScoreService
    ) {}

    /**
     * Evaluate content payload quality metrics (Readability, SEO, Factual grounding).
     */
    public function evaluate(Request $request): JsonResponse
    {
        $data = $request->validate([
            'title' => 'nullable|string|max:255',
            'content' => 'nullable|string',
            'slug' => 'nullable|string|max:255',
            'excerpt' => 'nullable|string',
            'rag_passages' => 'nullable|array',
        ]);

        $evaluation = $this->qualityScoreService->evaluateContent($data, $data['rag_passages'] ?? []);

        return response()->json($evaluation);
    }
}
