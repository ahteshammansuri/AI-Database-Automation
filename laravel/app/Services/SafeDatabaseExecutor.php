<?php

namespace App\Services;

use App\Models\DbConnection;
use Exception;
use PDO;
use PDOException;
use Illuminate\Support\Str;

class SafeDatabaseExecutor
{
    public function __construct(
        protected DatabaseSafetyService $safetyService,
        protected SchemaIntrospectionService $introspectionService
    ) {}

    /**
     * Safely insert an allowlisted, parameterized record into a target customer database.
     * Guaranteed atomic transaction with rollback, foreign key resolution, and relation auditing.
     */
    public function executeInsert(
        DbConnection $connection,
        string $tableName,
        array $payload,
        array $relationOptions = []
    ): array {
        // 1. Pre-flight security check
        $this->safetyService->validateConnectionTarget($connection->host, $connection->port);

        if ($this->safetyService->isTableSensitive($tableName)) {
            throw new Exception("Security violation: Table '{$tableName}' is classified as restricted and cannot receive automated writes.");
        }

        if (empty($payload)) {
            throw new Exception("Payload for table '{$tableName}' cannot be empty.");
        }

        $pdo = null;
        try {
            $pdo = $connection->createTargetPdo();
            $dbName = $connection->database_name;

            // 2. Discover columns and types for target table
            $colStmt = $pdo->prepare("
                SELECT column_name, data_type, column_type, is_nullable, column_default, column_key, character_maximum_length 
                FROM information_schema.columns 
                WHERE table_schema = :db_name AND table_name = :table_name
            ");
            $colStmt->execute(['db_name' => $dbName, 'table_name' => $tableName]);
            $rawCols = $colStmt->fetchAll();

            if (empty($rawCols)) {
                throw new Exception("Target table '{$tableName}' not found or has no accessible columns.");
            }

            // Begin transaction BEFORE any related entity resolutions or writes
            $pdo->beginTransaction();

            $relationResolutions = [];

            // 3. Sanitize and coerce payload according to discovered column types and constraints
            $filteredData = $this->sanitizeAndCoercePayload(
                $pdo,
                $dbName,
                $tableName,
                $rawCols,
                $payload,
                true,
                $relationOptions,
                $relationResolutions
            );

            if (empty($filteredData)) {
                throw new Exception("No valid columns found in payload matching schema for '{$tableName}'.");
            }

            // 4. Construct parameterized SQL statement
            $columns = array_keys($filteredData);
            $colSql = implode(', ', array_map(fn($c) => "`{$c}`", $columns));
            $paramSql = implode(', ', array_map(fn($c) => ":{$c}", $columns));

            $insertSql = "INSERT INTO `{$tableName}` ({$colSql}) VALUES ({$paramSql})";

            // 5. Hard AST keyword check
            $this->safetyService->assertQueryIsSafe($insertSql);

            // 6. Execute insert inside active transaction
            $stmt = $pdo->prepare($insertSql);

            foreach ($filteredData as $col => $val) {
                if ($val === null) {
                    $stmt->bindValue(":{$col}", null, PDO::PARAM_NULL);
                } elseif (is_int($val)) {
                    $stmt->bindValue(":{$col}", $val, PDO::PARAM_INT);
                } elseif (is_bool($val)) {
                    $stmt->bindValue(":{$col}", $val ? 1 : 0, PDO::PARAM_INT);
                } else {
                    $stmt->bindValue(":{$col}", (string) $val, PDO::PARAM_STR);
                }
            }

            $stmt->execute();
            $insertedId = $pdo->lastInsertId();

            // 7. Handle many-to-many associations (e.g. post_tags) if present in payload or options
            $this->handleAssociationTables(
                $pdo,
                $dbName,
                $tableName,
                (int) $insertedId,
                $payload,
                $relationResolutions
            );

            $pdo->commit();

            return [
                'success' => true,
                'operation' => 'INSERT',
                'table' => $tableName,
                'record_id' => $insertedId ?: 'inserted',
                'columns_written' => $columns,
                'relation_resolutions' => $relationResolutions,
            ];
        } catch (Exception $e) {
            if ($pdo && $pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw new Exception("Target database write failed: " . $e->getMessage());
        } finally {
            $pdo = null; // Ephemeral release
        }
    }

    /**
     * Coerce payload values to match physical MySQL schema types and prevent 1366 / 1292 SQL errors.
     */
    protected function sanitizeAndCoercePayload(
        PDO $pdo,
        string $dbName,
        string $tableName,
        array $rawCols,
        array $payload,
        bool $isInsert = true,
        array $relationOptions = [],
        array &$relationResolutions = []
    ): array {
        // Index column metadata by lowercase name
        $cols = [];
        foreach ($rawCols as $rc) {
            $c = array_change_key_case($rc, CASE_LOWER);
            $cols[$c['column_name']] = $c;
        }

        // Fetch foreign key references for this table
        $fkMap = [];
        try {
            $fkStmt = $pdo->prepare("
                SELECT column_name, referenced_table_name, referenced_column_name
                FROM information_schema.key_column_usage
                WHERE table_schema = :db_name 
                  AND table_name = :table_name 
                  AND referenced_table_name IS NOT NULL
            ");
            $fkStmt->execute(['db_name' => $dbName, 'table_name' => $tableName]);
            foreach ($fkStmt->fetchAll() as $fk) {
                $f = array_change_key_case($fk, CASE_LOWER);
                $fkMap[$f['column_name']] = [
                    'table' => $f['referenced_table_name'],
                    'column' => $f['referenced_column_name'],
                ];
            }
        } catch (Exception) {
            // Non-fatal if foreign key introspection is restricted
        }

        $sanitized = [];

        foreach ($payload as $key => $val) {
            if (!isset($cols[$key])) {
                continue;
            }

            $colMeta = $cols[$key];
            $dataType = strtolower($colMeta['data_type'] ?? 'varchar');
            $isNullable = strtoupper($colMeta['is_nullable'] ?? 'YES') === 'YES';
            $default = $colMeta['column_default'] ?? null;
            $maxLen = isset($colMeta['character_maximum_length']) ? (int) $colMeta['character_maximum_length'] : null;

            // Never populate soft-delete timestamp on INSERT
            if ($isInsert && $key === 'deleted_at') {
                $sanitized[$key] = null;
                continue;
            }

            // 1. Integer / Numeric fields (handles foreign keys & IDs)
            if (in_array($dataType, ['int', 'integer', 'bigint', 'smallint', 'tinyint', 'mediumint'], true)) {
                $refTable = $fkMap[$key]['table'] ?? ($relationOptions[$key]['referenced_table'] ?? null);
                $refCol = $fkMap[$key]['column'] ?? ($relationOptions[$key]['lookup_column'] ?? 'id');

                // If not found in FK map, infer by convention for _id columns (e.g. category_id -> categories)
                if (!$refTable && str_ends_with($key, '_id')) {
                    $base = substr($key, 0, -3);
                    $candidates = [$base . 's', $base . 'es', str_ends_with($base, 'y') ? substr($base, 0, -1) . 'ies' : $base . 's', $base];
                    foreach ($candidates as $cand) {
                        try {
                            $checkStmt = $pdo->prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = :db AND table_name = :tbl LIMIT 1");
                            $checkStmt->execute(['db' => $dbName, 'tbl' => $cand]);
                            if ($checkStmt->fetch()) {
                                $refTable = $cand;
                                break;
                            }
                        } catch (\Throwable) {}
                    }
                }

                if ($refTable) {
                    // Check if lookup value or options provides a semantic category string
                    $semanticVal = $val;
                    if (is_numeric($semanticVal) && (int)$semanticVal <= 1) {
                        if (!empty($relationOptions[$key]['fixed_value']) && !is_numeric($relationOptions[$key]['fixed_value'])) {
                            $semanticVal = $relationOptions[$key]['fixed_value'];
                        } elseif (!empty($payload['category']) && is_string($payload['category'])) {
                            $semanticVal = $payload['category'];
                        } elseif (!empty($payload['category_name']) && is_string($payload['category_name'])) {
                            $semanticVal = $payload['category_name'];
                        }
                    }

                    // Intelligent relational resolution
                    $resolvedId = $this->resolveRelationalRecord(
                        $pdo,
                        $dbName,
                        $refTable,
                        $refCol,
                        $semanticVal,
                        $relationOptions[$key] ?? [],
                        $relationResolutions
                    );

                    $sanitized[$key] = $resolvedId ?? ($isNullable ? null : 1);
                } elseif (is_numeric($val)) {
                    $sanitized[$key] = (int) $val;
                } elseif ($isNullable) {
                    $sanitized[$key] = null;
                } elseif ($default !== null && is_numeric($default)) {
                    $sanitized[$key] = (int) $default;
                } else {
                    $sanitized[$key] = 1;
                }
                continue;
            }

            // 2. Decimal / Float / Double
            if (in_array($dataType, ['decimal', 'float', 'double', 'numeric'], true)) {
                if (is_numeric($val)) {
                    $sanitized[$key] = (float) $val;
                } else {
                    $sanitized[$key] = $isNullable ? null : (is_numeric($default) ? (float) $default : 0.0);
                }
                continue;
            }

            // 3. Datetime / Date / Timestamp
            if (in_array($dataType, ['datetime', 'timestamp', 'date', 'time'], true)) {
                if (!empty($val) && !str_starts_with(strtolower((string) $val), 'generated')) {
                    $ts = strtotime((string) $val);
                    if ($ts !== false) {
                        $sanitized[$key] = date($dataType === 'date' ? 'Y-m-d' : 'Y-m-d H:i:s', $ts);
                        continue;
                    }
                }
                $sanitized[$key] = $isNullable ? null : date($dataType === 'date' ? 'Y-m-d' : 'Y-m-d H:i:s');
                continue;
            }

            // 4. Strings / Text / Varchar
            if (in_array($dataType, ['varchar', 'char', 'text', 'mediumtext', 'longtext', 'tinytext'], true)) {
                $strVal = is_array($val) || is_object($val) ? json_encode($val) : (string) $val;

                // Handle image fields that received placeholder text
                if (preg_match('/(banner|img|image|thumbnail|cover|photo)/i', $key)) {
                    if (empty($strVal) || str_starts_with(strtolower($strVal), 'generated')) {
                        $strVal = str_contains($key, 'banner')
                            ? 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=1200&auto=format&fit=crop&q=80'
                            : (str_contains($key, 'meta')
                                ? 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=800&auto=format&fit=crop&q=80'
                                : 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=600&auto=format&fit=crop&q=80');
                    }
                }

                // Enforce slug uniqueness on INSERT to prevent 1062 duplicate key violations
                if ($isInsert && ($key === 'slug' || str_ends_with($key, '_slug') || str_ends_with($key, 'slug')) && !empty($strVal)) {
                    $baseSlug = $strVal;
                    $uniqueSlug = $baseSlug;
                    $attempt = 1;
                    while ($attempt <= 10) {
                        try {
                            $checkStmt = $pdo->prepare("SELECT 1 FROM `{$tableName}` WHERE `{$key}` = :val LIMIT 1");
                            $checkStmt->execute(['val' => $uniqueSlug]);
                            if (!$checkStmt->fetch()) {
                                break;
                            }
                        } catch (Exception) {
                            break;
                        }
                        $suffix = '-' . rand(100, 9999);
                        if ($maxLen !== null && strlen($baseSlug . $suffix) > $maxLen) {
                            $uniqueSlug = substr($baseSlug, 0, $maxLen - strlen($suffix)) . $suffix;
                        } else {
                            $uniqueSlug = $baseSlug . $suffix;
                        }
                        $attempt++;
                    }
                    $strVal = $uniqueSlug;
                }

                // Truncate to max column length if defined
                if ($maxLen !== null && strlen($strVal) > $maxLen) {
                    $strVal = substr($strVal, 0, $maxLen);
                }

                $sanitized[$key] = $strVal;
                continue;
            }

            // 5. Enum fields
            if ($dataType === 'enum') {
                $sanitized[$key] = (string) $val;
                continue;
            }

            // Default fallback
            $sanitized[$key] = is_array($val) || is_object($val) ? json_encode($val) : $val;
        }

        return $sanitized;
    }

    /**
     * Intelligent relational record resolution:
     * - Searches referenced table by primary key, name, or slug.
     * - If missing and creation policy permits (and target is not restricted), creates related entity atomically.
     * - Handles concurrent unique key conflicts by re-reading.
     */
    public function resolveRelationalRecord(
        PDO $pdo,
        string $dbName,
        string $refTable,
        string $refCol,
        mixed $lookupValue,
        array $options = [],
        array &$relationResolutions = []
    ): ?int {
        $policy = $options['creation_policy'] ?? 'CREATE_IF_MISSING';
        $isSensitive = $this->safetyService->isTableSensitive($refTable);

        // Security invariant: NEVER auto-create in sensitive tables (users, accounts, payments, logs)
        if ($isSensitive) {
            $policy = 'REUSE_EXISTING_ONLY';
        }

        // Branch 1: Numeric ID provided
        if (is_numeric($lookupValue) && (int) $lookupValue > 0) {
            $idVal = (int) $lookupValue;
            $stmt = $pdo->prepare("SELECT `{$refCol}` FROM `{$refTable}` WHERE `{$refCol}` = :id LIMIT 1");
            $stmt->execute(['id' => $idVal]);
            if ($row = $stmt->fetch()) {
                $relationResolutions[] = [
                    'table' => $refTable,
                    'action' => 'REUSED_BY_ID',
                    'lookup' => $idVal,
                    'resolved_id' => $idVal,
                    'details' => "Reused existing record ID #{$idVal} in {$refTable}.",
                ];
                return $idVal;
            }
        }

        // Branch 2: Semantic name / string provided (e.g. "Cloud Architecture", "Cars", "Technology")
        $rawSearch = is_string($lookupValue) ? trim($lookupValue) : null;
        if (empty($rawSearch)) {
            if (!empty($options['default_id']) && is_numeric($options['default_id'])) {
                return (int) $options['default_id'];
            }
            return null;
        }

        $slugVal = Str::slug($rawSearch);

        // Discover columns in referenced table
        $colStmt = $pdo->prepare("
            SELECT column_name AS col_name FROM information_schema.columns 
            WHERE table_schema = :db_name AND table_name = :ref_table
        ");
        $colStmt->execute(['db_name' => $dbName, 'ref_table' => $refTable]);
        $rows = $colStmt->fetchAll(\PDO::FETCH_ASSOC);
        $refCols = array_map(function ($r) {
            $val = $r['col_name'] ?? $r['column_name'] ?? $r['COLUMN_NAME'] ?? (array_values($r)[0] ?? '');
            return strtolower((string) $val);
        }, $rows);

        // Check if matching row exists by slug or name
        $whereClauses = [];
        $params = [];

        if (in_array('slug', $refCols, true)) {
            $whereClauses[] = "`slug` = :slug";
            $params['slug'] = $slugVal;
        }
        if (in_array('name', $refCols, true)) {
            $whereClauses[] = "`name` = :name";
            $params['name'] = $rawSearch;
        }
        if (in_array('title', $refCols, true)) {
            $whereClauses[] = "`title` = :title";
            $params['title'] = $rawSearch;
        }

        if (!empty($whereClauses)) {
            $sql = "SELECT `{$refCol}` FROM `{$refTable}` WHERE " . implode(' OR ', $whereClauses) . " LIMIT 1";
            $findStmt = $pdo->prepare($sql);
            $findStmt->execute($params);
            if ($row = $findStmt->fetch()) {
                $foundId = (int) $row[$refCol];
                $relationResolutions[] = [
                    'table' => $refTable,
                    'action' => 'MATCHED_EXISTING',
                    'lookup' => $rawSearch,
                    'resolved_id' => $foundId,
                    'details' => "Found existing category/taxonomy '{$rawSearch}' (ID #{$foundId}) in {$refTable}.",
                ];
                return $foundId;
            }
        }

        // Branch 3: Not found - check creation policy
        if ($policy === 'CREATE_IF_MISSING' && !$isSensitive) {
            try {
                $insertCols = [];

                if (in_array('name', $refCols, true)) {
                    $insertCols['name'] = $rawSearch;
                }
                if (in_array('slug', $refCols, true)) {
                    $insertCols['slug'] = $slugVal;
                }
                if (in_array('description', $refCols, true)) {
                    $insertCols['description'] = "Automated category for {$rawSearch}.";
                }

                if (!empty($insertCols)) {
                    $colNames = implode(', ', array_map(fn($c) => "`{$c}`", array_keys($insertCols)));
                    $placeholders = implode(', ', array_map(fn($c) => ":{$c}", array_keys($insertCols)));
                    $insSql = "INSERT INTO `{$refTable}` ({$colNames}) VALUES ({$placeholders})";

                    $insStmt = $pdo->prepare($insSql);
                    foreach ($insertCols as $k => $v) {
                        $insStmt->bindValue(":{$k}", $v);
                    }
                    $insStmt->execute();
                    $newId = (int) $pdo->lastInsertId();

                    $relationResolutions[] = [
                        'table' => $refTable,
                        'action' => 'CREATED_NEW',
                        'lookup' => $rawSearch,
                        'resolved_id' => $newId,
                        'details' => "Dynamically created missing category/taxonomy '{$rawSearch}' (new ID #{$newId}) in {$refTable}.",
                    ];
                    return $newId;
                }
            } catch (PDOException $e) {
                // If a concurrent insert occurred causing duplicate key (23000), re-read existing record
                if ($e->getCode() == 23000 || str_contains($e->getMessage(), 'Duplicate entry')) {
                    if (!empty($whereClauses)) {
                        $findStmt = $pdo->prepare("SELECT `{$refCol}` FROM `{$refTable}` WHERE " . implode(' OR ', $whereClauses) . " LIMIT 1");
                        $findStmt->execute($params);
                        if ($row = $findStmt->fetch()) {
                            $foundId = (int) $row[$refCol];
                            $relationResolutions[] = [
                                'table' => $refTable,
                                'action' => 'CONCURRENCY_REUSED',
                                'lookup' => $rawSearch,
                                'resolved_id' => $foundId,
                                'details' => "Resolved duplicate race condition: reused existing record ID #{$foundId}.",
                            ];
                            return $foundId;
                        }
                    }
                }
                throw new Exception("Failed to create missing related record in '{$refTable}': " . $e->getMessage());
            }
        }

        // Branch 4: Entity not found and creation not permitted - fail safely without arbitrary guessing
        throw new Exception("Relational resolution error: No matching record found for '{$rawSearch}' in referenced table '{$refTable}', and creation is disallowed (Policy: {$policy}). Please select an existing entity or enable permitted creation.");
    }

    /**
     * Handle association pivot tables (e.g. post_tags linking posts to tags).
     */
    protected function handleAssociationTables(
        PDO $pdo,
        string $dbName,
        string $tableName,
        int $recordId,
        array $payload,
        array &$relationResolutions
    ): void {
        // Example: linking tags for posts
        if ($tableName === 'posts' && (!empty($payload['tags']) || !empty($payload['tag_names']))) {
            $tagList = $payload['tags'] ?? $payload['tag_names'];
            if (is_string($tagList)) {
                $tagList = array_map('trim', explode(',', $tagList));
            }
            if (!is_array($tagList)) {
                return;
            }

            foreach ($tagList as $tagItem) {
                $tagName = is_array($tagItem) ? ($tagItem['name'] ?? null) : (string) $tagItem;
                if (empty($tagName)) continue;

                // Resolve tag ID in tags table
                $tagId = $this->resolveRelationalRecord(
                    $pdo,
                    $dbName,
                    'tags',
                    'id',
                    $tagName,
                    ['creation_policy' => 'CREATE_IF_MISSING'],
                    $relationResolutions
                );

                if ($tagId) {
                    try {
                        // Check if post_tags pivot table exists
                        $ptCheck = $pdo->prepare("
                            SELECT table_name FROM information_schema.tables 
                            WHERE table_schema = :db_name AND table_name = 'post_tags'
                        ");
                        $ptCheck->execute(['db_name' => $dbName]);
                        if ($ptCheck->fetch()) {
                            // Insert association record with INSERT IGNORE to prevent duplicate links
                            $insPt = $pdo->prepare("
                                INSERT IGNORE INTO `post_tags` (`post_id`, `tag_id`) 
                                VALUES (:post_id, :tag_id)
                            ");
                            $insPt->execute([
                                'post_id' => $recordId,
                                'tag_id' => $tagId,
                            ]);

                            $relationResolutions[] = [
                                'table' => 'post_tags',
                                'action' => 'PIVOT_LINKED',
                                'lookup' => "post #{$recordId} -> tag #{$tagId} ('{$tagName}')",
                                'resolved_id' => $tagId,
                                'details' => "Linked association post #{$recordId} to tag '{$tagName}' in post_tags.",
                            ];
                        }
                    } catch (Exception) {
                        // Non-fatal pivot linking
                    }
                }
            }
        }
    }

    /**
     * Safely update an allowlisted, parameterized record on an explicitly identified unique key.
     */
    public function executeScopedUpdate(
        DbConnection $connection,
        string $tableName,
        string $primaryKeyColumn,
        mixed $primaryKeyValue,
        array $payload
    ): array {
        $this->safetyService->validateConnectionTarget($connection->host, $connection->port);

        if ($this->safetyService->isTableSensitive($tableName)) {
            throw new Exception("Security violation: Table '{$tableName}' is classified as restricted.");
        }

        if (empty($payload)) {
            throw new Exception("Update payload cannot be empty.");
        }

        $pdo = null;
        try {
            $pdo = $connection->createTargetPdo();

            // Check columns
            $colStmt = $pdo->prepare("
                SELECT column_name FROM information_schema.columns 
                WHERE table_schema = :db_name AND table_name = :table_name
            ");
            $colStmt->execute(['db_name' => $connection->database_name, 'table_name' => $tableName]);
            $rawCols = $colStmt->fetchAll();
            $validColNames = [];
            foreach ($rawCols as $rc) {
                $c = array_change_key_case($rc, CASE_LOWER);
                $validColNames[] = $c['column_name'];
            }

            if (!in_array($primaryKeyColumn, $validColNames, true)) {
                throw new Exception("Invalid primary key column '{$primaryKeyColumn}' for table '{$tableName}'.");
            }

            $filteredData = [];
            foreach ($payload as $key => $val) {
                if (in_array($key, $validColNames, true) && $key !== $primaryKeyColumn) {
                    $filteredData[$key] = $val;
                }
            }

            if (empty($filteredData)) {
                throw new Exception("No valid columns to update on '{$tableName}'.");
            }

            $setClauses = [];
            foreach (array_keys($filteredData) as $col) {
                $setClauses[] = "`{$col}` = :set_{$col}";
            }
            $setSql = implode(', ', $setClauses);

            $updateSql = "UPDATE `{$tableName}` SET {$setSql} WHERE `{$primaryKeyColumn}` = :pk_val";

            $this->safetyService->assertQueryIsSafe($updateSql);

            $pdo->beginTransaction();
            $stmt = $pdo->prepare($updateSql);

            foreach ($filteredData as $col => $val) {
                if (is_array($val) || is_object($val)) {
                    $val = json_encode($val);
                }
                $stmt->bindValue(":set_{$col}", $val);
            }
            $stmt->bindValue(':pk_val', $primaryKeyValue);

            $stmt->execute();
            $rowsAffected = $stmt->rowCount();
            $pdo->commit();

            return [
                'success' => true,
                'operation' => 'UPDATE',
                'table' => $tableName,
                'record_id' => (string) $primaryKeyValue,
                'rows_affected' => $rowsAffected,
            ];
        } catch (Exception $e) {
            if ($pdo && $pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw new Exception("Target database update failed: " . $e->getMessage());
        } finally {
            $pdo = null;
        }
    }
}
