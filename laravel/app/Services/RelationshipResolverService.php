<?php

namespace App\Services;

use App\Models\DbConnection;
use Exception;
use PDO;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\Log;

/**
 * RelationshipResolverService
 *
 * Resolves human-readable reference proposals (e.g. "Cloud Computing", "John Doe")
 * into real, validated primary key values in target customer tables.
 *
 * Policies:
 *  - 'resolve_only': Match existing records only. If no match is found, resolution fails.
 *  - 'create_if_missing': If no match is found (and table is non-sensitive), insert a new record.
 *  - 'ask_user': If no match or ambiguous, return candidate options for user clarification.
 *
 * Security Invariants:
 *  - Sensitive tables (users, credentials, payments, logs) are NEVER created automatically.
 *  - Ambiguous matches (multiple candidates) are flagged rather than guessing an arbitrary ID.
 *  - All queries are parameterized; runs inside the caller's active PDO transaction.
 */
class RelationshipResolverService
{
    public const POLICY_RESOLVE_ONLY = 'resolve_only';
    public const POLICY_CREATE_IF_MISSING = 'create_if_missing';
    public const POLICY_ASK_USER = 'ask_user';

    public function __construct(
        protected DatabaseSafetyService $safetyService
    ) {}

    /**
     * Resolve a foreign key relation using an existing PDO connection (within an active transaction).
     *
     * @param  PDO         $pdo          Active PDO target database connection.
     * @param  string      $dbName       Target database name.
     * @param  string      $refTable     Referenced table name (e.g. 'categories', 'authors').
     * @param  string      $refCol       Referenced PK column (e.g. 'id', 'category_id').
     * @param  mixed       $lookupValue  Human-readable string (e.g. "Cloud Computing") or integer ID.
     * @param  string      $policy       One of resolve_only, create_if_missing, ask_user.
     * @param  array       $options      Additional options (e.g. 'relation_field', 'default_id').
     * @return array{
     *   relation_field: string,
     *   ref_table: string,
     *   matched_or_created: string, // 'REUSED_BY_ID' | 'MATCHED' | 'CREATED' | 'AMBIGUOUS' | 'FAILED'
     *   real_id: ?int,
     *   lookup_value: mixed,
     *   policy_used: string,
     *   details: string,
     *   candidates: array,
     * }
     */
    public function resolve(
        PDO $pdo,
        string $dbName,
        string $refTable,
        string $refCol,
        mixed $lookupValue,
        string $policy = self::POLICY_CREATE_IF_MISSING,
        array $options = []
    ): array {
        $relationField = $options['relation_field'] ?? $refCol;
        $isSensitive = $this->safetyService->isTableSensitive($refTable);

        // Security rule: sensitive tables (users, logs, billing) CANNOT have auto-created records
        if ($isSensitive && $policy === self::POLICY_CREATE_IF_MISSING) {
            $policy = self::POLICY_RESOLVE_ONLY;
        }

        // Branch 1: Explicit numeric ID passed
        if (is_numeric($lookupValue) && (int) $lookupValue > 0) {
            $idVal = (int) $lookupValue;
            $stmt = $pdo->prepare("SELECT `{$refCol}` FROM `{$refTable}` WHERE `{$refCol}` = :id LIMIT 1");
            $stmt->execute(['id' => $idVal]);
            if ($stmt->fetch()) {
                return [
                    'relation_field'     => $relationField,
                    'ref_table'          => $refTable,
                    'matched_or_created' => 'REUSED_BY_ID',
                    'real_id'            => $idVal,
                    'lookup_value'       => $idVal,
                    'policy_used'        => $policy,
                    'details'            => "Reused existing record ID #{$idVal} in {$refTable}.",
                    'candidates'         => [],
                ];
            }
        }

        // Branch 2: Semantic string lookup (e.g. "Cloud Computing")
        $rawSearch = is_string($lookupValue) ? trim($lookupValue) : null;
        if (empty($rawSearch)) {
            $defaultId = !empty($options['default_id']) && is_numeric($options['default_id']) ? (int) $options['default_id'] : null;
            return [
                'relation_field'     => $relationField,
                'ref_table'          => $refTable,
                'matched_or_created' => $defaultId ? 'DEFAULT_ID' : 'FAILED',
                'real_id'            => $defaultId,
                'lookup_value'       => $lookupValue,
                'policy_used'        => $policy,
                'details'            => $defaultId ? "Applied default ID #{$defaultId} for empty lookup." : "Empty lookup value for relation {$relationField}.",
                'candidates'         => [],
            ];
        }

        $slugVal = Str::slug($rawSearch);

        // Introspect available columns in the referenced table
        $refCols = $this->getReferencedTableColumns($pdo, $dbName, $refTable);

        // Search for matches
        $matches = $this->searchReferencedRecords($pdo, $refTable, $refCol, $refCols, $rawSearch, $slugVal);

        // Exact 1 match
        if (count($matches) === 1) {
            $foundId = (int) $matches[0][$refCol];
            $matchName = $matches[0]['name'] ?? $matches[0]['title'] ?? $rawSearch;
            return [
                'relation_field'     => $relationField,
                'ref_table'          => $refTable,
                'matched_or_created' => 'MATCHED',
                'real_id'            => $foundId,
                'lookup_value'       => $rawSearch,
                'policy_used'        => $policy,
                'details'            => "Matched existing record '{$matchName}' (ID #{$foundId}) in {$refTable}.",
                'candidates'         => [],
            ];
        }

        // Multiple matches -> Ambiguity
        if (count($matches) > 1) {
            $candidates = array_map(fn($m) => [
                'id' => (int) $m[$refCol],
                'name' => $m['name'] ?? $m['title'] ?? (string) $m[$refCol],
            ], $matches);

            // If an exact case-insensitive match exists among candidates, pick it
            foreach ($matches as $m) {
                $candidateName = strtolower($m['name'] ?? $m['title'] ?? '');
                if ($candidateName === strtolower($rawSearch) || ($slugVal && ($m['slug'] ?? '') === $slugVal)) {
                    $foundId = (int) $m[$refCol];
                    return [
                        'relation_field'     => $relationField,
                        'ref_table'          => $refTable,
                        'matched_or_created' => 'MATCHED',
                        'real_id'            => $foundId,
                        'lookup_value'       => $rawSearch,
                        'policy_used'        => $policy,
                        'details'            => "Resolved exact match among candidates for '{$rawSearch}' (ID #{$foundId}).",
                        'candidates'         => [],
                    ];
                }
            }

            // Ambiguous
            return [
                'relation_field'     => $relationField,
                'ref_table'          => $refTable,
                'matched_or_created' => 'AMBIGUOUS',
                'real_id'            => null,
                'lookup_value'       => $rawSearch,
                'policy_used'        => $policy,
                'details'            => "Ambiguous relation: multiple matches found for '{$rawSearch}' in {$refTable}.",
                'candidates'         => $candidates,
            ];
        }

        // Branch 3: No matches found -> apply policy
        if ($policy === self::POLICY_CREATE_IF_MISSING && !$isSensitive) {
            $newId = $this->createReferencedRecord($pdo, $refTable, $refCol, $refCols, $rawSearch, $slugVal);
            if ($newId) {
                return [
                    'relation_field'     => $relationField,
                    'ref_table'          => $refTable,
                    'matched_or_created' => 'CREATED',
                    'real_id'            => $newId,
                    'lookup_value'       => $rawSearch,
                    'policy_used'        => $policy,
                    'details'            => "Created new record '{$rawSearch}' (ID #{$newId}) in {$refTable} via {$policy}.",
                    'candidates'         => [],
                ];
            }
        }

        // resolve_only or ask_user without match
        return [
            'relation_field'     => $relationField,
            'ref_table'          => $refTable,
            'matched_or_created' => 'FAILED',
            'real_id'            => null,
            'lookup_value'       => $rawSearch,
            'policy_used'        => $policy,
            'details'            => "No matching record for '{$rawSearch}' in {$refTable} and policy is {$policy}.",
            'candidates'         => [],
        ];
    }

    /**
     * Helper to introspect column names in referenced table.
     */
    protected function getReferencedTableColumns(PDO $pdo, string $dbName, string $refTable): array
    {
        $colStmt = $pdo->prepare("
            SELECT column_name AS col_name FROM information_schema.columns 
            WHERE table_schema = :db_name AND table_name = :ref_table
        ");
        $colStmt->execute(['db_name' => $dbName, 'ref_table' => $refTable]);
        $rows = $colStmt->fetchAll(PDO::FETCH_ASSOC);

        return array_map(function ($r) {
            $val = $r['col_name'] ?? $r['column_name'] ?? $r['COLUMN_NAME'] ?? (array_values($r)[0] ?? '');
            return strtolower((string) $val);
        }, $rows);
    }

    /**
     * Search for existing records matching search term or slug.
     */
    protected function searchReferencedRecords(
        PDO $pdo,
        string $refTable,
        string $refCol,
        array $refCols,
        string $rawSearch,
        string $slugVal
    ): array {
        $whereClauses = [];
        $params = [];

        if (in_array('name', $refCols, true)) {
            $whereClauses[] = "LOWER(`name`) = :name";
            $params['name'] = strtolower($rawSearch);
        }
        if (in_array('title', $refCols, true)) {
            $whereClauses[] = "LOWER(`title`) = :title";
            $params['title'] = strtolower($rawSearch);
        }
        if ($slugVal && in_array('slug', $refCols, true)) {
            $whereClauses[] = "`slug` = :slug";
            $params['slug'] = $slugVal;
        }

        if (empty($whereClauses)) {
            return [];
        }

        $selectCols = ["`{$refCol}`"];
        if (in_array('name', $refCols, true)) $selectCols[] = '`name`';
        if (in_array('title', $refCols, true)) $selectCols[] = '`title`';
        if (in_array('slug', $refCols, true)) $selectCols[] = '`slug`';

        $colSql = implode(', ', $selectCols);
        $sql = "SELECT {$colSql} FROM `{$refTable}` WHERE " . implode(' OR ', $whereClauses) . " LIMIT 10";

        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);

        return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }

    /**
     * Insert a new record into the referenced table and return its generated ID.
     */
    protected function createReferencedRecord(
        PDO $pdo,
        string $refTable,
        string $refCol,
        array $refCols,
        string $rawSearch,
        string $slugVal
    ): ?int {
        $insertCols = [];

        if (in_array('name', $refCols, true)) {
            $insertCols['name'] = $rawSearch;
        } elseif (in_array('title', $refCols, true)) {
            $insertCols['title'] = $rawSearch;
        }

        if (in_array('slug', $refCols, true)) {
            $insertCols['slug'] = $slugVal ?: Str::slug($rawSearch);
        }

        if (in_array('description', $refCols, true)) {
            $insertCols['description'] = "Automated entity for {$rawSearch}.";
        }

        if (in_array('created_at', $refCols, true)) {
            $insertCols['created_at'] = date('Y-m-d H:i:s');
        }
        if (in_array('updated_at', $refCols, true)) {
            $insertCols['updated_at'] = date('Y-m-d H:i:s');
        }

        if (empty($insertCols)) {
            return null;
        }

        $fields = array_keys($insertCols);
        $fSql = implode(', ', array_map(fn($f) => "`{$f}`", $fields));
        $pSql = implode(', ', array_map(fn($f) => ":{$f}", $fields));

        $insertSql = "INSERT INTO `{$refTable}` ({$fSql}) VALUES ({$pSql})";
        $this->safetyService->assertQueryIsSafe($insertSql);

        $stmt = $pdo->prepare($insertSql);
        $stmt->execute($insertCols);

        $newId = (int) $pdo->lastInsertId();
        return $newId > 0 ? $newId : null;
    }
}
