<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\OrbitRemoteCommand;
use App\Models\OrbitRemoteSession;
use App\Services\Orbit\OrbitRemoteService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Orbit Remote, computer side (signed-in tab): show a pairing QR code, keep the paired phone up to date, take the
 * phone's requests, disconnect.
 */
class OrbitRemoteController extends Controller
{
    private const INSTANCE_RULE = ['required', 'string', 'min:8', 'max:64', 'regex:/^[A-Za-z0-9_-]+$/'];

    public function __construct(private OrbitRemoteService $remote) {}

    /** New pairing code (replaces any earlier code or connected phone). The code is returned only here, once. */
    public function store(Request $request): JsonResponse
    {
        if (!OrbitRemoteService::enabled()) {
            return response()->json(['message' => 'Orbit Remote is turned off by the administrator.'], 403);
        }
        $data = $request->validate(['instance' => self::INSTANCE_RULE], ['instance.*' => 'Reload the page and try again.']);
        [$session, $code] = $this->remote->startPairing(
            $request->user(), $data['instance'], $this->tokenId($request), $request->userAgent(), $request->ip()
        );

        return response()->json([
            'session' => $this->remote->forDesktop($session, $data['instance']),
            'code' => $code,
            'pairing_ttl_seconds' => OrbitRemoteService::pairingSeconds(),
            'lan_addresses' => $this->remote->lanAddresses(),
            'public_url' => config('orbit.remote_public_url') ?: null,
        ], 201);
    }

    /** The account's pending or connected phone (to restore the panel after a reload). */
    public function current(Request $request): JsonResponse
    {
        $request->validate(['instance' => ['nullable', 'string', 'max:64']]);
        $session = OrbitRemoteSession::where('user_id', $request->user()->id)->whereIn('status', ['pending', 'active'])->latest('id')->first();
        if ($session && $session->status === 'pending' && $session->pairing_expires_at?->isPast()) {
            $this->remote->end($session, 'pairing_expired', $request->ip());
            $session = null;
        }

        return response()->json([
            'session' => $session ? $this->remote->forDesktop($session, $request->query('instance')) : null,
            'lan_addresses' => $this->remote->lanAddresses(),
            'public_url' => config('orbit.remote_public_url') ?: null,
        ]);
    }

    /** This tab takes over the connected phone (refused while another tab is still in charge). */
    public function attach(Request $request, string $publicId): JsonResponse
    {
        $data = $request->validate(['instance' => self::INSTANCE_RULE]);
        $session = $this->owned($request, $publicId);
        if ($session->status === 'ended') {
            return response()->json(['message' => 'This phone is no longer connected.', 'session' => $this->remote->forDesktop($session)], 410);
        }
        if (!$this->remote->attachDesktop($session, $data['instance'], $this->tokenId($request))) {
            return response()->json(['message' => 'Your phone is controlling ' . config('platform.brand_name') . ' in another tab or window.'], 409);
        }
        return response()->json(['session' => $this->remote->forDesktop($session->fresh(), $data['instance'])]);
    }

    /** Heartbeat with the web Orbit's latest state (for the phone's first view and when its live link is down). */
    public function state(Request $request, string $publicId): JsonResponse
    {
        $data = $request->validate([
            'instance' => self::INSTANCE_RULE,
            'state' => ['nullable', 'array'],
            'state.face' => ['nullable', 'string', 'max:32', 'regex:/^[a-z_]+$/'],
            'state.emotion' => ['nullable', 'string', 'max:24', 'regex:/^[a-z_]+$/'],
            'state.status' => ['nullable', 'string', 'max:160'],
            'state.caption' => ['nullable', 'string', 'max:600'],
            'state.caption_kind' => ['nullable', 'string', 'in:speech,narration,user'],
            'state.speaking' => ['nullable', 'boolean'],
            'state.working' => ['nullable', 'boolean'],
            'state.needs' => ['nullable', 'string', 'in:confirm,secret,input'],
            'state.task' => ['nullable', 'string', 'max:200'],
            'state.page' => ['nullable', 'string', 'max:120'],
        ]);
        $session = $this->owned($request, $publicId);
        if ($session->status === 'ended') {
            return response()->json(['message' => 'This phone is no longer connected.', 'session' => $this->remote->forDesktop($session)], 410);
        }
        if ($session->desktop_instance !== $data['instance']) {
            return response()->json(['message' => 'Your phone is controlling ' . config('platform.brand_name') . ' in another tab or window.'], 409);
        }

        $keys = ['face', 'emotion', 'status', 'caption', 'caption_kind', 'speaking', 'working', 'needs', 'task', 'page'];
        $state = isset($data['state']) ? array_intersect_key($data['state'], array_flip($keys)) : null;
        $this->remote->recordDesktopState($session, $state);

        return response()->json(['session' => $this->remote->forDesktop($session, $data['instance'])]);
    }

    /** The tab confirms it took (or refused) a request from the phone. */
    public function acknowledge(Request $request, string $publicId, int $commandId): JsonResponse
    {
        $data = $request->validate([
            'instance' => self::INSTANCE_RULE,
            'status' => ['required', 'string', 'in:received,rejected'],
            'reason' => ['nullable', 'string', 'max:200'],
        ]);
        $session = $this->owned($request, $publicId);
        if ($session->desktop_instance !== $data['instance']) {
            return response()->json(['message' => 'Your phone is controlling ' . config('platform.brand_name') . ' in another tab or window.'], 409);
        }
        $command = OrbitRemoteCommand::where('session_id', $session->id)->findOrFail($commandId);
        $status = $this->remote->acknowledge($session, $command, $data['status'], $data['reason'] ?? null);

        return response()->json(['command' => ['id' => $command->id, 'status' => $status]]);
    }

    public function destroy(Request $request, string $publicId): JsonResponse
    {
        $session = $this->owned($request, $publicId);
        $this->remote->end($session, 'disconnected_from_computer', $request->ip());
        return response()->json(['session' => $this->remote->forDesktop($session->fresh())]);
    }

    /** The signed-in tab's API token (so signing out there disconnects the phone it paired). */
    private function tokenId(Request $request): ?int
    {
        $token = $request->user()->currentAccessToken();
        return $token instanceof \Laravel\Sanctum\PersonalAccessToken ? (int) $token->id : null;
    }

    private function owned(Request $request, string $publicId): OrbitRemoteSession
    {
        return OrbitRemoteSession::where('user_id', $request->user()->id)->where('public_id', $publicId)->firstOrFail();
    }
}
