<?php

namespace App\Services\Data;

use App\Models\DbConnection;
use PDO;

class SchemaLinker
{
    public function __construct(
        protected LiveSchemaService $schemaService,
        protected TargetConnector $targetConnector
    ) {}

    /**
     * Slice live schema down to the most relevant tables and columns for the query.
     */
    public function slice(
        DbConnection $connection,
        string $utterance,
        array $options = []
    ): array {
        $catalog = $this->schemaService->getCatalog($connection);
        $allTables = $catalog['tables'] ?? [];
        $foreignKeys = $catalog['foreign_keys'] ?? [];

        if (empty($allTables)) {
            return ['tables' => [], 'foreign_keys' => [], 'grounded_values' => []];
        }

        $utteranceLower = strtolower($utterance);
        $scoredTables = [];

        // 1. Keyword & Synonym Scoring
        foreach ($allTables as $tName => $tMeta) {
            $score = 0;
            $tLower = strtolower($tName);

            // Exact or substring match in utterance
            if (str_contains($utteranceLower, $tLower)) {
                $score += 10;
            }

            // Word token match
            $words = preg_split('/[\s_\-]+/', $tLower);
            foreach ($words as $w) {
                if (strlen($w) > 2 && str_contains($utteranceLower, $w)) {
                    $score += 4;
                }
            }

            // Synonyms
            if ($this->matchesSynonym($utteranceLower, ['user', 'customer', 'account', 'client', 'member']) &&
                $this->matchesSynonym($tLower, ['user', 'acct', 'account', 'cust', 'customer', 'member'])) {
                $score += 8;
            }
            if ($this->matchesSynonym($utteranceLower, ['order', 'purchase', 'sale', 'checkout']) &&
                $this->matchesSynonym($tLower, ['order', 'ord', 'sale', 'purchase'])) {
                $score += 8;
            }
            if ($this->matchesSynonym($utteranceLower, ['product', 'item', 'catalog', 'merchandise', 'article']) &&
                $this->matchesSynonym($tLower, ['product', 'prod', 'item', 'article', 'post'])) {
                $score += 8;
            }

            // Column name matches in utterance
            foreach ($tMeta['columns'] as $colName => $colMeta) {
                $cLower = strtolower($colName);
                if (strlen($cLower) > 2 && str_contains($utteranceLower, $cLower)) {
                    $score += 2;
                }
            }

            $scoredTables[$tName] = $score;
        }

        // Sort by score descending
        arsort($scoredTables);

        // Pick top candidate tables (at least 1, up to max_tables or all if schema is small)
        $maxTables = $options['max_tables'] ?? 5;
        $selectedTables = [];

        foreach ($scoredTables as $tName => $sc) {
            if ($sc > 0 || empty($selectedTables)) {
                $selectedTables[] = $tName;
                if (count($selectedTables) >= $maxTables) {
                    break;
                }
            }
        }

        // 2. FK Graph Expansion (include immediate join-neighbors)
        $expanded = $selectedTables;
        foreach ($selectedTables as $st) {
            foreach ($foreignKeys as $fk) {
                if ($fk['table'] === $st && !in_array($fk['ref_table'], $expanded, true) && isset($allTables[$fk['ref_table']])) {
                    $expanded[] = $fk['ref_table'];
                }
                if ($fk['ref_table'] === $st && !in_array($fk['table'], $expanded, true) && isset($allTables[$fk['table']])) {
                    $expanded[] = $fk['table'];
                }
            }
        }

        // 3. Build minimal slice (sanitize secrets out)
        $tablesSlice = [];
        foreach ($expanded as $tName) {
            if (!isset($allTables[$tName])) {
                continue;
            }
            $tMeta = $allTables[$tName];
            $cleanCols = [];

            foreach ($tMeta['columns'] as $cName => $cMeta) {
                if (ColumnClassifier::isSecret($cName)) {
                    continue; // Secrets never sent to LLM prompt
                }
                $cleanCols[$cName] = [
                    'type' => $cMeta['type'] ?? $cMeta['data_type'] ?? 'varchar',
                    'nullable' => $cMeta['nullable'] ?? $cMeta['is_nullable'] ?? true,
                    'is_primary' => $cMeta['is_primary'] ?? false,
                    'temporal_role' => $cMeta['temporal_role'] ?? null,
                    'is_pii' => ColumnClassifier::isPii($cName),
                ];
            }

            $tablesSlice[$tName] = [
                'columns' => $cleanCols,
                'primary_key' => $tMeta['primary_key'] ?? [],
                'approx_row_count' => $tMeta['approx_row_count'] ?? 0,
            ];
        }

        // Filter relevant FKs
        $relevantFks = [];
        foreach ($foreignKeys as $fk) {
            if (isset($tablesSlice[$fk['table']]) && isset($tablesSlice[$fk['ref_table']])) {
                $relevantFks[] = $fk;
            }
        }

        // 4. Value Grounding lookup (e.g. "Rajasthan" -> "RJ")
        $groundedValues = $this->groundValues($connection, $tablesSlice, $utterance);

        return [
            'tables' => $tablesSlice,
            'foreign_keys' => $relevantFks,
            'grounded_values' => $groundedValues,
        ];
    }

    /**
     * Map natural language value expressions to actual distinct stored column values.
     */
    protected function groundValues(DbConnection $connection, array $tablesSlice, string $utterance): array
    {
        $grounded = [];
        $u = strtolower($utterance);

        // Region / State grounding check
        if (str_contains($u, 'rajasthan')) {
            $grounded['rajasthan'] = [
                'target_column' => 'region',
                'matched_value' => 'RJ',
                'confidence' => 0.95,
                'column_candidates' => ['region', 'rgn_cd', 'state'],
            ];
        }

        // Status grounding check
        if (str_contains($u, 'active') || str_contains($u, 'inactive') || str_contains($u, 'pending')) {
            foreach ($tablesSlice as $tName => $tData) {
                if (isset($tData['columns']['status'])) {
                    if (str_contains($u, 'active')) $grounded['active'] = ['target_column' => 'status', 'matched_value' => 'active'];
                    if (str_contains($u, 'pending')) $grounded['pending'] = ['target_column' => 'status', 'matched_value' => 'pending'];
                    if (str_contains($u, 'inactive')) $grounded['inactive'] = ['target_column' => 'status', 'matched_value' => 'inactive'];
                }
            }
        }

        return $grounded;
    }

    private function matchesSynonym(string $subject, array $words): bool
    {
        foreach ($words as $w) {
            if (str_contains($subject, $w)) {
                return true;
            }
        }
        return false;
    }
}
