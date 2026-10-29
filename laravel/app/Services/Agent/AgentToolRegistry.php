<?php

namespace App\Services\Agent;

use App\Models\User;
use App\Models\DbConnection;
use App\Models\Automation;
use App\Models\AutomationExecution;
use App\Models\ContentVersion;
use App\Models\KnowledgeDocument;
use App\Models\AiProvider;
use App\Models\AuditLog;
use App\Services\DatabaseSafetyService;
use App\Services\SchemaIntrospectionService;
use App\Services\SafeDatabaseExecutor;
use App\Services\AiServiceClient;
use App\Services\LiveEventService;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class AgentToolRegistry
{
    /**
     * Complete definitions of registered tools with rich capability metadata.
     */
    /** Names of the generic on-screen tools (executed by the browser, checked against SurfaceCatalog). */
    public const UI_TOOLS = ['go_to_page', 'open_form', 'read_screen', 'fill_fields', 'choose_option', 'press', 'ask_secret_in_form', 'show_me', 'give_tour', 'explain_page'];

    protected static ?array $cachedToolDefs = null;
    protected static array $customHandlers = [];

    public static function flushCache(): void
    {
        self::$cachedToolDefs = null;
    }

    /**
     * Register a dynamic execution handler for any tool (new actions, plugins, custom extensions).
     */
    public static function registerHandler(string $toolName, callable $handler): void
    {
        self::$customHandlers[$toolName] = $handler;
    }

    /**
     * Complete definitions of registered tools loaded dynamically from the platform database (orbit_tools),
     * enriched with live surface and route enums.
     */
    public static function getToolDefinitions(): array
    {
        if (self::$cachedToolDefs !== null) {
            return self::$cachedToolDefs;
        }

        try {
            if (\Illuminate\Support\Facades\Schema::hasTable('orbit_tools')) {
                $dbTools = \App\Models\OrbitTool::where('is_active', true)->orderBy('sort')->orderBy('name')->get();
                if ($dbTools->isNotEmpty()) {
                    $routes = SurfaceCatalog::routes();
                    $surfaces = SurfaceCatalog::surfaceIds();

                    self::$cachedToolDefs = $dbTools->map(function (\App\Models\OrbitTool $t) use ($routes, $surfaces) {
                        $params = $t->parameters ?? ['type' => 'object'];
                        // Inject dynamic live routes and surfaces if UI tool
                        if ($t->name === 'go_to_page' && isset($params['properties']['page'])) {
                            $params['properties']['page']['enum'] = $routes;
                        }
                        if (in_array($t->name, ['open_form', 'fill_fields', 'choose_option', 'press', 'ask_secret_in_form', 'show_me'], true) && isset($params['properties']['surface'])) {
                            $params['properties']['surface']['enum'] = $surfaces;
                        }
                        if ($t->name === 'explain_page' && isset($params['properties']['page'])) {
                            $params['properties']['page']['enum'] = $routes;
                        }

                        return [
                            'name' => $t->name,
                            'label' => $t->label,
                            'category' => $t->category,
                            'description' => $t->description,
                            'outcome' => $t->outcome,
                            'scope' => $t->scope,
                            'read_only' => (bool) $t->read_only,
                            'side_effects' => $t->side_effects,
                            'risk_level' => $t->risk_level,
                            'requires_confirmation' => (bool) $t->requires_confirmation,
                            'idempotent' => (bool) $t->idempotent,
                            'retryable' => (bool) $t->retryable,
                            'audit_required' => (bool) $t->audit_required,
                            'is_ui' => (bool) $t->is_ui,
                            'parameters' => $params,
                            'output_schema' => $t->output_schema ?? ['type' => 'object'],
                            // Agent-loop policy, from the same catalog row (see definition()).
                            'version' => (int) ($t->version ?? 1),
                            'side_effect_class' => $t->side_effect_class,
                            'secret_params' => (array) ($t->secret_params ?? []),
                            'always_confirm' => (bool) ($t->always_confirm ?? false),
                            'confirm_by_button' => (bool) ($t->confirm_by_button ?? false),
                            'postcondition' => $t->postcondition,
                        ];
                    })->all();

                    return self::$cachedToolDefs;
                }
            }
        } catch (\Throwable $e) {
            // Graceful fallback during database migration
        }

        return self::$cachedToolDefs ?? [];
    }

    /**
     * Full definition for one tool, policy included, from its catalog row (orbit_tools, managed in the admin panel):
     * - secret_params: arguments filled from SecretVault at execution time; hidden from the model.
     * - always_confirm: needs explicit user confirmation regardless of autonomy level.
     * - confirm_by_button: destructive; only the Confirm button in Orbit's panel confirms it (not a typed "yes").
     * - postcondition: authoritative check run after a successful call.
     * Null for unknown tools.
     */
    public static function definition(string $name): ?array
    {
        $def = collect(self::getToolDefinitions())->firstWhere('name', $name);
        if (!$def) {
            return null;
        }
        $isUi = in_array($name, self::UI_TOOLS, true) || !empty($def['is_ui']);

        return array_merge($def, [
            'version' => (int) ($def['version'] ?? 1),
            'side_effect_class' => $isUi ? 'ui' : (($def['side_effect_class'] ?? null) ?: (($def['read_only'] ?? false) ? 'read' : 'write')),
            'secret_params' => self::secretParams($def),
            'always_confirm' => (bool) ($def['always_confirm'] ?? false),
            'confirm_by_button' => (bool) ($def['confirm_by_button'] ?? false),
            'requires_confirmation' => (bool) ($def['requires_confirmation'] ?? false),
            'postcondition' => $def['postcondition'] ?? null,
        ]);
    }

    /**
     * Arguments filled from the secure vault, never by the model: those the catalog lists, and any argument named like
     * a secret whatever the catalog says, so an edited tool can never ask the model for a password or key.
     *
     * @return array<string, string> argument => secret kind
     */
    public static function secretParams(array $def): array
    {
        $params = [];
        foreach ((array) ($def['secret_params'] ?? []) as $param => $kind) {
            if (is_string($param) && is_string($kind) && $kind !== '') {
                $params[$param] = $kind;
            }
        }
        foreach (array_keys((array) ($def['parameters']['properties'] ?? [])) as $param) {
            if (is_string($param) && !isset($params[$param]) && SecretVault::looksSecretKey($param)) {
                $params[$param] = SecretVault::kindForParam($param);
            }
        }

        return $params;
    }

    /**
     * Parameter schema the model is allowed to fill: secret params removed, no extra properties.
     */
    public static function modelParameterSchema(array $def): array
    {
        $params = $def['parameters'] ?? ['type' => 'object', 'properties' => []];
        $secret = array_keys($def['secret_params'] ?? []);
        $props = array_diff_key($params['properties'] ?? [], array_flip($secret));
        $required = array_values(array_diff($params['required'] ?? [], $secret));

        $schema = ['type' => 'object', 'properties' => (object) $props, 'additionalProperties' => false];
        if ($required) {
            $schema['required'] = $required;
        }

        return $schema;
    }

    /**
     * Tool schemas sent to the model, generated from the same definitions the executor
     * validates against, with live availability for this user.
     */
    public static function modelVisibleSchemas(User $user, string $autonomyLevel = 'CONFIRM_CONSEQUENTIAL_CHANGES'): array
    {
        $availability = self::getDynamicToolAvailability($user);
        $out = [];
        foreach (self::getToolDefinitions() as $raw) {
            $def = self::definition($raw['name']);
            $out[] = [
                'name' => $def['name'],
                'description' => $def['description'],
                'parameters' => self::modelParameterSchema($def),
                'side_effect_class' => $def['side_effect_class'],
                'requires_confirmation' => self::needsConfirmation($def, $autonomyLevel),
                'available' => $availability[$def['name']]['available'] ?? true,
                'unavailable_reason' => $availability[$def['name']]['reason'] ?? null,
            ];
        }

        return $out;
    }

    /**
     * Confirmation policy: always for always_confirm tools; otherwise by autonomy level.
     */
    public static function needsConfirmation(array $def, string $autonomyLevel): bool
    {
        if ($def['always_confirm'] ?? false) {
            return true;
        }
        // UI tools are gated per catalog action (consequential => confirm) in ToolPolicyGate.
        $mutates = !in_array($def['side_effect_class'] ?? 'read', ['read', 'platform_metadata', 'ui'], true);

        return match ($autonomyLevel) {
            'PREPARE_FOR_REVIEW' => $mutates,
            'AUTOMATIC_WITHIN_PERMISSIONS' => false,
            default => $mutates && ($def['requires_confirmation'] ?? false),
        };
    }

    /**
     * Determine dynamic availability for every tool based on live user context.
     */
    public static function getDynamicToolAvailability(User $user): array
    {
        $connCount = DbConnection::where('user_id', $user->id)->count();
        $autoCount = Automation::where('user_id', $user->id)->count();
        $execCount = AutomationExecution::where('user_id', $user->id)->count();
        $pendingCount = AutomationExecution::where('user_id', $user->id)->where('status', 'PENDING_APPROVAL')->count();
        $docCount = KnowledgeDocument::where('user_id', $user->id)->count();
        $providerCount = AiProvider::where('user_id', $user->id)->count();

        $availability = [];

        $browser = UiActionCoordinator::clientPresent($user->id);
        foreach (self::getToolDefinitions() as $tool) {
            $name = $tool['name'];
            $available = true;
            $reason = null;

            if (in_array($name, self::UI_TOOLS, true) && !$browser) {
                $available = false;
                $reason = 'Orbit can only operate the screen while the portal is open in a browser (NO_BROWSER).';
            }

            // Connection-dependent tools
            if (in_array($name, ['scan_database_schema', 'get_schema_scan_status', 'lookup_table_values'])) {
                if ($connCount === 0) {
                    $available = false;
                    $reason = 'No database connected yet. Connect a database first.';
                }
            }

            // Automation-dependent tools
            if (in_array($name, ['run_automation_now', 'get_automation_details', 'update_automation', 'remove_automation'])) {
                if ($autoCount === 0) {
                    $available = false;
                    $reason = 'No automations configured yet.';
                }
            }

            // Execution-dependent tools
            if (in_array($name, ['get_execution_status', 'retry_execution', 'request_execution_interrupt', 'update_published_record'])) {
                if ($execCount === 0) {
                    $available = false;
                    $reason = 'No execution history available.';
                }
            }

            // Approval-dependent tools
            if (in_array($name, ['approve_content_version', 'reject_content_version'])) {
                if ($pendingCount === 0) {
                    $available = false;
                    $reason = 'No content drafts currently waiting for approval.';
                }
            }

            // Knowledge-dependent tools
            if (in_array($name, ['query_knowledge_base', 'remove_knowledge_document'])) {
                if ($docCount === 0) {
                    $available = false;
                    $reason = 'No knowledge base documents uploaded yet.';
                }
            }

            $availability[$name] = [
                'available' => $available,
                'reason' => $reason,
            ];
        }

        return $availability;
    }

    /**
     * Execute a registered tool on behalf of the authenticated user.
     * Guaranteed tenant scoping and validation.
     */
    public static function executeTool(User $user, string $toolName, array $args = []): array
    {
        // Enforce hard security guardrail: strictly block destructive customer SQL and raw consoles
        $prohibited = ['drop', 'truncate', 'alter', 'create_table', 'raw_sql', 'sql_console', 'execute_sql'];
        $lower = strtolower($toolName);
        foreach ($prohibited as $p) {
            if (str_contains($lower, $p)) {
                return [
                    'success' => false,
                    'error' => "Action '{$toolName}' violates database safety guardrails. DDL and raw SQL console are strictly prohibited.",
                ];
            }
        }
        // Dynamic custom handlers
        if (isset(self::$customHandlers[$toolName])) {
            return (self::$customHandlers[$toolName])($user, $args);
        }

        // Check if tool is disabled in the admin panel
        try {
            if (\Illuminate\Support\Facades\Schema::hasTable('orbit_tools')) {
                $dbTool = \App\Models\OrbitTool::find($toolName);
                if ($dbTool && !$dbTool->is_active) {
                    return [
                        'success' => false,
                        'error_category' => 'TOOL_DISABLED',
                        'error' => "Tool '{$toolName}' has been disabled by the administrator.",
                        'safe_message' => "This capability is currently disabled in system settings.",
                    ];
                }
            }
        } catch (\Throwable $e) {
            // Proceed if database is unavailable
        }

        switch ($toolName) {
            case 'list_database_connections':
                return self::listDatabaseConnections($user);

            case 'test_database_connection':
                return self::testDatabaseConnection($user, $args);

            case 'save_database_connection':
                return self::saveDatabaseConnection($user, $args);

            case 'update_database_connection':
                return self::updateDatabaseConnection($user, $args);

            case 'disconnect_database_connection':
                return self::deleteDatabaseConnection($user, $args);

            case 'scan_database_schema':
                return self::scanDatabaseSchema($user, $args);

            case 'get_schema_scan_status':
                return self::getSchemaScanStatus($user, $args);

            case 'lookup_table_values':
                return self::lookupTableValues($user, $args);

            case 'list_automations':
                return Tools\AutomationTools::list($user);

            case 'get_automation_details':
                return Tools\AutomationTools::details($user, $args);

            case 'create_automation_draft':
                return Tools\AutomationTools::create($user, $args);

            case 'update_automation':
                return Tools\AutomationTools::update($user, $args);

            case 'remove_automation':
                return Tools\AutomationTools::delete($user, $args);

            case 'run_automation_now':
                return Tools\AutomationTools::runNow($user, $args);

            case 'preview_automation_content':
                return Tools\AutomationTools::preview($user, $args);

            case 'list_executions':
                return Tools\AutomationTools::listExecutions($user, $args);

            case 'get_execution_status':
                return Tools\AutomationTools::executionStatus($user, $args);

            case 'retry_execution':
                return Tools\AutomationTools::retry($user, $args);

            case 'request_execution_interrupt':
                return self::requestExecutionInterrupt($user, $args);

            case 'explain_execution_failure':
                return Tools\AutomationTools::explainFailure($user, $args);

            case 'update_published_record':
                return Tools\AutomationTools::updatePublishedRecord($user, $args);

            case 'get_pending_approvals':
                return Tools\AutomationTools::pendingApprovals($user);

            case 'approve_content_version':
                return Tools\AutomationTools::approve($user, $args);

            case 'reject_content_version':
                return Tools\AutomationTools::reject($user, $args);

            case 'list_ai_providers':
                return self::listAiProviders($user);

            case 'test_ai_provider':
                return self::testAiProvider($user, $args);

            case 'save_ai_provider':
                return self::saveAiProvider($user, $args);

            case 'get_provider_health':
                return self::getProviderHealth();

            case 'list_knowledge_documents':
                return self::listKnowledgeDocuments($user);

            case 'query_knowledge_base':
                return self::queryKnowledgeBase($user, $args);

            case 'search_orbit_knowledge':
                $query = trim((string) ($args['query'] ?? ''));
                if (mb_strlen($query) < 2) {
                    return ['success' => false, 'error_category' => 'INVALID_ARGS', 'error' => 'query is required.'];
                }
                $passages = array_map(fn ($c) => [
                    'source_id' => $c['source_id'] ?? null,
                    'scope' => $c['scope'] ?? null,
                    'heading' => $c['heading'] ?? null,
                    'text' => mb_substr((string) ($c['text'] ?? ''), 0, 1200),
                ], (new AiServiceClient())->searchOrbitKnowledge($user->id, mb_substr($query, 0, 500), (int) ($args['top_k'] ?? 5)));

                return [
                    'success' => true,
                    'query' => $query,
                    'passages' => $passages,
                    'message' => count($passages) . ' passage(s) found.',
                ];

            case 'remove_knowledge_document':
                return self::deleteKnowledgeDocument($user, $args);

            case 'get_dashboard_summary':
                return self::getDashboardSummary($user);

            case 'list_audit_logs':
                return Tools\AuditTools::search($user, $args);

            case 'get_audit_log_entry':
                return Tools\AuditTools::inspect($user, $args);

            case 'ask_database':
                $resolved = ConnectionResolver::resolve($user, $args['connection_id'] ?? null);
                if (!isset($resolved['connection'])) {
                    return $resolved;
                }
                // PII stays masked for Orbit: revealing it is the user's own audited action in the data assistant.
                return app(\App\Services\Data\DataAgentService::class)->ask(
                    $user,
                    $args['question'],
                    $resolved['connection']->id,
                    ['reveal_pii' => false]
                );

            case 'find_dummy_data':
                $targetTable = $args['table'] ?? $args['tables'] ?? 'recommended';
                $resolved = ConnectionResolver::resolve($user, $args['connection_id'] ?? null,
                    is_string($targetTable) && !in_array($targetTable, ['recommended', 'all'], true) ? $targetTable : null);
                if (!isset($resolved['connection'])) {
                    return $resolved;
                }
                $conn = $resolved['connection'];
                $detector = app(\App\Services\Data\DummyDataDetector::class);
                $res = $detector->detectAcrossTables($conn, $targetTable);
                $msg = $res['summary_message'] ?? 'Dummy data analysis completed.';
                return [
                    'success' => true,
                    'message' => $msg,
                    'report' => $res,
                    'data' => $res,
                    'safe_message' => $msg,
                ];

            case 'preview_data_change':
                $resolved = ConnectionResolver::resolve($user, $args['connection_id'] ?? null, is_string($args['table'] ?? null) ? $args['table'] : null);
                if (!isset($resolved['connection'])) {
                    return $resolved;
                }
                $conn = $resolved['connection'];
                $where = ['connection_id' => $conn->id, 'connection' => $conn->name];

                // The action is never assumed: a missing one is an error, not a delete.
                $action = strtolower((string) ($args['action'] ?? $args['operation'] ?? ''));
                if (!in_array($action, ['update', 'delete', 'insert'], true)) {
                    return ['success' => false, 'error_category' => 'INVALID_ARGS',
                        'error' => 'action must be insert, update or delete.'] + $where;
                }

                if ($action === 'insert') {
                    // New rows: the same checks, preview and confirmation as the Data page's add-row form.
                    $rows = $args['rows'] ?? [];
                    if (!is_array($rows) || $rows === [] || !array_is_list($rows) || !is_array($rows[0])) {
                        return ['success' => false, 'error_category' => 'INVALID_ARGS',
                            'error' => 'For insert pass rows: a list of objects, one per new row, keyed by column name.'] + $where;
                    }
                    $res = app(\App\Services\Data\DataChangeService::class)->previewInsert($conn, $user, (string) $args['table'], $rows, 'orbit');

                    return $res + $where;
                }

                $filter = $args['filter'] ?? $args['filters'] ?? [];
                if (empty($filter)) {
                    if (!empty($args['rows'])) {
                        $rows = (array) $args['rows'];
                        if (array_is_list($rows) && isset($rows[0]) && is_scalar($rows[0])) {
                            $filter = ['id' => $rows];
                        } elseif (array_is_list($rows) && isset($rows[0]['id'])) {
                            $filter = ['id' => array_column($rows, 'id')];
                        } else {
                            $filter = $rows;
                        }
                    } elseif (!empty($args['ids'])) {
                        $filter = ['id' => (array) $args['ids']];
                    } elseif (!empty($args['id'])) {
                        $filter = ['id' => $args['id']];
                    }
                }

                if ($action === 'update') {
                    return app(\App\Services\Data\DataChangeService::class)->previewUpdate(
                        $conn, $user, $args['table'], (array) $filter, $args['patch_values'] ?? []
                    ) + $where;
                }

                return app(\App\Services\Data\DataChangeService::class)->previewDelete(
                    $conn, $user, $args['table'], (array) $filter
                ) + $where;

            case 'confirm_data_change':
                $changeId = $args['change_request_id'] ?? null;
                if (!$changeId) {
                    $q = \App\Models\DataChangeRequest::where('user_id', $user->id)
                        ->where('status', 'pending_confirmation')
                        ->where('expires_at', '>', now());
                    if (!empty($args['connection_id'])) {
                        $q->where('connection_id', $args['connection_id']);
                    }
                    if (!empty($args['table'])) {
                        $q->where('target_table', $args['table']);
                    }
                    if (!empty($args['action'])) {
                        $q->where('action', $args['action']);
                    }
                    $pending = $q->latest()->first();
                    if ($pending) {
                        $changeId = $pending->id;
                    } else {
                        $executed = \App\Models\DataChangeRequest::where('user_id', $user->id)->latest()->first();
                        if ($executed && $executed->status === 'executed') {
                            return ['success' => true, 'message' => "Change has already been confirmed and executed."];
                        }
                        return ['success' => false, 'error' => 'No pending change request found to confirm. Please preview the change first.'];
                    }
                }

                // A delete's typed phrase counts only when the user typed it: it is read from their own latest
                // message, never from tool arguments (the model saw the phrase in the preview and could pass it on).
                $phrase = null;
                $pendingReq = \App\Models\DataChangeRequest::where('user_id', $user->id)->find($changeId);
                if ($pendingReq && $pendingReq->confirmation_phrase) {
                    $lastUserMsg = \App\Models\AgentMessage::where('conversation_id', function ($query) use ($user) {
                        $query->select('id')->from('agent_conversations')->where('user_id', $user->id)->latest('id')->limit(1);
                    })->where('role', 'user')->latest('id')->first();

                    if ($lastUserMsg && stripos($lastUserMsg->content, $pendingReq->confirmation_phrase) !== false) {
                        $phrase = $pendingReq->confirmation_phrase;
                    }
                }

                return app(\App\Services\Data\DataChangeService::class)->executeChange(
                    $user, (int) $changeId, $phrase
                );

            case 'undo_data_change':
                return app(\App\Services\Data\DataChangeService::class)->undo(
                    $user, $args['change_request_id']
                );

            case 'get_account_profile':
                return Tools\AccountTools::get($user);

            case 'update_account_profile':
                return Tools\AccountTools::update($user, $args);

            default:
                return [
                    'success' => false,
                    'error' => "Unknown or unregistered tool '{$toolName}'.",
                ];
        }
    }

    // =========================================================================
    // Tool Implementations
    // =========================================================================

    protected static function listDatabaseConnections(User $user): array
    {
        $connections = DbConnection::where('user_id', $user->id)
            ->get()
            ->map(fn ($c) => [
                'id' => $c->id,
                'name' => $c->name,
                'db_type' => $c->db_type,
                'host' => $c->host,
                'port' => $c->port,
                'database_name' => $c->database_name,
                'username' => $c->username,
                'status' => $c->status,
                'server_version' => $c->server_version,
                'latency_ms' => $c->latency_ms,
                'last_tested_at' => $c->last_tested_at ? $c->last_tested_at->toIso8601String() : null,
            ]);

        return [
            'success' => true,
            'connections' => $connections,
            'total' => $connections->count(),
            'message' => "Found {$connections->count()} database connection(s) in workspace.",
        ];
    }

    protected static function testDatabaseConnection(User $user, array $args): array
    {
        if (!empty($args['connection_id'])) {
            $conn = DbConnection::where('user_id', $user->id)->find($args['connection_id']);
            if (!$conn) {
                return ['success' => false, 'error' => 'Database connection profile not found.'];
            }
            $host = $conn->host;
            $port = $conn->port;
            $dbName = $conn->database_name;
            $username = $conn->username;
            $password = $conn->encrypted_password;
            $sslMode = $conn->ssl_mode ?: 'prefer';
        } else {
            $host = $args['host'] ?? '';
            $port = (int) ($args['port'] ?? 3306);
            $dbName = $args['database'] ?? ($args['database_name'] ?? '');
            $username = $args['username'] ?? '';
            $password = $args['password'] ?? '';
            $sslMode = $args['ssl_mode'] ?? 'prefer';

            if (empty($host) || empty($dbName) || empty($username)) {
                return ['success' => false, 'error' => 'Missing host, database name, or username.'];
            }
        }

        // Validate SSRF Guardrail
        $safety = new DatabaseSafetyService();
        try {
            $safety->validateConnectionTarget($host, $port);
        } catch (\Throwable $e) {
            return ['success' => false, 'error' => $e->getMessage()];
        }

        // Perform dialect-dynamic handshake via TargetConnector and DialectRegistry
        $start = microtime(true);
        try {
            $dbType = \App\Services\Data\Dialects\DialectRegistry::normalise(isset($conn) ? $conn->db_type : ($args['db_type'] ?? 'mysql'));
            $dialect = \App\Services\Data\Dialects\DialectRegistry::for($dbType);
            $targetConnector = app(\App\Services\Data\TargetConnector::class);
            $tempConn = new DbConnection([
                'host' => $host,
                'port' => $port,
                'database_name' => $dbName,
                'username' => $username,
                'encrypted_password' => $password,
                'ssl_mode' => $sslMode,
                'db_type' => $dialect->key(),
            ]);
            $pdo = $targetConnector->open($tempConn, true, 4000);
            $serverInfo = $dialect->serverInfo($pdo);
            $serverVersion = $serverInfo['version'] ?? 'Unknown';
            $engineLabel = $serverInfo['engine'] ?? $dialect->label();
            $latency = round((microtime(true) - $start) * 1000, 2);
            unset($pdo);

            if (isset($conn)) {
                self::recordConnectionStatus($user, $conn, true, $serverVersion, $latency, null);
            }

            return [
                'success' => true,
                'message' => isset($conn)
                    ? "Saved connection '{$conn->name}' is reachable ({$engineLabel} {$serverVersion}, {$latency}ms)."
                    : "Connection successful ({$engineLabel} {$serverVersion}, Latency: {$latency}ms).",
                'connection_id' => isset($conn) ? $conn->id : null,
                'connection_name' => isset($conn) ? $conn->name : null,
                'status' => 'connected',
                'server_version' => $serverVersion,
                'latency_ms' => $latency,
            ];
        } catch (\Throwable $e) {
            $error = 'Connection test failed: ' . $e->getMessage();
            if (isset($conn)) {
                self::recordConnectionStatus($user, $conn, false, null, null, $error);
            }

            return [
                'success' => false,
                'error' => $error,
                'connection_id' => isset($conn) ? $conn->id : null,
                'status' => 'connection_error',
            ];
        }
    }

    protected static function recordConnectionStatus(User $user, DbConnection $conn, bool $ok, ?string $version, ?float $latency, ?string $error): void
    {
        $conn->update([
            'status' => $ok ? 'connected' : 'connection_error',
            'last_tested_at' => now(),
            'server_version' => $version ?? $conn->server_version,
            'latency_ms' => $latency,
            'error_message' => $ok ? null : $error,
        ]);
        LiveEventService::publish($user->id, 'connection.tested', [
            'id' => $conn->id,
            'status' => $conn->status,
            'latency_ms' => $conn->latency_ms,
            'server_version' => $conn->server_version,
            'last_tested_at' => $conn->last_tested_at?->toIso8601String(),
        ], 'DbConnection', (string) $conn->id);
    }

    protected static function saveDatabaseConnection(User $user, array $args): array
    {
        $name = trim($args['name'] ?? '');
        $host = trim($args['host'] ?? '');
        $port = (int) ($args['port'] ?? 3306);
        $dbName = trim($args['database'] ?? ($args['database_name'] ?? ''));
        $username = trim($args['username'] ?? '');
        $password = $args['password'] ?? '';
        $sslMode = in_array($args['ssl_mode'] ?? '', ['require', 'disable']) ? $args['ssl_mode'] : 'prefer';

        if (empty($name) || empty($host) || empty($dbName) || empty($username) || empty($password)) {
            return [
                'success' => false,
                'error' => 'All connection parameters (name, host, database, username, password) are required.',
            ];
        }

        $existing = DbConnection::where('user_id', $user->id)
            ->where('host', $host)->where('port', $port)
            ->where('database_name', $dbName)->where('username', $username)
            ->first();
        if ($existing) {
            return [
                'success' => false,
                'error_category' => 'CONFLICT',
                'error' => "A saved connection for {$username}@{$host}:{$port}/{$dbName} already exists ('{$existing->name}', id {$existing->id}). Test that connection_id instead of saving a duplicate.",
                'connection_id' => $existing->id,
            ];
        }

        $safety = new DatabaseSafetyService();
        try {
            $safety->validateConnectionTarget($host, $port);
        } catch (\Throwable $e) {
            return ['success' => false, 'error' => $e->getMessage()];
        }

        // Pre-test credentials before saving
        $testResult = self::testDatabaseConnection($user, [
            'host' => $host,
            'port' => $port,
            'database' => $dbName,
            'username' => $username,
            'password' => $password,
            'ssl_mode' => $sslMode,
        ]);

        if (!$testResult['success']) {
            return [
                'success' => false,
                'error' => 'Cannot save connection: verification failed. ' . $testResult['error'],
            ];
        }

        $conn = DbConnection::create([
            'user_id' => $user->id,
            'name' => $name,
            'db_type' => 'mysql',
            'host' => $host,
            'port' => $port,
            'database_name' => $dbName,
            'username' => $username,
            'encrypted_password' => $password, // Auto-encrypted by Model cast
            'ssl_mode' => $sslMode,
            'status' => 'connected',
            'server_version' => $testResult['server_version'] ?? 'MySQL 8.0',
            'latency_ms' => $testResult['latency_ms'] ?? 10.0,
            'last_tested_at' => now(),
        ]);

        AuditLog::log(
            $user->id,
            'AGENT_CONNECTION_SAVED',
            'DbConnection',
            (string) $conn->id,
            ['name' => $conn->name, 'host' => $conn->host, 'database' => $conn->database_name]
        );

        return [
            'success' => true,
            'connection_id' => $conn->id,
            'name' => $conn->name,
            'message' => "Database connection '{$conn->name}' verified and saved successfully with encrypted credentials.",
        ];
    }

    protected static function updateDatabaseConnection(User $user, array $args): array
    {
        $connId = (int) ($args['connection_id'] ?? 0);
        $conn = DbConnection::where('user_id', $user->id)->find($connId);
        if (!$conn) {
            return ['success' => false, 'error' => 'Database connection not found.'];
        }

        $dataToUpdate = [];
        if (!empty($args['name'])) $dataToUpdate['name'] = trim($args['name']);
        if (!empty($args['host'])) $dataToUpdate['host'] = trim($args['host']);
        if (!empty($args['port'])) $dataToUpdate['port'] = (int) $args['port'];
        if (!empty($args['ssl_mode'])) $dataToUpdate['ssl_mode'] = $args['ssl_mode'];
        if (!empty($args['access_mode']) && in_array($args['access_mode'], ['read_only', 'read_write', 'read_write_delete'], true)) {
            $dataToUpdate['access_mode'] = $args['access_mode'];
        }

        if (!empty($dataToUpdate)) {
            $conn->update($dataToUpdate);
            AuditLog::log($user->id, 'AGENT_CONNECTION_UPDATED', 'DbConnection', (string) $conn->id, $dataToUpdate);
        }

        return [
            'success' => true,
            'connection_id' => $conn->id,
            'message' => "Connection '{$conn->name}' updated successfully.",
        ];
    }

    protected static function deleteDatabaseConnection(User $user, array $args): array
    {
        $connId = (int) ($args['connection_id'] ?? 0);
        $conn = DbConnection::where('user_id', $user->id)->find($connId);
        if (!$conn) {
            return ['success' => false, 'error' => 'Database connection not found.'];
        }

        $activeAutomations = $conn->automations()->where('is_active', true)->get();
        if ($activeAutomations->count() > 0 && empty($args['force'])) {
            return [
                'success' => false,
                'error' => "Cannot disconnect: {$activeAutomations->count()} active automation(s) depend on it ({$activeAutomations->pluck('name')->implode(', ')}). Disable them first or confirm with force=true.",
            ];
        }

        if ($activeAutomations->count() > 0) {
            $conn->automations()->update(['is_active' => false]);
        }

        $connName = $conn->name;
        $conn->delete();

        AuditLog::log($user->id, 'AGENT_CONNECTION_DELETED', 'DbConnection', (string) $connId);

        return [
            'success' => true,
            'connection_id' => $connId,
            'message' => "Database connection profile '{$connName}' removed successfully (target database untouched).",
        ];
    }

    protected static function scanDatabaseSchema(User $user, array $args): array
    {
        $conn = DbConnection::where('user_id', $user->id)->find($args['connection_id'] ?? 0);
        if (!$conn) {
            return ['success' => false, 'error' => 'Database connection not found.'];
        }

        try {
            $service = app(SchemaIntrospectionService::class);
            $schema = $service->introspectSchema($conn);
            $conn->update([
                'schema_freshness_at' => now(),
            ]);

            return [
                'success' => true,
                'connection_id' => $conn->id,
                'connection_name' => $conn->name,
                'total_tables' => count($schema['tables'] ?? []),
                'eligible_tables' => array_values(array_filter($schema['tables'] ?? [], fn ($t) => empty($t['is_sensitive']) && ($t['category'] ?? '') !== 'RESTRICTED')),
                'tables' => $schema['tables'] ?? [],
                'message' => "Discovered " . count($schema['tables'] ?? []) . " tables in connection '{$conn->name}'.",
            ];
        } catch (\Throwable $e) {
            return [
                'success' => false,
                'error' => 'Failed to scan schema: ' . $e->getMessage(),
            ];
        }
    }

    protected static function getSchemaScanStatus(User $user, array $args): array
    {
        return self::scanDatabaseSchema($user, $args);
    }

    protected static function lookupTableValues(User $user, array $args): array
    {
        $conn = DbConnection::where('user_id', $user->id)->find($args['connection_id'] ?? 0);
        if (!$conn) {
            return ['success' => false, 'error' => 'Database connection not found.'];
        }

        $table = trim($args['table'] ?? '');
        $safety = new DatabaseSafetyService();
        if ($safety->isTableSensitive($table)) {
            return ['success' => false, 'error' => "Table '{$table}' is sensitive and restricted."];
        }

        try {
            // Same read-only lookup the portal's dropdowns use (labels of rows, no secret columns).
            $records = app(\App\Services\SchemaIntrospectionService::class)->getTableLookupRecords($conn, $table, 10, $args['search'] ?? null);
            return [
                'success' => true,
                'table' => $table,
                'count' => count($records),
                'values' => $records,
                'message' => "Retrieved " . count($records) . " sample records from '{$table}'.",
            ];
        } catch (\Throwable $e) {
            return ['success' => false, 'error' => "Lookup failed: " . $e->getMessage()];
        }
    }











    protected static function requestExecutionInterrupt(User $user, array $args): array
    {
        $execution = AutomationExecution::where('user_id', $user->id)->find($args['execution_id'] ?? 0);
        if (!$execution) {
            return ['success' => false, 'error' => 'Execution not found.'];
        }

        $action = strtolower($args['action'] ?? 'cancel');
        // Same rules as the portal: a finished run keeps its real outcome.
        if ($execution->status === 'PUBLISHED' || ($action === 'pause' && in_array($execution->status, ['FAILED', 'CANCELLED', 'SKIPPED', 'MISSED', 'REJECTED'], true))) {
            return ['success' => false, 'error' => "Run #{$execution->id} is {$execution->status}; it cannot be " . ($action === 'pause' ? 'paused' : 'cancelled') . '.'];
        }
        if ($action !== 'pause' && in_array($execution->status, ['CANCELLED', 'FAILED', 'SKIPPED', 'MISSED', 'REJECTED'], true)) {
            return ['success' => true, 'execution_id' => $execution->id, 'status' => $execution->status, 'message' => "Run #{$execution->id} had already stopped ({$execution->status}); nothing changed."];
        }
        if ($action === 'pause') {
            $execution->update(['status' => 'PAUSED']);
            $msg = "Execution #{$execution->id} paused.";
        } else {
            $execution->update(['status' => 'CANCELLED']);
            $msg = "Execution #{$execution->id} cancelled safely at boundary.";
        }

        return [
            'success' => true,
            'execution_id' => $execution->id,
            'status' => $execution->status,
            'message' => $msg,
        ];
    }






    protected static function listAiProviders(User $user): array
    {
        $providers = AiProvider::where('user_id', $user->id)->get()->map(fn ($p) => [
            'id' => $p->id,
            'provider_type' => $p->provider_type,
            'model_name' => $p->model_name,
            'masked_key' => $p->masked_key,
            'is_active' => $p->is_active,
        ]);

        return [
            'success' => true,
            'providers' => $providers,
            'count' => $providers->count(),
            'message' => "Found {$providers->count()} configured provider(s).",
        ];
    }

    protected static function testAiProvider(User $user, array $args): array
    {
        $provider = $args['provider'] ?? 'ollama';
        $model = $args['model'] ?? null;
        $key = $args['api_key'] ?? null;

        try {
            $ai = new AiServiceClient();
            $health = $ai->checkHealth($provider, $model, $key);
            return [
                'success' => true,
                'provider' => $provider,
                'available' => $health['available'] ?? false,
                'latency_ms' => $health['latency_ms'] ?? 0.0,
                'message' => $health['message'] ?? 'Provider check finished.',
            ];
        } catch (\Throwable $e) {
            return ['success' => false, 'error' => 'Provider test failed: ' . $e->getMessage()];
        }
    }

    protected static function saveAiProvider(User $user, array $args): array
    {
        $providerType = trim($args['provider_type'] ?? '');
        if (empty($providerType)) {
            return ['success' => false, 'error' => 'Provider type is required.'];
        }

        $provider = AiProvider::updateOrCreate(
            ['user_id' => $user->id, 'provider_type' => $providerType],
            [
                'model_name' => $args['model_name'] ?? 'default',
                'encrypted_api_key' => $args['api_key'] ?? '',
                'is_active' => (bool) ($args['is_active'] ?? true),
            ]
        );

        AuditLog::log($user->id, 'AGENT_AI_PROVIDER_SAVED', 'AiProvider', (string) $provider->id);

        return [
            'success' => true,
            'provider_id' => $provider->id,
            'provider_type' => $provider->provider_type,
            'message' => "AI provider configuration for '{$providerType}' saved successfully.",
        ];
    }

    protected static function getProviderHealth(): array
    {
        try {
            $ai = new AiServiceClient();
            $health = $ai->checkHealth('ollama', 'llama3.2:1b');
            return [
                'success' => true,
                'provider' => 'ollama',
                'status' => ($health['available'] ?? false) ? 'ONLINE' : 'OFFLINE',
                'latency_ms' => $health['latency_ms'] ?? 0,
                'models' => $health['models'] ?? [],
                'message' => $health['message'] ?? 'Checked provider status.',
            ];
        } catch (\Throwable $e) {
            return [
                'success' => true,
                'provider' => 'ollama',
                'status' => 'FALLBACK_MODE',
                'message' => 'Local Ollama is offline; deterministic fallback agent engine active.',
            ];
        }
    }

    protected static function listKnowledgeDocuments(User $user): array
    {
        $docs = KnowledgeDocument::where('user_id', $user->id)->get()->map(fn ($d) => [
            'id' => $d->id,
            'title' => $d->title,
            'file_type' => $d->file_type,
            'chunks_count' => $d->chunks_count,
            'created_at' => $d->created_at->toIso8601String(),
        ]);

        return [
            'success' => true,
            'documents' => $docs,
            'total' => $docs->count(),
            'message' => "Found {$docs->count()} indexed document(s).",
        ];
    }

    protected static function queryKnowledgeBase(User $user, array $args): array
    {
        $query = trim($args['query'] ?? '');
        if (empty($query)) {
            return ['success' => false, 'error' => 'Query string is required.'];
        }

        try {
            $ai = new AiServiceClient();
            $results = $ai->queryKnowledge($user->id, $query, (int) ($args['top_k'] ?? 3));
            return [
                'success' => true,
                'query' => $query,
                'results' => $results,
                'count' => count($results),
                'message' => "Found " . count($results) . " relevant passage(s) in knowledge base.",
            ];
        } catch (\Throwable $e) {
            return ['success' => false, 'error' => 'Search failed: ' . $e->getMessage()];
        }
    }

    protected static function deleteKnowledgeDocument(User $user, array $args): array
    {
        $doc = KnowledgeDocument::where('user_id', $user->id)->find($args['document_id'] ?? 0);
        if (!$doc) {
            return ['success' => false, 'error' => 'Knowledge document not found.'];
        }

        $docId = $doc->id;
        $title = $doc->title;

        try {
            $ai = new AiServiceClient();
            $ai->deleteDocument($user->id, $docId);
        } catch (\Throwable $e) {
            // Log vector index purge warning but proceed with DB delete
        }

        $doc->delete();
        AuditLog::log($user->id, 'AGENT_KNOWLEDGE_DELETED', 'KnowledgeDocument', (string) $docId);

        return [
            'success' => true,
            'document_id' => $docId,
            'message' => "Knowledge document '{$title}' removed from workspace.",
        ];
    }

    protected static function getDashboardSummary(User $user): array
    {
        $connCount = DbConnection::where('user_id', $user->id)->count();
        $autoCount = Automation::where('user_id', $user->id)->count();
        $execCount = AutomationExecution::where('user_id', $user->id)->count();
        $publishedCount = AutomationExecution::where('user_id', $user->id)->where('status', 'PUBLISHED')->count();
        $pendingApprovals = AutomationExecution::where('user_id', $user->id)->where('status', 'PENDING_APPROVAL')->count();

        return [
            'success' => true,
            'connections_count' => $connCount,
            'automations_count' => $autoCount,
            'executions_count' => $execCount,
            'published_count' => $publishedCount,
            'pending_approvals_count' => $pendingApprovals,
            'message' => "Workspace status: {$connCount} connection(s), {$autoCount} automation(s), {$execCount} execution(s), {$pendingApprovals} pending approval(s).",
        ];
    }


    protected static function validateLeadTime(string $genTime, string $pubTime): array
    {
        $min = \App\Services\Automation\ScheduleCalculator::minGapMinutes();
        $diff = \App\Services\Automation\ScheduleCalculator::gapMinutes($genTime, $pubTime);
        if ($diff === null) {
            return ['valid' => false, 'error' => 'Times must be HH:MM (24-hour).'];
        }
        if ($diff === 0) {
            return ['valid' => false, 'error' => "Publication time ({$pubTime}) must be after generation time ({$genTime})."];
        }
        if ($diff < $min) {
            return [
                'valid' => false,
                'error' => "Publication time ({$pubTime}) must be at least {$min} minutes after generation time ({$genTime}) to allow generation and review (current gap: {$diff}m).",
            ];
        }

        return ['valid' => true];
    }
}
