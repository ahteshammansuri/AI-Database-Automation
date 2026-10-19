<?php

namespace App\Services\Agent;

use App\Models\AgentTask;
use App\Models\Automation;
use App\Models\ContentVersion;
use App\Models\DbConnection;
use App\Models\SchemaSnapshot;
use App\Models\User;

/**
 * Executes one validated tool call through AgentToolRegistry and returns a normalized
 * ToolResult. Secrets are injected from SecretVault here and nowhere else.
 */
class ToolRunner
{
    protected const RESOURCE_REFS = ['connection_id', 'automation_id', 'execution_id', 'version_id', 'document_id', 'target_record_id'];

    /** Resource types a pressed UI action may report, checked for owner on the server. */
    protected const VERIFIABLE = [
        'DbConnection' => \App\Models\DbConnection::class,
        'Automation' => \App\Models\Automation::class,
        'AutomationExecution' => \App\Models\AutomationExecution::class,
        'KnowledgeDocument' => \App\Models\KnowledgeDocument::class,
        'AiProvider' => \App\Models\AiProvider::class,
        'ContentVersion' => \App\Models\ContentVersion::class,
    ];

    public function __construct(protected SecretVault $vault, protected UiActionCoordinator $ui)
    {
    }

    /**
     * Run an on-screen tool in the user's browser and turn its acknowledgement into a ToolResult.
     * A pressed action that claims to create/change something is re-checked on the server.
     */
    public function runUi(User $user, AgentTask $task, array $def, array $args): array
    {
        $tool = $def['name'];
        $check = SurfaceCatalog::check($tool, $args);
        $payload = $args;
        $timeout = $check['timeout'];
        if ($tool === 'press' && !empty($check['consequential'])) {
            // Reaching here means ToolPolicyGate saw the user's explicit confirmation, so the browser may
            // click the page's own confirmation popup (visibly). Without this flag it never does.
            $payload['user_confirmed'] = true;
            $timeout += 6;
        }
        [$status, $res] = $this->ui->request($task, "surface.{$tool}", $payload, $timeout);

        if ($status === 'headless') {
            return $this->result(false, 'NO_BROWSER', 'The portal is not open in a browser, so Orbit cannot operate the screen. Ask the user to open the portal, or use a backend tool.');
        }
        if ($status === 'timeout') {
            return $this->result(false, 'UI_TIMEOUT', 'The page did not respond in time; nothing is confirmed. Use read_screen to see the current state.', retryable: true);
        }
        if ($status === 'not_mounted') {
            return $this->result(false, 'NOT_ON_SCREEN', (string) ($res['message'] ?? 'That surface is not on screen. Use go_to_page or open_form first.'), retryable: true, data: $res);
        }

        $success = $status === 'ok' && ($res['success'] ?? true) !== false;
        $message = (string) ($res['message'] ?? ($success ? 'Done on screen.' : 'The page reported a problem.'));
        $data = array_diff_key($res, array_flip(['success', 'message']));
        $category = $success ? null : ($status === 'validation_error' ? 'VALIDATION_ERROR' : 'UI_ACTION_FAILED');

        $result = $this->result($success, $category, mb_substr($message, 0, 500), data: $data);

        if ($tool === 'press' && $success) {
            $surface = SurfaceCatalog::surface((string) $args['surface']);
            $action = SurfaceCatalog::action($surface, (string) $args['action']);
            $result['side_effect_committed'] = !empty($action['consequential']) || !empty($action['verifies']);
            if (!empty($action['verifies'])) {
                $type = $action['verifies'];
                $id = $res['resource']['id'] ?? ($action['row'] ?? false ? $args['row'] : null);
                $model = self::VERIFIABLE[$type] ?? null;
                $owned = $model && $id !== null && $model::where('user_id', $user->id)->whereKey($id)->exists();
                $result['verified'] = (bool) $owned;
                $result['resource_refs'] = $owned ? [self::refKey($type) => is_numeric($id) ? (int) $id : $id] : [];
                $result['verification'] = $owned
                    ? "{$type} {$id} re-checked on the server for your workspace."
                    : "Could not confirm the {$type} on the server.";
                if (!$owned) {
                    $result['success'] = false;
                    $result['status'] = 'unverified';
                    $result['error_category'] = 'VERIFICATION_FAILED';
                    $result['safe_message'] = "The page reported success, but the server could not confirm the {$type}. Use read_screen or a lookup tool to check.";
                }
            } else {
                $result['verified'] = true;
            }
        } elseif ($success) {
            $result['verified'] = true;
        }

        return $result;
    }

    protected static function refKey(string $type): string
    {
        return match ($type) {
            'DbConnection' => 'connection_id',
            'Automation' => 'automation_id',
            'AutomationExecution' => 'execution_id',
            'KnowledgeDocument' => 'document_id',
            'ContentVersion' => 'version_id',
            default => strtolower($type) . '_id',
        };
    }

    /**
     * @return array{success: bool, status: string, error_category: ?string, safe_message: string,
     *               retryable: bool, side_effect_committed: bool, verified: bool, resource_refs: array, data: array}
     */
    public function run(User $user, AgentTask $task, array $def, array $args): array
    {
        if (($def['side_effect_class'] ?? null) === 'ui') {
            return $this->runUi($user, $task, $def, $args);
        }
        $tool = $def['name'];
        $execArgs = $args;

        foreach ($def['secret_params'] ?? [] as $param => $kind) {
            $secret = $this->vault->reveal($task, $kind);
            if ($secret !== null) {
                $execArgs[$param] = $secret;
            } elseif ($this->secretRequired($tool, $args)) {
                return $this->result(false, 'SECRET_REQUIRED',
                    "A {$this->kindLabel($kind)} is needed but has not been captured. Ask the user to enter it in the secure field.",
                    retryable: true, extra: ['secure_input_type' => $kind]);
            }
        }

        $secrets = $this->vault->allValues($task);
        try {
            $raw = AgentToolRegistry::executeTool($user, $tool, $execArgs);
        } catch (\Throwable $e) {
            report($e);
            return $this->result(false, 'TOOL_ERROR', SecretVault::scrub("The {$tool} tool failed unexpectedly.", $secrets));
        }

        $success = (bool) ($raw['success'] ?? false);
        $message = (string) ($raw['message'] ?? $raw['error'] ?? ($success ? 'Done.' : 'Failed.'));
        $message = SecretVault::scrub(mb_substr($message, 0, 500), $secrets);
        $category = $success ? null : ($raw['error_category'] ?? $this->classify((string) ($raw['error'] ?? '')));

        $refs = [];
        foreach (self::RESOURCE_REFS as $key) {
            if (!empty($raw[$key])) {
                $refs[$key] = $raw[$key];
            }
        }
        $data = $this->sanitize(array_diff_key($raw, array_flip(['success', 'message', 'error', 'error_category'])), $secrets);

        $committed = $success && !in_array($def['side_effect_class'] ?? 'read', ['read'], true);
        $result = $this->result($success, $category, $message,
            retryable: in_array($category, ['UNREACHABLE', 'TIMEOUT'], true),
            committed: $committed, refs: $refs, data: $data);

        if ($success) {
            [$verified, $detail] = $this->verify($user, $def, $refs);
            $result['verified'] = $verified;
            if ($detail) {
                $result['verification'] = $detail;
            }
            if (!$verified) {
                $result['success'] = false;
                $result['status'] = 'unverified';
                $result['error_category'] = 'VERIFICATION_FAILED';
                $result['safe_message'] = "The tool reported success but the result could not be verified: {$detail}";
            }
            if ($tool === 'test_database_connection' && empty($args['connection_id'])) {
                // Typed workflow hint from the tool result (not from the user's wording).
                $result['next_step'] = 'These NEW details work but are NOT saved. If the user wants this database connected or added, call save_database_connection with the same host, port, database, username and a name (ask for a name only if none is known).';
            }
            if ($tool === 'save_database_connection' && $verified) {
                $this->vault->consume($task, 'database_password');
            }
            if ($tool === 'save_ai_provider' && $verified) {
                $this->vault->consume($task, 'api_key');
            }
        }

        return $result;
    }

    /**
     * Compact view of a result for the model: enough to reason about, nothing secret,
     * bounded size. Large schema payloads are reduced to table names and categories.
     */
    public function modelView(array $result): array
    {
        $data = $result['data'] ?? [];
        if (isset($data['tables']) && is_array($data['tables'])) {
            $data['tables'] = array_map(fn ($t) => is_array($t) ? array_filter([
                'name' => $t['name'] ?? null,
                'category' => $t['category'] ?? null,
                'sensitive' => !empty($t['is_sensitive']) ?: null,
                'columns' => isset($t['columns']) && is_array($t['columns']) ? count($t['columns']) : null,
            ], fn ($v) => $v !== null) : $t, array_slice($data['tables'], 0, 40));
            unset($data['eligible_tables']);
        }

        return array_filter([
            'success' => $result['success'],
            'status' => $result['status'],
            'error_category' => $result['error_category'],
            'safe_message' => $result['safe_message'],
            'retryable' => $result['retryable'] ?: null,
            'side_effect_committed' => $result['side_effect_committed'],
            'verified' => $result['verified'] ?: null,
            'resource_refs' => $result['resource_refs'] ?: null,
            'data' => $this->trim($data, 3, 15, 200) ?: null,
            'secure_input_type' => $result['secure_input_type'] ?? null,
            'next_step' => $result['next_step'] ?? null,
        ], fn ($v) => $v !== null);
    }

    public function result(bool $success, ?string $category, string $message, bool $retryable = false,
                           bool $committed = false, array $refs = [], array $data = [], array $extra = []): array
    {
        return array_merge([
            'success' => $success,
            'status' => $success ? 'succeeded' : 'failed',
            'error_category' => $category,
            'safe_message' => $message,
            'retryable' => $retryable,
            'side_effect_committed' => $committed,
            'verified' => false,
            'resource_refs' => $refs,
            'data' => $data,
        ], $extra);
    }

    /** The secret kind this call needs but the vault does not have, if any. */
    public function missingSecret(AgentTask $task, array $def, array $args): ?string
    {
        foreach ($def['secret_params'] ?? [] as $kind) {
            if ($this->secretRequired($def['name'], $args) && !$this->vault->has($task, $kind)) {
                return $kind;
            }
        }

        return null;
    }

    protected function secretRequired(string $tool, array $args): bool
    {
        return match ($tool) {
            'save_database_connection' => true,
            'test_database_connection' => empty($args['connection_id']),
            'test_ai_provider' => in_array(strtolower($args['provider'] ?? ''), ['openai', 'gemini', 'anthropic', 'claude'], true),
            'save_ai_provider' => in_array(strtolower($args['provider_type'] ?? ''), ['openai', 'gemini', 'anthropic', 'claude'], true),
            default => false,
        };
    }

    /**
     * Authoritative postconditions: re-read the platform state the tool claims to have changed.
     */
    protected function verify(User $user, array $def, array $refs): array
    {
        switch ($def['postcondition'] ?? null) {
            case 'connection_persisted':
                $conn = DbConnection::where('user_id', $user->id)->find($refs['connection_id'] ?? 0);
                return $conn
                    ? [true, "Connection '{$conn->name}' (id {$conn->id}) reloaded from your workspace; status {$conn->status}."]
                    : [false, 'the saved connection was not found when reloading your connections'];
            case 'automation_persisted':
                $a = Automation::where('user_id', $user->id)->find($refs['automation_id'] ?? 0);
                return $a ? [true, "Automation '{$a->name}' (id {$a->id}) reloaded."] : [false, 'the automation was not found after saving'];
            case 'schema_snapshot_exists':
                $snap = SchemaSnapshot::where('user_id', $user->id)->where('connection_id', $refs['connection_id'] ?? 0)->latest('id')->first();
                return $snap ? [true, "Schema snapshot v{$snap->version} stored ({$snap->table_count} tables)."] : [false, 'no schema snapshot was stored'];
            case 'version_approved':
                $v = ContentVersion::where('user_id', $user->id)->find($refs['version_id'] ?? 0);
                return ($v && $v->status === 'APPROVED') ? [true, "Version {$v->id} is approved."] : [false, 'the approval was not persisted'];
            default:
                return [true, null];
        }
    }

    protected function classify(string $error): string
    {
        $e = strtolower($error);
        return match (true) {
            str_contains($e, 'access denied') || str_contains($e, 'authentication') => 'AUTH_FAILED',
            str_contains($e, 'unknown database') || str_contains($e, 'not found') => 'NOT_FOUND',
            (bool) preg_match('/ssrf|not allowed|blocked|prohibit|restricted|sensitive|violates/', $e) => 'POLICY_BLOCKED',
            str_contains($e, 'timed out') || str_contains($e, 'timeout') => 'TIMEOUT',
            (bool) preg_match('/refused|getaddrinfo|unknown mysql server host|no route|network is unreachable|name or service/', $e) => 'UNREACHABLE',
            (bool) preg_match('/missing|required|must|invalid/', $e) => 'INVALID_ARGS',
            default => 'TOOL_ERROR',
        };
    }

    protected function kindLabel(string $kind): string
    {
        return $kind === 'api_key' ? 'API key' : 'database password';
    }

    /** Remove secret-looking keys and known secret values, recursively. */
    protected function sanitize(mixed $value, array $secrets, int $depth = 0): mixed
    {
        if ($depth > 6) {
            return null;
        }
        if (is_array($value)) {
            $out = [];
            foreach ($value as $k => $v) {
                if (is_string($k) && SecretVault::looksSecretKey($k)) {
                    continue;
                }
                $out[$k] = $this->sanitize($v, $secrets, $depth + 1);
            }
            return $out;
        }
        if ($value instanceof \Illuminate\Support\Collection) {
            return $this->sanitize($value->toArray(), $secrets, $depth);
        }
        if (is_string($value)) {
            return SecretVault::scrub($value, $secrets);
        }

        return $value;
    }

    protected function trim(mixed $value, int $depth, int $maxItems, int $maxString): mixed
    {
        if (is_array($value)) {
            if ($depth <= 0) {
                return '[…]';
            }
            $slice = array_is_list($value) ? array_slice($value, 0, $maxItems) : $value;
            $out = [];
            foreach ($slice as $k => $v) {
                $out[$k] = $this->trim($v, $depth - 1, $maxItems, $maxString);
            }
            if (array_is_list($value) && count($value) > $maxItems) {
                $out[] = '…' . (count($value) - $maxItems) . ' more';
            }
            return $out;
        }
        if (is_string($value) && mb_strlen($value) > $maxString) {
            return mb_substr($value, 0, $maxString) . '…';
        }

        return $value;
    }
}
