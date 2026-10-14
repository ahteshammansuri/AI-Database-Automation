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
            'ai_purpose' => 'nullable|string',
            'ai_business_concept' => 'nullable|string',
            'user_override_notes' => 'nullable|string',
            'user_notes' => 'nullable|string',
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
