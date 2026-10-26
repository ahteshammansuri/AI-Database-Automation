<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AiUsageEvent;
use App\Models\AuditLog;
use App\Models\Automation;
use App\Models\AutomationExecution;
use App\Models\DbConnection;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rule;
use Laravel\Sanctum\PersonalAccessToken;

/**
 * The signed-in customer's own account: profile (name, email, timezone), password, signed-in sessions (API tokens)
 * and their AI usage. Changing the email or password needs the current password; every change is audited.
 */
class ProfileController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        $user = $request->user();
        $currentId = $this->currentTokenId($request);

        return response()->json([
            'profile' => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                'timezone' => $user->timezone,
                'created_at' => $user->created_at?->toIso8601String(),
                'last_active_at' => $user->last_active_at?->toIso8601String(),
            ],
            'workspace' => [
                'connections' => DbConnection::where('user_id', $user->id)->count(),
                'automations' => Automation::where('user_id', $user->id)->where('schedule_type', '!=', 'NONE')->count(),
                'runs_this_month' => AutomationExecution::where('user_id', $user->id)->where('created_at', '>=', now()->startOfMonth())->count(),
            ],
            'sessions' => $user->tokens()->orderByDesc('last_used_at')->orderByDesc('id')->limit(50)->get()
                ->map(fn (PersonalAccessToken $t) => [
                    'id' => $t->id,
                    'name' => $t->name,
                    'created_at' => $t->created_at?->toIso8601String(),
                    'last_used_at' => $t->last_used_at?->toIso8601String(),
                    'expires_at' => $t->expires_at?->toIso8601String(),
                    'current' => $t->id === $currentId,
                ]),
            'password_min_length' => max(6, (int) config('platform.password_min_length', 6)),
        ]);
    }

    public function update(Request $request): JsonResponse
    {
        $user = $request->user();
        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'email' => ['required', 'string', 'email', 'max:255', Rule::unique('users', 'email')->ignore($user->id)],
            'timezone' => 'nullable|string|max:64|timezone:all',
            'current_password' => 'nullable|string|max:255',
        ], [
            'email.unique' => 'Another account already uses this email address.',
            'timezone.timezone' => 'Choose a timezone from the list.',
        ]);

        $emailChanged = strcasecmp($validated['email'], $user->email) !== 0;
        if ($emailChanged && !Hash::check((string) ($validated['current_password'] ?? ''), $user->password)) {
            return response()->json([
                'message' => 'Enter your current password to change your email address.',
                'errors' => ['current_password' => ['Enter your current password to change your email address.']],
            ], 422);
        }

        $before = $user->only(['name', 'email', 'timezone']);
        $user->fill([
            'name' => trim($validated['name']),
            'email' => $validated['email'],
            'timezone' => $validated['timezone'] ?? null,
        ]);
        if ($emailChanged) {
            $user->email_verified_at = null;
        }
        $user->save();

        AuditLog::log($user->id, 'PROFILE_UPDATED', 'User', (string) $user->id, [
            'changes' => AuditLog::changes($before, $user->only(['name', 'email', 'timezone'])),
        ]);

        return response()->json(['message' => 'Profile saved.', 'profile' => $user->only(['id', 'name', 'email', 'timezone'])]);
    }

    public function password(Request $request): JsonResponse
    {
        $user = $request->user();
        $min = max(6, (int) config('platform.password_min_length', 6));
        $validated = $request->validate([
            'current_password' => 'required|string|max:255',
            'password' => "required|string|min:{$min}|max:255|confirmed|different:current_password",
            'sign_out_others' => 'nullable|boolean',
        ], [
            'password.different' => 'Choose a password different from the current one.',
        ]);

        if (!Hash::check($validated['current_password'], $user->password)) {
            return response()->json([
                'message' => 'The current password is not correct.',
                'errors' => ['current_password' => ['The current password is not correct.']],
            ], 422);
        }

        $user->password = $validated['password']; // hashed by the model cast
        $user->save();

        $signedOut = 0;
        if ($validated['sign_out_others'] ?? true) {
            $signedOut = $user->tokens()->where('id', '!=', $this->currentTokenId($request) ?? 0)->delete();
        }

        AuditLog::log($user->id, 'PASSWORD_CHANGED', 'User', (string) $user->id, ['other_sessions_signed_out' => $signedOut]);

        return response()->json([
            'message' => $signedOut ? "Password changed. {$signedOut} other session(s) were signed out." : 'Password changed.',
            'signed_out' => $signedOut,
        ]);
    }

    /** Sign out one other session, or every other session when no id is given. */
    public function revokeSessions(Request $request, ?int $id = null): JsonResponse
    {
        $user = $request->user();
        $current = $this->currentTokenId($request);
        if ($id !== null && $id === $current) {
            return response()->json(['message' => 'This is the session you are using. Use Sign out instead.'], 422);
        }

        $query = $user->tokens()->where('id', '!=', $current ?? 0);
        if ($id !== null) {
            $query->where('id', $id);
        }
        $count = $query->delete();
        if ($id !== null && $count === 0) {
            abort(404);
        }

        AuditLog::log($user->id, 'SESSIONS_SIGNED_OUT', 'User', (string) $user->id, ['count' => $count]);

        return response()->json(['message' => $count === 1 ? 'Signed out 1 session.' : "Signed out {$count} sessions.", 'count' => $count]);
    }

    /** The customer's AI calls and tokens for a period, by model and by purpose. */
    public function usage(Request $request): JsonResponse
    {
        $v = $request->validate(['days' => 'nullable|integer|in:7,30,90']);
        $days = (int) ($v['days'] ?? 30);
        $since = now()->subDays($days);
        $base = AiUsageEvent::where('user_id', $request->user()->id)->where('created_at', '>=', $since);

        $totals = (clone $base)->selectRaw('COALESCE(SUM(calls),0) calls, COALESCE(SUM(prompt_tokens),0) prompt_tokens, COALESCE(SUM(completion_tokens),0) completion_tokens')->first();
        $byModel = (clone $base)->selectRaw('provider, model, SUM(calls) calls, SUM(prompt_tokens) prompt_tokens, SUM(completion_tokens) completion_tokens')
            ->groupBy('provider', 'model')->orderByRaw('SUM(prompt_tokens) + SUM(completion_tokens) DESC')->limit(20)->get();
        $byPurpose = (clone $base)->selectRaw('purpose, SUM(calls) calls, SUM(prompt_tokens) + SUM(completion_tokens) tokens')
            ->groupBy('purpose')->orderByRaw('SUM(prompt_tokens) + SUM(completion_tokens) DESC')->get()
            ->map(fn ($r) => ['purpose' => $r->purpose, 'label' => AiUsageEvent::purposeLabel($r->purpose), 'calls' => (int) $r->calls, 'tokens' => (int) $r->tokens]);
        $daily = (clone $base)->selectRaw('DATE(created_at) d, SUM(prompt_tokens) + SUM(completion_tokens) tokens')
            ->groupBy('d')->orderBy('d')->get()->map(fn ($r) => ['date' => (string) $r->d, 'tokens' => (int) $r->tokens]);

        return response()->json([
            'days' => $days,
            'totals' => ['calls' => (int) $totals->calls, 'prompt_tokens' => (int) $totals->prompt_tokens, 'completion_tokens' => (int) $totals->completion_tokens],
            'by_model' => $byModel->map(fn ($r) => ['provider' => $r->provider, 'model' => $r->model, 'calls' => (int) $r->calls, 'prompt_tokens' => (int) $r->prompt_tokens, 'completion_tokens' => (int) $r->completion_tokens]),
            'by_purpose' => $byPurpose,
            'daily' => $daily,
        ]);
    }

    private function currentTokenId(Request $request): ?int
    {
        $token = $request->user()->currentAccessToken();

        return $token instanceof PersonalAccessToken ? (int) $token->id : null;
    }
}
