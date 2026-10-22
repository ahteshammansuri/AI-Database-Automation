<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Admin kill switch for Orbit (Settings > Orbit). Blocks starting new Orbit work; stopping a running task still works.
 */
class EnsureOrbitEnabled
{
    public function handle(Request $request, Closure $next): Response
    {
        if (!config('orbit.enabled', true)) {
            return response()->json(['message' => 'Orbit is turned off by the administrator.', 'reason' => 'orbit_disabled'], 503);
        }
        return $next($request);
    }
}
