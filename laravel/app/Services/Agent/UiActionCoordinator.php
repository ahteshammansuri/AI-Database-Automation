<?php

namespace App\Services\Agent;

use App\Models\AgentTask;
use App\Models\AgentUiAction;
use App\Services\LiveEventService;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;

/**
 * Visible website choreography for Orbit. Before (and after) a backend tool runs, the
 * browser is asked to perform typed, allowlisted UI actions: navigate, open the real
 * form, set controlled field state, press the control. Each action carries a
 * correlation id; the browser acknowledges the real handler result.
 *
 * Choreography is feedback, never the source of truth: if no browser is present the
 * turn continues headless, and backend tools still run and are verified.
 */
class UiActionCoordinator
{
    /** Actions the browser runtime implements. Anything else is never emitted. */
    public const ALLOWED_ACTIONS = [
        'surface.go_to_page',
        'surface.open_form',
        'surface.read_screen',
        'surface.fill_fields',
        'surface.choose_option',
        'surface.press',
        'surface.ask_secret_in_form',
        'surface.show_me',
        'surface.give_tour',
        'surface.explain_page',
    ];

    /** Connection form fields the UI may set (never the password). */
    protected const CONNECTION_FORM_FIELDS = ['name', 'host', 'port', 'database_name', 'username'];

    public static function heartbeat(int $userId): void
    {
        $ttl = (int) config('orbit.client_heartbeat_ttl_seconds', 30);
        Cache::put("orbit-client:{$userId}", now()->timestamp, $ttl + 5);
    }

    public static function clientPresent(int $userId): bool
    {
        $ts = Cache::get("orbit-client:{$userId}");
        return $ts && (now()->timestamp - (int) $ts) <= (int) config('orbit.client_heartbeat_ttl_seconds', 30);
    }

    /**
     * Ask the browser to perform one UI action and wait (bounded) for its real result.
     *
     * @return array{0: string, 1: array}  [status, result]; status is ok, validation_error,
     *                                      not_mounted, error, timeout or headless
     */
    public function request(AgentTask $task, string $action, array $payload, int $timeoutSeconds): array
    {
        if (!self::clientPresent($task->user_id)) {
            $this->record($task, $action, $payload, 'headless', false);
            return ['headless', []];
        }
        $ui = $this->record($task, $action, $payload, 'requested', true);
        $timeoutSeconds = min($timeoutSeconds, (int) config('orbit.ui_ack_timeout_cap_seconds', 600));
        $deadline = microtime(true) + max(1, $timeoutSeconds);
        while (microtime(true) < $deadline) {
            usleep(200_000);
            $ui->refresh();
            if ($ui->status !== 'requested') {
                return [$ui->status, $ui->result ?? []];
            }
        }
        $ui->update(['status' => 'timeout']);

        return ['timeout', []];
    }

    /**
     * Browser acknowledgement for one action. Ownership is enforced by the caller's user id.
     */
    public static function acknowledge(int $userId, string $correlationId, string $status, array $result = []): ?AgentUiAction
    {
        $ui = AgentUiAction::where('user_id', $userId)->where('correlation_id', $correlationId)->first();
        if (!$ui || $ui->status !== 'requested') {
            return $ui;
        }
        $allowed = ['ok', 'validation_error', 'not_mounted', 'error', 'timeout'];
        $ui->update([
            'status' => in_array($status, $allowed, true) ? $status : 'error',
            'result' => self::sanitizeResult($result),
            'acked_at' => now(),
        ]);

        return $ui;
    }

    protected function record(AgentTask $task, string $action, array $payload, string $status, bool $emit): AgentUiAction
    {
        if (!in_array($action, self::ALLOWED_ACTIONS, true)) {
            throw new \InvalidArgumentException("UI action '{$action}' is not allowlisted.");
        }
        if ($action === 'surface.go_to_page' && !in_array($payload['page'] ?? '', SurfaceCatalog::routes(), true)) {
            throw new \InvalidArgumentException('Navigation route is not registered.');
        }

        $ui = AgentUiAction::create([
            'task_id' => $task->id,
            'user_id' => $task->user_id,
            'correlation_id' => (string) Str::uuid(),
            'action' => $action,
            'payload' => $payload,
            'status' => $status,
        ]);

        if ($emit) {
            LiveEventService::publish($task->user_id, 'agent.ui_action', [
                'task_id' => $task->id,
                'correlation_id' => $ui->correlation_id,
                'action' => $action,
                'payload' => $payload,
            ], 'AgentTask', (string) $task->id);
        }

        return $ui;
    }

    /** Browser results are untrusted: drop secret-like keys, cap depth and size. */
    public static function sanitizeResult(array $result, int $depth = 0): array
    {
        $out = [];
        foreach ($result as $k => $v) {
            if (is_string($k) && SecretVault::looksSecretKey($k) && $k !== 'present') {
                continue;
            }
            if (is_array($v)) {
                $out[$k] = $depth < 5 ? self::sanitizeResult(array_slice($v, 0, 60, true), $depth + 1) : '[…]';
            } elseif (is_string($v)) {
                $out[$k] = mb_substr($v, 0, 600);
            } elseif (is_scalar($v) || $v === null) {
                $out[$k] = $v;
            }
        }
        if ($depth === 0 && strlen(json_encode($out)) > 16000) {
            return ['message' => 'Result too large; use read_screen for details.', 'success' => $out['success'] ?? null];
        }

        return $out;
    }
}
