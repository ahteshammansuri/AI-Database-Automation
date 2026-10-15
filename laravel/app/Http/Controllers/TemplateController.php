<?php

namespace App\Http\Controllers;

use App\Services\TemplateService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class TemplateController extends Controller
{
    public function __construct(
        protected TemplateService $templateService
    ) {}

    /**
     * List available automation templates.
     */
    public function index(): JsonResponse
    {
        return response()->json([
            'templates' => $this->templateService->listTemplates(),
        ]);
    }

    /**
     * Instantiate a new automation from a chosen template.
     */
    public function createFromTemplate(Request $request): JsonResponse
    {
        $user = $request->user();
        $validated = $request->validate([
            'template_id' => 'required|string',
            'connection_id' => 'required|integer',
            'name' => 'nullable|string|max:255',
            'schedule_type' => 'nullable|string|in:manual,daily,weekly',
            'topic_prompt' => 'nullable|string',
        ]);

        try {
            $automation = $this->templateService->createFromTemplate(
                $user,
                $validated['template_id'],
                (int) $validated['connection_id'],
                $validated
            );

            return response()->json([
                'success' => true,
                'automation' => $automation,
                'message' => "Successfully created automation '{$automation->name}' from template.",
            ], 201);
        } catch (\Throwable $e) {
            return response()->json([
                'success' => false,
                'error' => $e->getMessage(),
            ], 422);
        }
    }
}
