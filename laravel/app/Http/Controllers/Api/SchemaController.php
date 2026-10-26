<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\DbConnection;
use App\Models\SchemaTableAnnotation;
use App\Services\Data\ColumnClassifier;
use App\Services\Data\DataAccessPolicy;
use App\Services\Data\LiveSchemaService;
use App\Services\SchemaIntrospectionService;
use Illuminate\Http\Request;

class SchemaController extends Controller
{
    public function __construct(
        protected SchemaIntrospectionService $introspectionService
    ) {}

    public function introspect(Request $request, $connectionId)
    {
        $connection = DbConnection::where('user_id', $request->user()->id)
            ->where('id', $connectionId)
            ->firstOrFail();

        // Serve cached snapshot instantly if not explicitly requesting fresh scan
        if (!$request->boolean('refresh')) {
            $latestSnapshot = \App\Models\SchemaSnapshot::where('connection_id', $connection->id)
                ->orderByDesc('id')
                ->first();

            if ($latestSnapshot && !empty($latestSnapshot->schema_payload)) {
                $payload = $latestSnapshot->schema_payload;

                // Overlay latest user annotations in-memory
                $annotations = SchemaTableAnnotation::where('connection_id', $connection->id)
                    ->where('user_id', $connection->user_id)
                    ->get()
                    ->keyBy('table_name');

                if (!empty($payload['tables']) && is_array($payload['tables'])) {
                    foreach ($payload['tables'] as &$table) {
                        $tableName = $table['name'] ?? ($table['table_name'] ?? '');
                        if ($tableName && $annotations->has($tableName)) {
                            $ann = $annotations->get($tableName);
                            $table['ai_suggestion'] = array_merge($table['ai_suggestion'] ?? [], [
                                'purpose' => $ann->ai_purpose ?: ($table['ai_suggestion']['purpose'] ?? null),
                                'concept' => $ann->ai_business_concept ?: ($table['ai_suggestion']['concept'] ?? null),
                                'user_notes' => $ann->user_override_notes,
                                'is_user_verified' => (bool) $ann->is_user_verified,
                            ]);
                        }
                    }
                }

                return response()->json($this->withProtection($connection, $payload));
            }
        }

        $schema = $this->introspectionService->introspectSchema($connection);

        return response()->json($this->withProtection($connection, $schema));
    }

    /**
     * Adds what the data rules enforce, so the explorer shows it: each table's access class (blocked, read_only,
     * writable or an owner override) and each column's sensitivity (secret: never returned; pii: masked).
     */
    private function withProtection(DbConnection $connection, array $payload): array
    {
        $policy = app(DataAccessPolicy::class);
        foreach ($payload['tables'] ?? [] as $i => $table) {
            if (!is_array($table)) {
                continue;
            }
            $name = $table['name'] ?? ($table['table_name'] ?? '');
            $payload['tables'][$i]['data_class'] = $name !== '' ? $policy->getTableClass($connection, $name) : null;
            $payload['tables'][$i]['data_class_default'] = $name !== '' ? $policy->defaultTableClass($name) : null;
            foreach ($table['columns'] ?? [] as $j => $column) {
                $payload['tables'][$i]['columns'][$j]['sensitivity'] = ColumnClassifier::classify((string) ($column['name'] ?? ''))['class'];
            }
        }

        return $payload;
    }

    public function lookupRecords(Request $request, $connectionId)
    {
        $connection = DbConnection::where('user_id', $request->user()->id)
            ->where('id', $connectionId)
            ->firstOrFail();

        $table = $request->query('table');
        if (!$table || !preg_match('/^[a-zA-Z0-9_]+$/', $table)) {
            return response()->json(['error' => 'Invalid table name'], 422);
        }

        if (app(\App\Services\Data\DataAccessPolicy::class)->getTableClass($connection, $table) === 'blocked') {
            return response()->json(['error' => "Table '{$table}' is protected and cannot be listed."], 403);
        }

        $search = $request->query('search') ?: $request->query('q');
        $limit = min((int) ($request->query('limit', 100)), 200);

        $records = $this->introspectionService->getTableLookupRecords($connection, $table, $limit, $search);

        return response()->json($records);
    }

    public function annotateTable(Request $request, $connectionId, $tableName)
    {
        $connection = DbConnection::where('user_id', $request->user()->id)
            ->where('id', $connectionId)
            ->firstOrFail();

        $validated = $request->validate([
            'ai_purpose' => 'nullable|string|max:2000',
            'ai_business_concept' => 'nullable|string|max:255',
            'user_override_notes' => 'nullable|string|max:2000',
            'user_notes' => 'nullable|string|max:2000',
            'is_user_verified' => 'nullable|boolean',
        ]);

        if (!empty($validated['user_notes']) && empty($validated['user_override_notes'])) {
            $validated['user_override_notes'] = $validated['user_notes'];
        }
        unset($validated['user_notes']);

        $annotation = SchemaTableAnnotation::updateOrCreate(
            [
                'user_id' => $request->user()->id,
                'connection_id' => $connection->id,
                'table_name' => $tableName,
            ],
            $validated
        );

        return response()->json([
            'message' => 'Table annotation saved to workspace knowledge',
            'annotation' => $annotation,
        ]);
    }

    /**
     * The owner sets whether a table's rows may be changed on this connection (view only or editable), or returns it
     * to the default. Credential, token and session tables stay blocked whatever is asked. Audited with before/after.
     */
    public function setTableAccess(Request $request, $connectionId, $tableName)
    {
        $connection = DbConnection::where('user_id', $request->user()->id)
            ->where('id', $connectionId)
            ->firstOrFail();

        $validated = $request->validate([
            'access' => 'required|string|in:default,' . implode(',', DataAccessPolicy::OVERRIDE_CLASSES),
        ], [
            'access.in' => 'Choose view only, editable or the default.',
        ]);

        $policy = app(DataAccessPolicy::class);
        if (!preg_match('/^[A-Za-z0-9_]{1,64}$/', (string) $tableName)) {
            return response()->json(['message' => 'That is not a valid table name.'], 422);
        }
        if ($policy->defaultTableClass($tableName) === 'blocked') {
            return response()->json(['message' => 'Credential, token and session tables are always hidden; their access cannot be changed.'], 422);
        }

        $before = $policy->getTableClass($connection, $tableName);
        $dataPolicy = (array) ($connection->data_policy ?? []);
        $overrides = (array) ($dataPolicy['table_overrides'] ?? []);
        $key = strtolower($tableName);
        if ($validated['access'] === 'default') {
            unset($overrides[$key]);
        } else {
            $overrides[$key] = $validated['access'];
        }
        $dataPolicy['table_overrides'] = $overrides;
        $connection->data_policy = $dataPolicy;
        $connection->save();
        app(LiveSchemaService::class)->forget($connection);
        $after = $policy->getTableClass($connection, $tableName);

        AuditLog::log($request->user()->id, 'CONNECTION_TABLE_ACCESS_CHANGED', 'DbConnection', (string) $connection->id, [
            'table' => $tableName,
            'before' => $before,
            'after' => $after,
            'choice' => $validated['access'],
        ]);

        return response()->json([
            'table' => $tableName,
            'data_class' => $after,
            'data_class_default' => $policy->defaultTableClass($tableName),
            'message' => $after === 'writable' ? "Rows in {$tableName} can now be changed on this connection." : "{$tableName} is now view only on this connection.",
        ]);
    }
}
