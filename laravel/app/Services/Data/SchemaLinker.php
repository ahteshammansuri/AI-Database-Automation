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
                    'type' => $cMeta['raw_type'] ?? $cMeta['type'] ?? $cMeta['data_type'] ?? 'varchar',
                    'values' => !empty($cMeta['enum']) ? array_values($cMeta['enum']) : null,
                    'nullable' => $cMeta['nullable'] ?? $cMeta['is_nullable'] ?? true,
                    'is_primary' => ($cMeta['is_primary'] ?? false) || in_array($cName, (array) ($tMeta['primary_key'] ?? []), true),
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

        // 4. Value grounding: real stored values of short categorical columns, so the model can map the
        //    user's words to them (e.g. "Rajasthan" -> 'RJ', "refund" -> 'refunded').
        $this->attachCategoryValues($connection, $tablesSlice, $allTables);
        $groundedValues = [];

        return [
            'tables' => $tablesSlice,
            'foreign_keys' => $relevantFks,
            'grounded_values' => $groundedValues,
        ];
    }

    /** At most this many columns are sampled per question, each from a bounded row sample. */
    private const MAX_SAMPLED_COLUMNS = 40;
    private const MAX_CATEGORY_VALUES = 25;

    /**
     * Attach the distinct stored values of short text columns that look categorical (few distinct values
     * in a bounded sample). Read-only and time-limited; personal, secret and label columns are skipped.
     * Best effort: on any error the slice is returned without values.
     */
    protected function attachCategoryValues(DbConnection $connection, array &$tablesSlice, array $allTables): void
    {
        $candidates = [];
        foreach ($tablesSlice as $t => $tData) {
            foreach ($tData['columns'] as $c => $cData) {
                $meta = $allTables[$t]['columns'][$c] ?? [];
                if (!empty($cData['values']) || ($meta['family'] ?? '') !== 'string' || !empty($meta['is_label'])
                    || ColumnClassifier::isPii($c) || ColumnClassifier::isSecret($c) || (int) ($meta['max_length'] ?? 255) > 64) {
                    continue;
                }
                $candidates[] = [$t, $c];
            }
        }
        if (!$candidates) {
            return;
        }

        try {
            $this->targetConnector->read($connection, function (PDO $pdo, $dialect) use (&$tablesSlice, $candidates) {
                foreach (array_slice($candidates, 0, self::MAX_SAMPLED_COLUMNS) as [$t, $c]) {
                    $qc = $dialect->quoteIdentifier($c);
                    $qt = $dialect->quoteIdentifier($t);
                    $vals = $pdo->query("SELECT DISTINCT v FROM (SELECT {$qc} AS v FROM {$qt} WHERE {$qc} IS NOT NULL LIMIT 5000) s LIMIT "
                        . (self::MAX_CATEGORY_VALUES + 1))->fetchAll(PDO::FETCH_COLUMN);
                    if ($vals && count($vals) <= self::MAX_CATEGORY_VALUES) {
                        $tablesSlice[$t]['columns'][$c]['values'] = array_map(fn ($v) => mb_substr((string) $v, 0, 40), $vals);
                    }
                }
            }, 3000);
        } catch (\Throwable) {
            // Grounding only improves the query; the question is still answered without it.
        }
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
