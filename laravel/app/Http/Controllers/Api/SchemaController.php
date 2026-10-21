<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DbConnection;
use App\Models\SchemaTableAnnotation;
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

                return response()->json($payload);
            }
        }

        $schema = $this->introspectionService->introspectSchema($connection);

        return response()->json($schema);
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
}
