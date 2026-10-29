<?php

namespace App\Services\Data;

use App\Models\DbConnection;
use App\Services\AiServiceClient;
use PDO;

class SchemaLinker
{
    public function __construct(
        protected LiveSchemaService $schemaService,
        protected TargetConnector $targetConnector,
        protected ?AiServiceClient $aiServiceClient = null
    ) {
        $this->aiServiceClient ??= app(AiServiceClient::class);
    }

    /**
     * Slice live schema down to the most relevant tables and columns for the query.
     * Uses dynamic vector embedding ranking and direct metadata token matching.
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

        $maxTables = $options['max_tables'] ?? 10;
        $selectedTables = [];

        // If the database has a small-to-medium schema (<= maxTables), include all tables!
        // This guarantees 100% table availability and zero missed tables for customer questions.
        if (count($allTables) <= $maxTables) {
            $selectedTables = array_keys($allTables);
        } else {
            // Large schema: Dynamically rank tables using AI service embeddings / RAG
            $selectedTables = $this->rankTablesDynamically($utterance, $allTables, $maxTables);
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

            foreach ($tMeta['columns'] as $cName => $colMeta) {
                if (ColumnClassifier::isSecret($cName)) {
                    continue; // Secrets never sent to LLM prompt
                }
                $cleanCols[$cName] = [
                    'type' => $colMeta['raw_type'] ?? $colMeta['type'] ?? $colMeta['data_type'] ?? 'varchar',
                    'values' => !empty($colMeta['enum']) ? array_values($colMeta['enum']) : null,
                    'nullable' => $colMeta['nullable'] ?? $colMeta['is_nullable'] ?? true,
                    'is_primary' => ($colMeta['is_primary'] ?? false) || in_array($cName, (array) ($tMeta['primary_key'] ?? []), true),
                    'temporal_role' => $colMeta['temporal_role'] ?? null,
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

        // 4. Value grounding: real stored values of short categorical columns
        $this->attachCategoryValues($connection, $tablesSlice, $allTables);
        $groundedValues = [];

        return [
            'tables' => $tablesSlice,
            'foreign_keys' => $relevantFks,
            'grounded_values' => $groundedValues,
        ];
    }

    /**
     * Rank tables using AI semantic vector embeddings, falling back to dynamic metadata token matching.
     */
    protected function rankTablesDynamically(string $utterance, array $allTables, int $maxTables): array
    {
        // 1. Try AI service semantic vector ranking
        try {
            $tableCandidates = [];
            foreach ($allTables as $tName => $tMeta) {
                $cols = array_keys($tMeta['columns'] ?? []);
                $tableCandidates[] = [
                    'name' => $tName,
                    'description' => "Table {$tName} with columns: " . implode(', ', array_slice($cols, 0, 20)),
                ];
            }

            $aiRanked = $this->aiServiceClient->rankTables($utterance, $tableCandidates, $maxTables);
            if (!empty($aiRanked)) {
                $names = [];
                foreach ($aiRanked as $item) {
                    if (isset($item['name']) && isset($allTables[$item['name']])) {
                        $names[] = $item['name'];
                    }
                }
                if (!empty($names)) {
                    return array_slice(array_unique($names), 0, $maxTables);
                }
            }
        } catch (\Throwable) {
            // Fall through to metadata token matching
        }

        // 2. Resilient dynamic fallback: match utterance tokens directly against schema metadata (table & column names)
        $utteranceLower = strtolower($utterance);
        $scored = [];

        foreach ($allTables as $tName => $tMeta) {
            $score = 0;
            $tLower = strtolower($tName);

            // Exact match
            if (str_contains($utteranceLower, $tLower)) {
                $score += 10;
            }

            // Singular/plural matching
            $singular = rtrim($tLower, 's');
            $plural = $tLower . 's';
            if (strlen($singular) > 2 && str_contains($utteranceLower, $singular)) {
                $score += 8;
            }
            if (strlen($plural) > 3 && str_contains($utteranceLower, $plural)) {
                $score += 8;
            }

            // Token overlap with table name
            $tWords = preg_split('/[\s_\-]+/', $tLower);
            foreach ($tWords as $w) {
                if (strlen($w) > 2 && str_contains($utteranceLower, $w)) {
                    $score += 4;
                }
            }

            // Column name matches
            foreach ($tMeta['columns'] ?? [] as $colName => $colMeta) {
                $cLower = strtolower($colName);
                if (strlen($cLower) > 2 && str_contains($utteranceLower, $cLower)) {
                    $score += 3;
                }
            }

            $scored[$tName] = $score;
        }

        arsort($scored);
        $result = [];
        foreach ($scored as $tName => $sc) {
            if ($sc > 0 || empty($result)) {
                $result[] = $tName;
                if (count($result) >= $maxTables) {
                    break;
                }
            }
        }

        return $result ?: array_slice(array_keys($allTables), 0, $maxTables);
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
                $family = $meta['family'] ?? '';
                $isCategorical = $family === 'string'
                    || in_array($family, ['enum', 'boolean'], true)
                    || ($family === 'integer' && preg_match('/status|type|role|state|flag/i', $c));

                if (!empty($cData['values']) || !$isCategorical || !empty($meta['is_label'])
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
}
