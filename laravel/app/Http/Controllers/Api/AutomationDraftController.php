<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AutomationDraft;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Saves the automation (or manual publication) a customer is building, step by step. Only the owner can read or
 * change it. Secrets never belong in a draft: the builder holds none (connections and keys are stored elsewhere).
 */
class AutomationDraftController extends Controller
{
    private const MAX_BYTES = 262144; // 256 KB of draft JSON

    public function show(Request $request, string $kind = 'automation'): JsonResponse
    {
        abort_unless(in_array($kind, AutomationDraft::KINDS, true), 404);
        $draft = AutomationDraft::where('user_id', $request->user()->id)->where('kind', $kind)->first();

        return response()->json([
            'draft' => $draft ? ['payload' => $draft->payload, 'step' => $draft->step, 'updated_at' => $draft->updated_at?->toIso8601String()] : null,
        ]);
    }

    public function save(Request $request, string $kind = 'automation'): JsonResponse
    {
        abort_unless(in_array($kind, AutomationDraft::KINDS, true), 404);
        $validated = $request->validate([
            'payload' => 'required|array',
            'step' => 'required|integer|min:1|max:5',
        ]);
        if (strlen((string) json_encode($validated['payload'])) > self::MAX_BYTES) {
            return response()->json(['message' => 'This draft is too large to save.', 'errors' => ['payload' => ['This draft is too large to save.']]], 422);
        }

        $draft = AutomationDraft::updateOrCreate(
            ['user_id' => $request->user()->id, 'kind' => $kind],
            ['payload' => $validated['payload'], 'step' => $validated['step']]
        );

        return response()->json(['saved_at' => $draft->updated_at?->toIso8601String()]);
    }

    public function destroy(Request $request, string $kind = 'automation'): JsonResponse
    {
        abort_unless(in_array($kind, AutomationDraft::KINDS, true), 404);
        AutomationDraft::where('user_id', $request->user()->id)->where('kind', $kind)->delete();
        return response()->json(['deleted' => true]);
    }
}
