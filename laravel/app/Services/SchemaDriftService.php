<?php

namespace App\Services;

use App\Models\DbConnection;
use App\Models\SchemaSnapshot;
use App\Models\Automation;
use Exception;

class SchemaDriftService
{
    public function __construct(
        protected SchemaIntrospectionService $introspectionService,
        protected FeatureFlagService $featureFlagService
    ) {}

    /**
     * Detect schema drift between live target database and latest stored schema snapshot.
     */
    public function detectDrift(DbConnection $connection): array
    {
        if (!$this->featureFlagService->isEnabled('FEATURE_SCHEMA_DRIFT')) {
            return [
                'feature_enabled' => false,
                'has_drift' => false,
                'message' => 'Schema drift detection is currently disabled via feature flag.',
            ];
        }

        // 1. Fetch live schema
        $liveSchema = $this->introspectionService->introspect($connection);
        $liveTables = $liveSchema['tables'] ?? [];

        // 2. Fetch latest snapshot
        $snapshot = SchemaSnapshot::where('connection_id', $connection->id)
            ->latest('version')
            ->first();

        if (!$snapshot) {
            // First time - store initial baseline snapshot
            $newSnapshot = SchemaSnapshot::create([
                'user_id' => $connection->user_id,
                'connection_id' => $connection->id,
                'version' => 1,
                'schema_payload' => $liveSchema,
                'table_count' => count($liveTables),
                'column_count' => $this->countColumns($liveTables),
            ]);

            return [
                'feature_enabled' => true,
                'has_drift' => false,
                'is_initial_baseline' => true,
                'snapshot_version' => 1,
                'message' => 'Initial schema baseline established. No prior drift detected.',
                'added_tables' => [],
                'removed_tables' => [],
                'modified_tables' => [],
                'impacted_automations' => [],
            ];
        }

        $cachedPayload = $snapshot->schema_payload ?? [];
        $cachedTables = $cachedPayload['tables'] ?? [];

        // Map tables by name
        $liveTableMap = [];
        foreach ($liveTables as $t) {
            $liveTableMap[$t['name']] = $t;
        }

        $cachedTableMap = [];
        foreach ($cachedTables as $t) {
            $cachedTableMap[$t['name']] = $t;
        }

        $addedTables = array_values(array_diff(array_keys($liveTableMap), array_keys($cachedTableMap)));
        $removedTables = array_values(array_diff(array_keys($cachedTableMap), array_keys($liveTableMap)));
        $modifiedTables = [];

        // Compare shared tables
        $sharedTableNames = array_intersect(array_keys($liveTableMap), array_keys($cachedTableMap));
        foreach ($sharedTableNames as $tblName) {
            $liveTbl = $liveTableMap[$tblName];
            $cachedTbl = $cachedTableMap[$tblName];

            $colDrift = $this->compareTableColumns($liveTbl['columns'] ?? [], $cachedTbl['columns'] ?? []);
            if (!empty($colDrift['added']) || !empty($colDrift['removed']) || !empty($colDrift['altered'])) {
                $modifiedTables[] = [
                    'table_name' => $tblName,
                    'added_columns' => $colDrift['added'],
                    'removed_columns' => $colDrift['removed'],
                    'altered_columns' => $colDrift['altered'],
                ];
            }
        }

        $hasDrift = !empty($addedTables) || !empty($removedTables) || !empty($modifiedTables);

        // Find impacted automations
        $impactedAutomations = [];
        if ($hasDrift) {
            $affectedTableNames = array_merge($removedTables, array_column($modifiedTables, 'table_name'));
            $impactedAutomations = Automation::where('connection_id', $connection->id)
                ->whereIn('target_table', $affectedTableNames)
                ->get(['id', 'name', 'target_table', 'is_active', 'schedule_type'])
                ->toArray();
        }

        return [
            'feature_enabled' => true,
            'has_drift' => $hasDrift,
            'baseline_version' => $snapshot->version,
            'added_tables' => $addedTables,
            'removed_tables' => $removedTables,
            'modified_tables' => $modifiedTables,
            'impacted_automations' => $impactedAutomations,
            'summary' => $hasDrift
                ? sprintf(
                    'Drift detected: %d table(s) added, %d removed, %d modified. %d automation(s) potentially impacted.',
                    count($addedTables),
                    count($removedTables),
                    count($modifiedTables),
                    count($impactedAutomations)
                )
                : 'Schema is in sync with latest baseline snapshot.',
        ];
    }

    /**
     * Compare columns between live table and cached table.
     */
    protected function compareTableColumns(array $liveCols, array $cachedCols): array
    {
        $liveColMap = [];
        foreach ($liveCols as $c) {
            $liveColMap[$c['name']] = $c;
        }

        $cachedColMap = [];
        foreach ($cachedCols as $c) {
            $cachedColMap[$c['name']] = $c;
        }

        $added = [];
        foreach (array_diff(array_keys($liveColMap), array_keys($cachedColMap)) as $addedName) {
            $added[] = $liveColMap[$addedName];
        }

        $removed = [];
        foreach (array_diff(array_keys($cachedColMap), array_keys($liveColMap)) as $removedName) {
            $removed[] = $cachedColMap[$removedName];
        }

        $altered = [];
        foreach (array_intersect(array_keys($liveColMap), array_keys($cachedColMap)) as $commonName) {
            $l = $liveColMap[$commonName];
            $c = $cachedColMap[$commonName];

            $typeChanged = strtolower($l['type'] ?? '') !== strtolower($c['type'] ?? '');
            $nullableChanged = (bool) ($l['nullable'] ?? false) !== (bool) ($c['nullable'] ?? false);

            if ($typeChanged || $nullableChanged) {
                $altered[] = [
                    'name' => $commonName,
                    'old_type' => $c['type'] ?? '',
                    'new_type' => $l['type'] ?? '',
                    'old_nullable' => (bool) ($c['nullable'] ?? false),
                    'new_nullable' => (bool) ($l['nullable'] ?? false),
                ];
            }
        }

        return [
            'added' => $added,
            'removed' => $removed,
            'altered' => $altered,
        ];
    }

    protected function countColumns(array $tables): int
    {
        $count = 0;
        foreach ($tables as $t) {
            $count += count($t['columns'] ?? []);
        }
        return $count;
    }
}
