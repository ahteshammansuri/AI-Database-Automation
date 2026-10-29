<?php

namespace App\Services\Agent;

use App\Models\AgentSecureInput;
use App\Models\AgentTask;
use App\Models\User;
use Illuminate\Support\Str;

/**
 * Holds secrets captured through Orbit's secure channel (masked field or a secret
 * redacted out of an utterance). Secrets are encrypted at rest, scoped to one user
 * and task, expire, and are injected into tool arguments only at execution time.
 *
 * Nothing here ever writes a secret to task plans, slots, messages, events or logs.
 * The model only learns that a secret of a given kind has been captured.
 */
class SecretVault
{
    /** Secure-input kinds and the tool argument each one fills. */
    public const KIND_PARAMS = [
        'database_password' => 'password',
        'api_key' => 'api_key',
    ];

    /** Field names in secure_input_data that are secrets, mapped to their kind. */
    protected const SECRET_FIELDS = [
        'password' => 'database_password',
        'db_password' => 'database_password',
        'api_key' => 'api_key',
        'apikey' => 'api_key',
    ];

    public function store(User $user, AgentTask $task, string $kind, string $secret): AgentSecureInput
    {
        // A newer secret of the same kind replaces older unconsumed ones for this task.
        AgentSecureInput::where('task_id', $task->id)->where('kind', $kind)->whereNull('consumed_at')
            ->update(['consumed_at' => now(), 'payload' => null]);

        return AgentSecureInput::create([
            'handle' => (string) Str::uuid(),
            'user_id' => $user->id,
            'task_id' => $task->id,
            'kind' => $kind,
            'payload' => ['value' => $secret],
            'expires_at' => now()->addMinutes(config('orbit.secure_input_ttl_minutes', 30)),
        ]);
    }

    /**
     * Split a secure_input_data submission into secrets (stored in the vault) and
     * non-secret fields (returned so they can become task slots).
     */
    public function absorb(User $user, AgentTask $task, array $data): array
    {
        $nonSecret = [];
        foreach ($data as $key => $value) {
            $kind = self::SECRET_FIELDS[strtolower((string) $key)] ?? null;
            if ($kind !== null) {
                if (is_string($value) && $value !== '') {
                    $this->store($user, $task, $kind, $value);
                }
                continue;
            }
            if (is_scalar($value) && !self::looksSecretKey((string) $key)) {
                $nonSecret[$key] = $value;
            }
        }

        return $nonSecret;
    }

    public function has(AgentTask $task, string $kind): bool
    {
        return $this->active($task, $kind) !== null;
    }

    /** Which kinds are captured for this task: e.g. ['database_password' => true, 'api_key' => false]. */
    public function capturedKinds(AgentTask $task): array
    {
        $out = [];
        foreach (array_keys(self::KIND_PARAMS) as $kind) {
            $out[$kind] = $this->has($task, $kind);
        }

        return $out;
    }

    public function reveal(AgentTask $task, string $kind): ?string
    {
        return $this->active($task, $kind)?->payload['value'] ?? null;
    }

    public function consume(AgentTask $task, string $kind): void
    {
        AgentSecureInput::where('task_id', $task->id)->where('kind', $kind)->whereNull('consumed_at')
            ->update(['consumed_at' => now(), 'payload' => null]);
    }

    /** Every unconsumed secret value for the task, used to scrub tool output before persistence. */
    public function allValues(AgentTask $task): array
    {
        return AgentSecureInput::where('task_id', $task->id)->whereNull('consumed_at')->get()
            ->map(fn ($r) => $r->payload['value'] ?? null)->filter()->values()->all();
    }

    protected function active(AgentTask $task, string $kind): ?AgentSecureInput
    {
        return AgentSecureInput::where('task_id', $task->id)
            ->where('user_id', $task->user_id)
            ->where('kind', $kind)
            ->whereNull('consumed_at')
            ->where('expires_at', '>', now())
            ->latest('id')
            ->first();
    }

    public static function looksSecretKey(string $key): bool
    {
        return (bool) preg_match('/pass(word)?|secret|token|api[_-]?key|credential/i', $key);
    }

    /** The secure-input kind that fills a secret-named tool argument (e.g. password => database_password). */
    public static function kindForParam(string $param): string
    {
        return self::SECRET_FIELDS[strtolower($param)] ?? strtolower($param);
    }

    /**
     * Server-side safety net: remove secrets spoken/typed inline in an utterance.
     * Returns [redactedText, ['database_password' => '...', 'api_key' => '...']].
     * The browser redacts first; this catches anything that slipped through.
     */
    public static function redactUtterance(string $text): array
    {
        $found = [];
        $patterns = [
            'database_password' => '/\b(?:db\s+)?(?:password|passcode|passwd|pwd)\s*(?:is|=|:|would be|will be)\s*["\']?([^\s"\',]+)["\']?/i',
            'api_key' => '/\b((?:sk|pk|rk)-[A-Za-z0-9_\-]{12,}|AIza[0-9A-Za-z_\-]{20,}|sk-ant-[A-Za-z0-9_\-]{12,})\b/',
        ];
        foreach ($patterns as $kind => $re) {
            $text = preg_replace_callback($re, function ($m) use ($kind, &$found) {
                $found[$kind] = $m[1];
                return str_replace($m[1], '[REDACTED]', $m[0]);
            }, $text);
        }

        return [$text, $found];
    }

    /** Replace any known secret value appearing in a string. */
    public static function scrub(string $text, array $secrets): string
    {
        foreach ($secrets as $s) {
            if (is_string($s) && strlen($s) >= 3) {
                $text = str_replace($s, '[REDACTED]', $text);
            }
        }

        return $text;
    }
}
