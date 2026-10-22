<?php

namespace App\Http\Middleware;

use App\Services\Orbit\OrbitRemoteService;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Authenticates a paired phone by its device token (Authorization: Bearer ...). The token is not a Sanctum token:
 * it only works on the Orbit Remote device endpoints, and only while its session is active.
 */
class AuthenticateOrbitRemoteDevice
{
    private const MESSAGES = [
        'not_connected' => 'This phone is not connected. Scan the QR code on your computer to connect.',
        'expired' => 'This connection expired. Scan a new QR code on your computer.',
        'replaced' => 'Another phone was connected to your account, so this one was disconnected.',
        'disconnected_from_computer' => 'The computer disconnected this phone.',
        'disconnected_from_phone' => 'You disconnected this phone.',
        'signed_out' => 'You signed out on the computer, so this phone was disconnected.',
        'signed_out_by_admin' => 'An administrator signed this account out, so this phone was disconnected.',
        'suspended' => 'This account is suspended, so this phone was disconnected.',
        'disconnected_by_admin' => 'An administrator disconnected this phone.',
        'account_deleted' => 'This account no longer exists.',
    ];

    public function __construct(private OrbitRemoteService $remote) {}

    public function handle(Request $request, Closure $next): Response
    {
        if (!OrbitRemoteService::enabled()) {
            return response()->json(['message' => 'Orbit Remote is turned off by the administrator.', 'reason' => 'disabled'], 401);
        }
        [$session, $reason] = $this->remote->sessionForDevice($request->bearerToken());
        if (!$session) {
            return response()->json([
                'message' => self::MESSAGES[$reason] ?? 'This phone is no longer connected. Scan a new QR code on your computer.',
                'reason' => $reason,
            ], 401);
        }
        $this->remote->touchDevice($session);
        $request->attributes->set('orbit_remote_session', $session);
        return $next($request);
    }
}
