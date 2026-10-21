<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\OrbitRemoteSession;
use App\Services\Orbit\OrbitRemoteService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Broadcast;
use Illuminate\Support\Facades\RateLimiter;

/**
 * Orbit Remote, phone side. Claiming is public (the single-use code is the credential); everything else needs the
 * device token from the claim (see AuthenticateOrbitRemoteDevice).
 */
class OrbitRemoteDeviceController extends Controller
{
    /** Spoken or typed requests per minute from one phone. */
    private const COMMANDS_PER_MINUTE = 20;

    public function __construct(private OrbitRemoteService $remote) {}

    public function claim(Request $request): JsonResponse
    {
        $data = $request->validate(
            ['code' => ['required', 'string', 'min:32', 'max:128', 'regex:/^[A-Za-z0-9_-]+$/']],
            ['code.*' => 'This QR code is not valid. Show a new one on your computer and scan it again.']
        );
        [$session, $token] = $this->remote->claim($data['code'], $request->userAgent(), $request->ip());

        return response()->json(['device_token' => $token] + $this->remote->forDevice($session->fresh('user')), 201);
    }

    public function show(Request $request): JsonResponse
    {
        return response()->json($this->remote->forDevice($this->session($request)->load('user')));
    }

    public function command(Request $request): JsonResponse
    {
        $data = $request->validate([
            'kind' => ['required', 'string', 'in:say,stop'],
            'text' => ['nullable', 'required_if:kind,say', 'string', 'max:' . OrbitRemoteService::MAX_TEXT],
        ], [
            'text.required_if' => 'Say or type what Orbit should do.',
            'text.max' => 'Keep it under ' . OrbitRemoteService::MAX_TEXT . ' characters.',
        ]);
        $session = $this->session($request);

        $key = 'orbit-remote-command:' . $session->id;
        if (RateLimiter::tooManyAttempts($key, self::COMMANDS_PER_MINUTE)) {
            return response()->json([
                'message' => 'That is a lot of requests in a short time. Wait a moment, then try again.',
                'errors' => ['text' => ['That is a lot of requests in a short time. Wait a moment, then try again.']],
            ], 429);
        }
        RateLimiter::hit($key, 60);

        $command = $this->remote->sendCommand($session, $data['kind'], $data['text'] ?? null, $request->ip());

        return response()->json(['command' => ['id' => $command->id, 'kind' => $command->kind, 'status' => $command->status]], 201);
    }

    /** Socket authorisation for this phone's own channel only. */
    public function broadcastingAuth(Request $request)
    {
        $session = $this->session($request);
        $request->validate([
            'socket_id' => ['required', 'string', 'max:64', 'regex:/^\d+\.\d+$/'],
            'channel_name' => ['required', 'string', 'in:private-orbit-remote.' . $session->public_id],
        ]);

        return Broadcast::driver()->validAuthenticationResponse($request, true);
    }

    public function end(Request $request): JsonResponse
    {
        $session = $this->session($request);
        $this->remote->end($session, 'disconnected_from_phone', $request->ip());
        return response()->json(['message' => 'Disconnected.']);
    }

    private function session(Request $request): OrbitRemoteSession
    {
        return $request->attributes->get('orbit_remote_session');
    }
}
