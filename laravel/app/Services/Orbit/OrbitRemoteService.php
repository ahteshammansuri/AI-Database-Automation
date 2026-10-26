<?php

namespace App\Services\Orbit;

use App\Events\OrbitRemoteSignal;
use App\Models\AuditLog;
use App\Models\OrbitRemoteCommand;
use App\Models\OrbitRemoteSession;
use App\Models\User;
use App\Services\LiveEventService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Orbit Remote: pair a phone with one portal tab by QR code. The phone sends spoken requests; the tab runs them
 * through the normal Orbit pipeline (so page context, confirmations and secure fields stay on the computer) and
 * mirrors the web Orbit back to the phone.
 *
 * Security: the pairing code is single use and valid for 3 minutes; the device token only works on the
 * `/api/orbit-remote/device/*` endpoints; both are stored as SHA-256 hashes. One phone per account. A session ends
 * when either side disconnects, when the paired tab signs out, after 2 hours idle or 12 hours in total.
 */
class OrbitRemoteService
{
    // Defaults; the live values are admin settings (Settings > Orbit Remote), read through the methods below.
    public const PAIRING_TTL_SECONDS = 180;
    public const SESSION_TTL_HOURS = 12;
    public const IDLE_MINUTES = 120;
    /** The computer counts as connected while its tab reported within this window. */
    public const DESKTOP_ONLINE_SECONDS = 45;
    /** A request older than this is not run (it would surprise the user). */
    public const COMMAND_MAX_AGE_SECONDS = 30;
    public const MAX_TEXT = 1000;

    private const SEEN_WRITE_SECONDS = 15;

    public static function enabled(): bool
    {
        return (bool) config('orbit.remote_enabled', true) && (bool) config('orbit.enabled', true);
    }

    public static function pairingSeconds(): int
    {
        return max(60, (int) config('orbit.remote_pairing_seconds', self::PAIRING_TTL_SECONDS));
    }

    public static function sessionHours(): int
    {
        return max(1, (int) config('orbit.remote_session_hours', self::SESSION_TTL_HOURS));
    }

    public static function idleMinutes(): int
    {
        return max(5, (int) config('orbit.remote_idle_minutes', self::IDLE_MINUTES));
    }

    private const SECRET_PATTERNS = [
        '/(?:password|passwd|pass\s?code|pass|secret)\s*(?:is|to|:|equals|=)\s*["\']?([^\s,;\'")]+)/i',
        '/(?:api[_\-\s]?key|secret[_\-\s]?key|openai[_\-\s]?key|anthropic[_\-\s]?key|gemini[_\-\s]?key)\s*(?:is|to|:|equals|=)\s*["\']?([^\s,;\'")]+)/i',
        '/(?:bearer\s+token|auth[_\-\s]?token|access[_\-\s]?token)\s*(?:is|to|:|equals|=)\s*["\']?([^\s,;\'")]+)/i',
        '/\b(sk-[A-Za-z0-9_\-]{20,})\b/',
        '/\b(AIza[0-9A-Za-z_\-]{30,})\b/',
    ];
    private const NOT_A_SECRET = ['is', 'to', 'the', 'a', 'an', 'not', 'none', 'null', 'same', 'my', 'your', 'it', 'this', 'that', 'blank', 'empty'];

    // ------------------------------------------------------------------ pairing

    /** @return array{0: OrbitRemoteSession, 1: string} the session and the one-time pairing code */
    public function startPairing(User $user, string $instance, ?int $tokenId, ?string $userAgent, ?string $ip): array
    {
        // One phone per account: a new code replaces any earlier code or connected phone.
        OrbitRemoteSession::where('user_id', $user->id)->whereIn('status', ['pending', 'active'])->get()
            ->each(fn (OrbitRemoteSession $old) => $this->end($old, 'replaced', $ip));

        $code = $this->secret();
        $session = OrbitRemoteSession::create([
            'user_id' => $user->id,
            'public_id' => Str::lower(Str::random(32)),
            'status' => 'pending',
            'pairing_code_hash' => hash('sha256', $code),
            'pairing_expires_at' => now()->addSeconds(self::pairingSeconds()),
            'desktop_instance' => $instance,
            'desktop_token_id' => $tokenId,
            'desktop_label' => self::browserLabel($userAgent, 'computer'),
            'last_desktop_seen_at' => now(),
        ]);

        AuditLog::log($user->id, 'ORBIT_REMOTE_PAIRING_CREATED', 'OrbitRemoteSession', $session->public_id, [
            'expires_at' => $session->pairing_expires_at->toIso8601String(),
        ], $ip);

        return [$session, $code];
    }

    /**
     * Exchange a scanned code for a device token (once).
     *
     * @return array{0: OrbitRemoteSession, 1: string}
     * @throws ValidationException when the code is unknown, used or expired
     */
    public function claim(string $code, ?string $userAgent, ?string $ip): array
    {
        $result = DB::transaction(function () use ($code, $userAgent, $ip) {
            $session = OrbitRemoteSession::where('pairing_code_hash', hash('sha256', $code))->lockForUpdate()->first();
            if (!$session || $session->status !== 'pending') {
                return 'invalid';
            }
            if ($session->pairing_expires_at === null || $session->pairing_expires_at->isPast()) {
                return $session;
            }

            $token = $this->secret();
            $session->update([
                'status' => 'active',
                'pairing_code_hash' => null,
                'device_token_hash' => hash('sha256', $token),
                'device_label' => self::browserLabel($userAgent, 'phone'),
                'device_ip' => $ip,
                'claimed_at' => now(),
                'last_device_seen_at' => now(),
                'expires_at' => now()->addHours(self::sessionHours()),
            ]);
            return [$session, $token];
        });

        if ($result === 'invalid') {
            throw ValidationException::withMessages(['code' => ['This QR code was already used or is no longer valid. Show a new one on your computer.']]);
        }
        if ($result instanceof OrbitRemoteSession) {
            $this->end($result, 'pairing_expired', $ip);
            throw ValidationException::withMessages(['code' => ['This QR code has expired. Show a new one on your computer and scan it again.']]);
        }

        [$session] = $result;
        AuditLog::log($session->user_id, 'ORBIT_REMOTE_PAIRED', 'OrbitRemoteSession', $session->public_id, [
            'device' => $session->device_label,
        ], $ip);
        LiveEventService::publish($session->user_id, 'orbit.remote_paired', [
            'session' => $session->public_id,
            'device_label' => $session->device_label,
        ], 'OrbitRemoteSession', $session->public_id);
        $this->signal($session, 'paired', ['device_label' => $session->device_label]);

        return $result;
    }

    // ------------------------------------------------------------------ the phone

    /**
     * The session a device token belongs to. Returns [session, reason]: session is null when the phone may not act
     * (reason: not_connected, ended, expired).
     *
     * @return array{0: ?OrbitRemoteSession, 1: ?string}
     */
    public function sessionForDevice(?string $token): array
    {
        if (!$token || strlen($token) < 32 || strlen($token) > 128) {
            return [null, 'not_connected'];
        }
        $session = OrbitRemoteSession::where('device_token_hash', hash('sha256', $token))->first();
        if (!$session) {
            return [null, 'not_connected'];
        }
        if ($session->status !== 'active') {
            return [null, $session->end_reason ?: 'ended'];
        }
        $idleSince = $session->last_device_seen_at ?? $session->claimed_at;
        if (($session->expires_at && $session->expires_at->isPast()) || ($idleSince && $idleSince->lt(now()->subMinutes(self::idleMinutes())))) {
            $this->end($session, 'expired');
            return [null, 'expired'];
        }
        return [$session, null];
    }

    public function touchDevice(OrbitRemoteSession $session): void
    {
        if (!$session->last_device_seen_at || $session->last_device_seen_at->lt(now()->subSeconds(self::SEEN_WRITE_SECONDS))) {
            $session->forceFill(['last_device_seen_at' => now()])->save();
        }
    }

    public function desktopOnline(OrbitRemoteSession $session): bool
    {
        return $session->desktop_instance !== null
            && $session->last_desktop_seen_at !== null
            && $session->last_desktop_seen_at->gt(now()->subSeconds(self::DESKTOP_ONLINE_SECONDS));
    }

    /**
     * A request from the phone for the web Orbit. Passwords and keys are refused (they belong in the secure field on
     * the computer); requests are refused while the computer is not connected, so nothing runs later by surprise.
     *
     * @throws ValidationException
     */
    public function sendCommand(OrbitRemoteSession $session, string $kind, ?string $text, ?string $ip): OrbitRemoteCommand
    {
        $text = $kind === 'say' ? trim((string) $text) : null;
        if ($kind === 'say' && self::containsSecret($text)) {
            throw ValidationException::withMessages(['text' => [
                'For your safety, passwords and API keys are never sent from your phone. Type them on the computer, in Orbit\'s secure field.',
            ]]);
        }
        if (!$this->desktopOnline($session)) {
            throw ValidationException::withMessages(['text' => [
                'Your computer is not connected right now. Open ' . config('platform.brand_name') . ' there, then try again.',
            ]]);
        }

        $command = OrbitRemoteCommand::create([
            'session_id' => $session->id,
            'user_id' => $session->user_id,
            'kind' => $kind,
            'text' => $text,
            'status' => 'sent',
        ]);

        LiveEventService::publish($session->user_id, 'orbit.remote_command', [
            'session' => $session->public_id,
            'instance' => $session->desktop_instance,
            'command_id' => $command->id,
            'kind' => $kind,
            'text' => $text,
            'sent_at' => $command->created_at->toIso8601String(),
        ], 'OrbitRemoteSession', $session->public_id);

        AuditLog::log($session->user_id, 'ORBIT_REMOTE_COMMAND', 'OrbitRemoteSession', $session->public_id, [
            'command_id' => $command->id,
            'kind' => $kind,
            'length' => $text !== null ? mb_strlen($text) : 0,
        ], $ip);

        return $command;
    }

    // ------------------------------------------------------------------ the computer

    /**
     * Let a tab take over the session (after a reload or when the original tab was closed). Refused while a different
     * tab is still reporting.
     */
    public function attachDesktop(OrbitRemoteSession $session, string $instance, ?int $tokenId): bool
    {
        if ($session->desktop_instance === $instance) {
            return true;
        }
        if ($this->desktopOnline($session)) {
            return false;
        }
        $session->forceFill([
            'desktop_instance' => $instance,
            'desktop_token_id' => $tokenId ?? $session->desktop_token_id,
            'last_desktop_seen_at' => now(),
        ])->save();
        return true;
    }

    public function recordDesktopState(OrbitRemoteSession $session, ?array $state): void
    {
        $fill = ['last_desktop_seen_at' => now()];
        if ($state !== null) {
            $fill['desktop_state'] = $state + ['at' => now()->toIso8601String()];
        }
        $session->forceFill($fill)->save();
    }

    /**
     * The tab took (or refused) a request. A request that reaches the tab late (e.g. while its live link was down) is
     * refused here, by the server's clock, so it never runs by surprise. Returns the final status ("duplicate" when it
     * was already taken); the tab only runs the request when this is "received".
     */
    public function acknowledge(OrbitRemoteSession $session, OrbitRemoteCommand $command, string $status, ?string $reason): string
    {
        if ($command->status !== 'sent') {
            return 'duplicate'; // already taken (e.g. by a duplicated tab): only the first tab runs it
        }
        if ($status === 'received' && $command->created_at->lt(now()->subSeconds(self::COMMAND_MAX_AGE_SECONDS))) {
            [$status, $reason] = ['rejected', 'too_old'];
        }
        $command->update(['status' => $status, 'reason' => $reason, 'received_at' => now()]);
        $this->signal($session, 'command', ['command_id' => $command->id, 'status' => $status, 'reason' => $reason]);
        return $status;
    }

    // ------------------------------------------------------------------ ending

    public function end(OrbitRemoteSession $session, string $reason, ?string $ip = null): void
    {
        if ($session->status === 'ended') {
            return;
        }
        $wasActive = $session->status === 'active';
        $session->forceFill([
            'status' => 'ended',
            'pairing_code_hash' => null,
            'ended_at' => now(),
            'end_reason' => $reason,
        ])->save();

        $this->signal($session, 'ended', ['reason' => $reason]);
        LiveEventService::publish($session->user_id, 'orbit.remote_ended', [
            'session' => $session->public_id,
            'reason' => $reason,
        ], 'OrbitRemoteSession', $session->public_id);
        if ($wasActive || $reason !== 'replaced') {
            AuditLog::log($session->user_id, 'ORBIT_REMOTE_ENDED', 'OrbitRemoteSession', $session->public_id, [
                'reason' => $reason,
                'was_connected' => $wasActive,
            ], $ip);
        }
    }

    /** Signing out of a tab disconnects the phone paired with it. */
    public function endForToken(int $userId, ?int $tokenId, string $reason): void
    {
        if ($tokenId === null) {
            return;
        }
        OrbitRemoteSession::where('user_id', $userId)->where('desktop_token_id', $tokenId)->whereIn('status', ['pending', 'active'])->get()
            ->each(fn (OrbitRemoteSession $s) => $this->end($s, $reason));
    }

    // ------------------------------------------------------------------ views

    public function forDesktop(OrbitRemoteSession $session, ?string $instance = null): array
    {
        return [
            'id' => $session->public_id,
            'status' => $session->status,
            'pairing_expires_at' => $session->pairing_expires_at?->toIso8601String(),
            'device_label' => $session->device_label,
            'device_online' => $session->status === 'active' && $session->last_device_seen_at?->gt(now()->subSeconds(60)),
            'claimed_at' => $session->claimed_at?->toIso8601String(),
            'expires_at' => $session->expires_at?->toIso8601String(),
            'attached_here' => $instance !== null && $session->desktop_instance === $instance,
            'end_reason' => $session->end_reason,
        ];
    }

    public function forDevice(OrbitRemoteSession $session): array
    {
        $first = Str::of((string) $session->user?->name)->trim()->explode(' ')->first();
        return [
            'session' => [
                'id' => $session->public_id,
                'status' => $session->status,
                'device_label' => $session->device_label,
                'desktop_label' => $session->desktop_label,
                'expires_at' => $session->expires_at?->toIso8601String(),
                'owner_first_name' => $first ?: null,
            ],
            'desktop' => [
                'online' => $this->desktopOnline($session),
                'last_seen_at' => $session->last_desktop_seen_at?->toIso8601String(),
                'state' => $session->desktop_state,
            ],
            'commands' => $session->commands()->latest('id')->limit(5)->get(['id', 'kind', 'status', 'reason', 'created_at'])
                ->map(fn ($c) => ['id' => $c->id, 'kind' => $c->kind, 'status' => $c->status, 'reason' => $c->reason])->all(),
            'limits' => ['max_text' => self::MAX_TEXT],
        ];
    }

    // ------------------------------------------------------------------ helpers

    /**
     * Private IPv4 addresses of this machine, so a computer that opened the portal as "localhost" can still show a
     * QR code a phone on the same Wi-Fi can open. Container and virtual bridges are skipped.
     *
     * @return string[]
     */
    public function lanAddresses(): array
    {
        if (!function_exists('net_get_interfaces')) {
            return [];
        }
        $out = [];
        foreach ((array) @net_get_interfaces() as $name => $iface) {
            if (preg_match('/^(lo|docker|br-|veth|virbr|vmnet|vboxnet|tun|tap|zt|tailscale|wg)/i', (string) $name) || empty($iface['up'])) {
                continue;
            }
            foreach ($iface['unicast'] ?? [] as $addr) {
                $ip = $addr['address'] ?? null;
                if (($addr['family'] ?? null) === AF_INET && $ip && self::isPrivateIpv4($ip)) {
                    $out[] = $ip;
                }
            }
        }
        // Home and office Wi-Fi (192.168.x.x) first.
        usort($out, fn ($a, $b) => (str_starts_with($b, '192.168.') <=> str_starts_with($a, '192.168.')) ?: strcmp($a, $b));
        return array_values(array_unique($out));
    }

    public static function isPrivateIpv4(string $ip): bool
    {
        if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
            return false;
        }
        return str_starts_with($ip, '10.')
            || str_starts_with($ip, '192.168.')
            || (bool) preg_match('/^172\.(1[6-9]|2\d|3[01])\./', $ip);
    }

    public static function containsSecret(?string $text): bool
    {
        if (!$text) {
            return false;
        }
        foreach (self::SECRET_PATTERNS as $re) {
            if (preg_match_all($re, $text, $m)) {
                foreach ($m[1] as $value) {
                    $v = strtolower(rtrim(trim($value, "\"' "), '.!?'));
                    if (mb_strlen($v) >= 2 && !in_array($v, self::NOT_A_SECRET, true)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    /** "iPhone · Safari", "Android phone · Chrome", "Chrome on Linux" ... (never the raw user agent). */
    public static function browserLabel(?string $ua, string $fallback): string
    {
        $ua = (string) $ua;
        $browser = match (true) {
            (bool) preg_match('/EdgiOS|Edg\//', $ua) => 'Edge',
            (bool) preg_match('/SamsungBrowser/', $ua) => 'Samsung Internet',
            (bool) preg_match('/FxiOS|Firefox\//', $ua) => 'Firefox',
            (bool) preg_match('/CriOS|Chrome\//', $ua) => 'Chrome',
            (bool) preg_match('/Safari\//', $ua) => 'Safari',
            default => null,
        };
        $device = match (true) {
            str_contains($ua, 'iPhone') => 'iPhone',
            str_contains($ua, 'iPad') => 'iPad',
            str_contains($ua, 'Android') && str_contains($ua, 'Mobile') => 'Android phone',
            str_contains($ua, 'Android') => 'Android tablet',
            default => null,
        };
        if ($device) {
            return $browser ? "{$device} · {$browser}" : $device;
        }
        $os = match (true) {
            str_contains($ua, 'Windows') => 'Windows',
            str_contains($ua, 'Mac OS X') => 'macOS',
            str_contains($ua, 'CrOS') => 'ChromeOS',
            str_contains($ua, 'Linux') => 'Linux',
            default => null,
        };
        if ($browser && $os) {
            return "{$browser} on {$os}";
        }
        return $browser ?? ($fallback === 'phone' ? 'Phone' : 'Computer');
    }

    private function secret(): string
    {
        return rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    }

    private function signal(OrbitRemoteSession $session, string $type, array $data = []): void
    {
        try {
            broadcast(new OrbitRemoteSignal($session->public_id, $type, $data));
        } catch (\Throwable $e) {
            Log::warning("Orbit Remote signal '{$type}' was not delivered: " . $e->getMessage());
        }
    }
}
