<?php

namespace App\Http\Middleware;

use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Customer API guard: a suspended account (set by a platform admin) cannot use the API. Also records when the
 * customer was last active (at most every 5 minutes) for the admin panel's usage figures.
 */
class EnsureCustomerActive
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();
        if ($user instanceof User) {
            if ($user->isSuspended()) {
                $support = config('platform.support_email');
                return response()->json([
                    'message' => 'This account is suspended.' . ($support ? " Contact {$support} for help." : ''),
                    'reason' => 'suspended',
                ], 403);
            }
            if (!$user->last_active_at || $user->last_active_at->lt(now()->subMinutes(5))) {
                $user->forceFill(['last_active_at' => now()])->saveQuietly();
            }
        }
        return $next($request);
    }
}
