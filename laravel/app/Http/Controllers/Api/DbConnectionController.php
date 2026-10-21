<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DbConnection;
use App\Models\AuditLog;
use App\Services\DatabaseSafetyService;
use App\Services\LiveEventService;
use App\Services\SchemaIntrospectionService;
use App\Services\Data\Dialects\DialectRegistry;
use App\Services\Data\TargetConnector;
use App\Services\Data\DataException;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Exception;
use PDO;

class DbConnectionController extends Controller
{
    public function __construct(
        protected DatabaseSafetyService $safetyService,
        protected SchemaIntrospectionService $introspectionService,
        protected TargetConnector $targetConnector
    ) {}

    public function engines()
    {
        return response()->json(DialectRegistry::catalog());
    }

    public function index(Request $request)
    {
        $connections = DbConnection::where('user_id', $request->user()->id)
            ->withCount('automations')
            ->orderBy('created_at', 'desc')
            ->get();

        return response()->json($connections);
    }

    public function store(Request $request)
    {
        // Support either Connection URI or Manual parameters
        $validated = $request->validate(array_merge(self::targetRules(false), [
            'name' => 'required|string|max:120',
            'db_type' => 'nullable|string|in:mysql,mariadb,postgresql,postgres,pgsql,sqlite,sqlsrv,mongodb',
            'access_mode' => 'nullable|string|in:read_only,read_write,read_write_delete',
            'data_policy' => 'nullable|array',
            'data_timezone' => 'nullable|string|max:64|timezone:all',
            'test_before_save' => 'nullable|boolean',
        ]), self::targetMessages());

        $mode = $validated['connection_mode'] ?? (!empty($validated['connection_uri']) ? 'uri' : 'manual');
        $timeout = (int) ($validated['connection_timeout'] ?? 5);

        if ($mode === 'uri' && !empty($validated['connection_uri'])) {
            $parsed = $this->parseConnectionUri($validated['connection_uri']);
            $host = $parsed['host'];
            $port = $parsed['port'];
            $dbName = $parsed['database_name'];
            $username = $parsed['username'];
            $password = $parsed['password'];
            $sslMode = $this->normalizeSslMode($parsed['ssl_mode'] ?? ($validated['ssl_mode'] ?? 'preferred'));
        } else {
            $missing = array_filter(['host' => 'Host is required.', 'database_name' => 'Database name is required.', 'username' => 'Username is required.'],
                fn($k) => empty($validated[$k]), ARRAY_FILTER_USE_KEY);
            if ($missing) {
                return response()->json(['message' => reset($missing), 'errors' => array_map(fn($m) => [$m], $missing)], 422);
            }
            $host = $validated['host'];
            $port = (int) ($validated['port'] ?? 3306);
            $dbName = $validated['database_name'];
            $username = $validated['username'];
            $password = $validated['password'] ?? '';
            $sslMode = $this->normalizeSslMode($validated['ssl_mode'] ?? 'preferred');
        }

        // SSRF & target validation (a refused host is a field problem, not a server error)
        if ($refused = $this->refusedTarget($host, $port)) {
            return $refused;
        }

        // Check for duplicate connection name within workspace
        $existingName = DbConnection::where('user_id', $request->user()->id)
            ->where('name', $validated['name'])
            ->exists();

        if ($existingName) {
            $msg = "You already have a connection named '{$validated['name']}'. Choose a different name.";
            return response()->json(['message' => $msg, 'errors' => ['name' => [$msg]]], 422);
        }

        $status = 'unverified';
        $serverVersion = null;
        $latencyMs = null;
        $lastTestedAt = null;
        $errorMessage = null;
        $dbType = DialectRegistry::normalise($validated['db_type'] ?? 'mysql');

        // Check dialect validity
        try {
            $dialect = DialectRegistry::for($dbType);
        } catch (DataException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        // Optionally test connection before saving
        if (!empty($validated['test_before_save'])) {
            $testRes = $this->performPdoTest($host, $port, $dbName, $username, $password, $sslMode, $timeout, $dbType);
            if ($testRes['success']) {
                $status = 'connected';
                $serverVersion = $testRes['server_version'];
                $latencyMs = $testRes['latency_ms'];
                $lastTestedAt = now();
                $errorMessage = null;
            } else {
                $status = 'connection_error';
                $errorMessage = $testRes['message'] ?? null;
            }
        }

        $connection = DbConnection::create([
            'user_id' => $request->user()->id,
            'name' => $validated['name'],
            'db_type' => $dialect->key(),
            'access_mode' => $validated['access_mode'] ?? 'read_only',
            'data_policy' => $validated['data_policy'] ?? null,
            'data_timezone' => $validated['data_timezone'] ?? null,
            'host' => $host,
            'port' => $port,
            'database_name' => $dbName,
            'username' => $username,
            'encrypted_password' => $password,
            'ssl_mode' => $sslMode,
            'connection_timeout' => $timeout,
            'status' => $status,
            'last_tested_at' => $lastTestedAt,
            'server_version' => $serverVersion,
            'latency_ms' => $latencyMs,
            'error_message' => $errorMessage,
        ]);

        AuditLog::log($request->user()->id, 'CONNECTION_CREATED', 'DbConnection', (string) $connection->id, [
            'name' => $connection->name,
            'host' => $connection->host,
            'database' => $connection->database_name,
            'status' => $connection->status,
        ]);

        LiveEventService::publish($request->user()->id, 'connection.created', [
            'id' => $connection->id,
            'name' => $connection->name,
            'host' => $connection->host,
            'database' => $connection->database_name,
            'status' => $connection->status,
        ], 'DbConnection', (string) $connection->id);

        return response()->json([
            'message' => 'Database connection profile saved successfully',
            'connection' => $connection,
        ], 201);
    }

    public function show(Request $request, $id)
    {
        $connection = DbConnection::where('user_id', $request->user()->id)
            ->where('id', $id)
            ->firstOrFail();

        return response()->json($connection);
    }

    public function update(Request $request, $id)
    {
        $connection = DbConnection::where('user_id', $request->user()->id)
            ->where('id', $id)
            ->firstOrFail();

        $validated = $request->validate(array_merge(self::targetRules(true), [
            'name' => 'sometimes|required|string|max:120',
            'access_mode' => 'nullable|string|in:read_only,read_write,read_write_delete',
            'data_policy' => 'nullable|array',
            'data_timezone' => 'nullable|string|max:64|timezone:all',
            'is_active' => 'nullable|boolean',
        ]), self::targetMessages());

        if (isset($validated['name']) && $validated['name'] !== $connection->name
            && DbConnection::where('user_id', $request->user()->id)->where('name', $validated['name'])->where('id', '!=', $connection->id)->exists()) {
            $msg = "You already have a connection named '{$validated['name']}'. Choose a different name.";
            return response()->json(['message' => $msg, 'errors' => ['name' => [$msg]]], 422);
        }

        if (!empty($validated['connection_uri'])) {
            $parsed = $this->parseConnectionUri($validated['connection_uri']);
            $validated['host'] = $parsed['host'];
            $validated['port'] = $parsed['port'];
            $validated['database_name'] = $parsed['database_name'];
            $validated['username'] = $parsed['username'];
            if (!empty($parsed['password'])) {
                $validated['password'] = $parsed['password'];
            }
        }

        if (!empty($validated['host']) || !empty($validated['port'])) {
            $host = $validated['host'] ?? $connection->host;
            $port = (int) ($validated['port'] ?? $connection->port);
            if ($refused = $this->refusedTarget($host, $port)) {
                return $refused;
            }
        }

        $dataToUpdate = [
            'name' => $validated['name'] ?? $connection->name,
            'host' => $validated['host'] ?? $connection->host,
            'port' => $validated['port'] ?? $connection->port,
            'database_name' => $validated['database_name'] ?? $connection->database_name,
            'username' => $validated['username'] ?? $connection->username,
            'ssl_mode' => isset($validated['ssl_mode']) ? $this->normalizeSslMode($validated['ssl_mode']) : $connection->ssl_mode,
            'connection_timeout' => $validated['connection_timeout'] ?? $connection->connection_timeout,
        ];

        if (isset($validated['access_mode'])) {
            $dataToUpdate['access_mode'] = $validated['access_mode'];
        }
        if (array_key_exists('data_policy', $validated)) {
            $dataToUpdate['data_policy'] = $validated['data_policy'];
        }
        if (array_key_exists('data_timezone', $validated)) {
            $dataToUpdate['data_timezone'] = $validated['data_timezone'];
        }

        if (isset($validated['is_active'])) {
            $dataToUpdate['is_active'] = $validated['is_active'];
        }

        if (!empty($validated['password'])) {
            $dataToUpdate['encrypted_password'] = $validated['password'];
            $dataToUpdate['status'] = 'unverified'; // Require new test when credentials rotate
        }

        $connection->update($dataToUpdate);

        AuditLog::log($request->user()->id, 'CONNECTION_UPDATED', 'DbConnection', (string) $connection->id);

        LiveEventService::publish($request->user()->id, 'connection.updated', [
            'id' => $connection->id,
            'name' => $connection->name,
            'host' => $connection->host,
            'database' => $connection->database_name,
            'status' => $connection->status,
        ], 'DbConnection', (string) $connection->id);

        return response()->json([
            'message' => 'Connection updated successfully',
            'connection' => $connection,
        ]);
    }

    public function destroy(Request $request, $id)
    {
        $connection = DbConnection::where('user_id', $request->user()->id)
            ->where('id', $id)
            ->firstOrFail();

        $activeAutomations = $connection->automations()->where('is_active', true)->get();
        if ($activeAutomations->count() > 0 && !$request->boolean('force')) {
            return response()->json([
                'message' => "Cannot delete connection: {$activeAutomations->count()} active automation(s) depend on it ({$activeAutomations->pluck('name')->implode(', ')}). Disable them first or confirm with force deletion.",
                'dependent_automations' => $activeAutomations->map(fn($a) => ['id' => $a->id, 'name' => $a->name]),
            ], 422);
        }

        $activeAutomationsCount = $activeAutomations->count();
        if ($activeAutomationsCount > 0) {
            $connection->automations()->update(['is_active' => false]);
        }

        $connection->delete();

        AuditLog::log($request->user()->id, 'CONNECTION_DELETED', 'DbConnection', (string) $id);

        LiveEventService::publish($request->user()->id, 'connection.deleted', [
            'id' => (int) $id,
        ], 'DbConnection', (string) $id);

        return response()->json([
            'message' => 'Connection profile removed successfully (target database untouched)',
            'automations_disabled' => $activeAutomationsCount,
        ]);
    }

    public function test(Request $request)
    {
        $validated = $request->validate(array_merge(self::targetRules(false, testing: true), [
            'id' => 'nullable|integer',
            'db_type' => 'nullable|string',
        ]), self::targetMessages());

        $connection = null;
        $timeout = (int) ($validated['connection_timeout'] ?? 5);

        if (!empty($validated['id'])) {
            $connection = DbConnection::where('user_id', $request->user()->id)
                ->where('id', $validated['id'])
                ->firstOrFail();

            $dbType = $connection->db_type ?: 'mysql';
            $host = $connection->host;
            $port = $connection->port;
            $db = $connection->database_name;
            $user = $connection->username;
            $pass = $connection->encrypted_password;
            $sslMode = $this->normalizeSslMode($connection->ssl_mode);
            $timeout = $connection->connection_timeout ?: 5;
        } elseif (!empty($validated['connection_uri'])) {
            $parsed = $this->parseConnectionUri($validated['connection_uri']);
            $dbType = DialectRegistry::normalise($validated['db_type'] ?? 'mysql');
            $host = $parsed['host'];
            $port = $parsed['port'];
            $db = $parsed['database_name'];
            $user = $parsed['username'];
            $pass = $parsed['password'];
            $sslMode = $this->normalizeSslMode($parsed['ssl_mode'] ?? 'preferred');
        } else {
            $dbType = DialectRegistry::normalise($validated['db_type'] ?? 'mysql');
            $host = $validated['host'] ?? '127.0.0.1';
            $port = (int) ($validated['port'] ?? 3306);
            $db = $validated['database_name'] ?? '';
            $user = $validated['username'] ?? '';
            $pass = $validated['password'] ?? '';
            $sslMode = $this->normalizeSslMode($validated['ssl_mode'] ?? 'preferred');
        }

        $res = $this->performPdoTest($host, $port, $db, $user, $pass, $sslMode, $timeout, $dbType);

        if ($connection) {
            $connection->update([
                'status' => $res['success'] ? 'connected' : 'connection_error',
                'last_tested_at' => now(),
                'server_version' => $res['server_version'] ?? null,
                'latency_ms' => $res['latency_ms'] ?? null,
                'error_message' => $res['success'] ? null : $res['message'],
            ]);

            LiveEventService::publish($request->user()->id, 'connection.tested', [
                'id' => $connection->id,
                'status' => $connection->status,
                'latency_ms' => $connection->latency_ms,
                'server_version' => $connection->server_version,
                'last_tested_at' => $connection->last_tested_at->toIso8601String(),
            ], 'DbConnection', (string) $connection->id);
        }

        $statusCode = $res['success'] ? 200 : 422;
        return response()->json($res, $statusCode);
    }

    /**
     * Re-introspect target schema, refresh snapshot, and update schema freshness timestamp.
     */
    public function refreshSchema(Request $request, $id)
    {
        $connection = DbConnection::where('user_id', $request->user()->id)
            ->where('id', $id)
            ->firstOrFail();

        $schema = $this->introspectionService->introspectSchema($connection, true);

        $connection->update([
            'schema_freshness_at' => now(),
            'status' => 'connected',
        ]);

        LiveEventService::publish($request->user()->id, 'schema.refreshed', [
            'connection_id' => $connection->id,
            'table_count' => count($schema['tables'] ?? []),
            'freshness_at' => now()->toIso8601String(),
        ], 'DbConnection', (string) $connection->id);

        return response()->json([
            'message' => 'Schema successfully refreshed and cached in workspace',
            'schema' => $schema,
        ]);
    }

    /**
     * Parse MySQL connection URI into constituent components with safe decoding.
     */
    protected function parseConnectionUri(string $uri): array
    {
        // A URI the parser cannot use is a problem with that field (422 under it), never a server error.
        $fail = fn(string $msg) => throw ValidationException::withMessages(['connection_uri' => [$msg]]);

        $parsed = parse_url($uri);
        if (!$parsed || empty($parsed['host'])) {
            $fail('Connection URI is not in the expected format: mysql://user:password@host:3306/database.');
        }

        $scheme = strtolower($parsed['scheme'] ?? 'mysql');
        if ($scheme !== 'mysql') {
            $fail('Connection URI must start with mysql://. For PostgreSQL, use Connection details.');
        }
        if (ltrim($parsed['path'] ?? '', '/') === '') {
            $fail('Add the database name after the host, like mysql://user:password@127.0.0.1:3306/blog.');
        }
        if (($parsed['user'] ?? '') === '') {
            $fail('Add the username before the host, like mysql://user:password@127.0.0.1:3306/blog.');
        }

        $host = $parsed['host'];
        $port = isset($parsed['port']) ? (int) $parsed['port'] : 3306;
        $user = isset($parsed['user']) ? urldecode($parsed['user']) : '';
        $pass = isset($parsed['pass']) ? urldecode($parsed['pass']) : '';
        $path = ltrim($parsed['path'] ?? '', '/');

        $sslMode = 'preferred';
        if (!empty($parsed['query'])) {
            parse_str($parsed['query'], $queryParams);
            if (!empty($queryParams['ssl-mode']) || !empty($queryParams['ssl_mode']) || !empty($queryParams['sslmode'])) {
                $sslMode = $queryParams['ssl-mode'] ?? $queryParams['ssl_mode'] ?? $queryParams['sslmode'];
            }
        }
        $sslMode = $this->normalizeSslMode($sslMode);

        return [
            'host' => $host,
            'port' => $port,
            'database_name' => $path,
            'username' => $user,
            'password' => $pass,
            'ssl_mode' => $sslMode,
        ];
    }

    private const HOST_PATTERN = '/^[A-Za-z0-9.\-_:\[\]]+$/';
    private const DATABASE_PATTERN = '/^[A-Za-z0-9_$\-]+$/';
    private const URI_PATTERN = '/^mysql:\/\/\S+$/i';

    /**
     * Rules for where a connection points. Manual details (host, database, username) are required unless a
     * connection URI is used; when testing a saved connection by id nothing else is required.
     */
    private static function targetRules(bool $update, bool $testing = false): array
    {
        $needed = $update ? ['sometimes', 'required'] : [$testing ? 'required_without_all:id,connection_uri' : 'required_without:connection_uri'];
        return [
            'connection_mode' => 'nullable|string|in:manual,uri',
            'connection_uri' => ['nullable', 'string', 'max:2048', 'required_if:connection_mode,uri', 'regex:' . self::URI_PATTERN],
            'host' => ['exclude_if:connection_mode,uri', ...$needed, 'nullable', 'string', 'max:253', 'regex:' . self::HOST_PATTERN],
            'port' => 'nullable|integer|min:1|max:65535',
            'database_name' => ['exclude_if:connection_mode,uri', ...$needed, 'nullable', 'string', 'max:64', 'regex:' . self::DATABASE_PATTERN],
            'username' => ['exclude_if:connection_mode,uri', ...$needed, 'nullable', 'string', 'max:80'],
            'password' => 'nullable|string|max:255',
            'ssl_mode' => 'nullable|string|in:disabled,preferred,required,disable,prefer,require',
            'connection_timeout' => 'nullable|integer|min:1|max:30',
        ];
    }

    private static function targetMessages(): array
    {
        return [
            'host.regex' => 'Host must be a hostname or IP address, like 127.0.0.1 or db.example.com.',
            'host.required_without' => 'Host is required.',
            'host.required_without_all' => 'Host is required.',
            'database_name.regex' => 'Database name can use letters, numbers, _, $ and - (up to 64 characters).',
            'database_name.required_without' => 'Database name is required.',
            'database_name.required_without_all' => 'Database name is required.',
            'username.required_without' => 'Username is required.',
            'username.required_without_all' => 'Username is required.',
            'connection_uri.required_if' => 'Paste a connection URI, or switch to connection details.',
            'connection_uri.regex' => 'Connection URI must start with mysql://, like mysql://user:password@127.0.0.1:3306/blog. For PostgreSQL, use Connection details.',
            'connection_timeout.min' => 'Timeout must be between 1 and 30 seconds.',
            'connection_timeout.max' => 'Timeout must be between 1 and 30 seconds.',
            'data_timezone.timezone' => 'Use a valid timezone, like Asia/Kolkata or UTC.',
            'ssl_mode.in' => 'Choose preferred, required or disabled.',
        ];
    }

    /** A host/port the safety rules refuse becomes a 422 on the host field (never a 500). */
    private function refusedTarget(string $host, int $port): ?\Illuminate\Http\JsonResponse
    {
        try {
            $this->safetyService->validateConnectionTarget($host, $port);
            return null;
        } catch (\Throwable $e) {
            // Shown under the field, so the internal "Security violation:" label is left off; the reason stays.
            $msg = preg_replace('/^Security violation:\s*/i', '', $e->getMessage());
            $field = str_contains(strtolower($msg), 'port') ? 'port' : 'host';
            return response()->json(['message' => $msg, 'errors' => [$field => [$msg]]], 422);
        }
    }

    /**
     * Normalize SSL mode into canonical values: disabled, preferred, required.
     */
    protected function normalizeSslMode(?string $sslMode): string
    {
        $mode = strtolower(trim((string) ($sslMode ?? 'preferred')));
        return match ($mode) {
            'disable', 'disabled' => 'disabled',
            'require', 'required' => 'required',
            default => 'preferred',
        };
    }

    /**
     * Perform an ephemeral PDO test without persistent connection leakage.
     */
    protected function performPdoTest(
        string $host,
        int $port,
        string $db,
        string $user,
        string $pass,
        string $sslMode,
        int $timeout = 5,
        string $dbType = 'mysql'
    ): array {
        $start = microtime(true);
        $stages = [];

        try {
            // Stage 1: Validating settings & security
            $this->safetyService->validateConnectionTarget($host, $port);
            $stages[] = [
                'stage' => 'Validating settings',
                'status' => 'passed',
                'detail' => "Target host {$host}:{$port} validated against security guardrails",
            ];

            // Resolve dialect
            $dialect = DialectRegistry::for($dbType);

            // Stage 2: Opening secure connection
            $tempConn = new DbConnection([
                'host' => $host,
                'port' => $port,
                'database_name' => $db,
                'username' => $user,
                'encrypted_password' => $pass,
                'ssl_mode' => $sslMode,
                'db_type' => $dialect->key(),
            ]);

            $pdo = $this->targetConnector->open($tempConn, true, $timeout * 1000);
            $stages[] = [
                'stage' => 'Opening secure connection',
                'status' => 'passed',
                'detail' => "Handshake verified with {$dialect->label()} (SSL mode '{$sslMode}')",
            ];

            // Stage 3: Checking access & privileges
            $serverInfo = $dialect->serverInfo($pdo);
            $serverVersion = $serverInfo['version'] ?? 'Unknown';
            $engine = $serverInfo['engine'] ?? $dialect->label();
            $currentUser = $serverInfo['current_user'] ?? 'authenticated user';
            $stages[] = [
                'stage' => 'Checking access & privileges',
                'status' => 'passed',
                'detail' => "Authenticated as '{$currentUser}' ({$engine} {$serverVersion})",
            ];

            // Stage 4: Reading schema metadata
            $catalog = $dialect->readCatalog($pdo, $tempConn);
            $tblCount = count($catalog['tables'] ?? []);
            $stages[] = [
                'stage' => 'Reading schema metadata',
                'status' => 'passed',
                'detail' => "Discovered {$tblCount} tables/views in database '{$db}'",
            ];

            // Stage 5: Mapping relationships
            $fkCount = count($catalog['foreign_keys'] ?? []);
            $stages[] = [
                'stage' => 'Mapping relationships',
                'status' => 'passed',
                'detail' => "Identified {$fkCount} foreign-key relational constraints",
            ];

            $latency = round((microtime(true) - $start) * 1000, 2);

            // Stage 6: Finishing
            $stages[] = [
                'stage' => 'Finishing',
                'status' => 'passed',
                'detail' => "Verification completed in {$latency}ms",
            ];

            return [
                'success' => true,
                'message' => "Connection established successfully ({$engine} {$serverVersion})",
                'latency_ms' => $latency,
                'server_version' => $serverVersion,
                'engine' => $engine,
                'table_count' => $tblCount,
                'fk_count' => $fkCount,
                'stages' => $stages,
            ];
        } catch (\Throwable $e) {
            $latency = round((microtime(true) - $start) * 1000, 2);
            $safeMsg = TargetConnector::safeMessage($e);
            $stages[] = [
                'stage' => 'Connection diagnostic',
                'status' => 'failed',
                'detail' => $safeMsg,
            ];

            return [
                'success' => false,
                'message' => "Connection failed: " . $safeMsg,
                'latency_ms' => $latency,
                'stages' => $stages,
            ];
        }
    }
}
