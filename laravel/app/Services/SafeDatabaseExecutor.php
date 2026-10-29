<?php

namespace App\Services;

use App\Models\DbConnection;
use App\Models\IdempotencyKey;
use App\Services\Automation\ParentRowBuilder;
use App\Services\Automation\PendingParentId;
use App\Services\Automation\TargetTableInspector;
use App\Services\Data\DataAccessPolicy;
use Exception;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use PDO;
use PDOException;

class SafeDatabaseExecutor
{
    /** Marker returned by coerceValue() when a column should be left out of the INSERT. */
    private const OMIT = "\0__omit__";

    public function __construct(
        protected DatabaseSafetyService $safetyService,
        protected SchemaIntrospectionService $introspectionService,
        protected ?TargetTableInspector $inspector = null,
        protected ?ParentRowBuilder $parentRowBuilder = null,
        protected ?DataAccessPolicy $accessPolicy = null,
    ) {
        $this->inspector ??= new TargetTableInspector();
        $this->parentRowBuilder ??= new ParentRowBuilder();
        $this->accessPolicy ??= new DataAccessPolicy();
    }

    /**
     * Insert one row into a customer table inside a transaction. Parent records referenced by
     * foreign-key columns are matched (or created, only where the column's relation options allow it)
     * in the same transaction first, so the child row always points at a real parent and nothing is
     * left behind if anything fails.
     *
     * $relationOptions: per-column arrays {referenced_table?, referenced_column?, creation_policy|policy,
     * description?}; plus an optional top-level 'idempotency_key' string.
     */
    public function executeInsert(
        DbConnection $connection,
        string $tableName,
        array $payload,
        array $relationOptions = []
    ): array {
        $this->preflight($connection, $tableName);
        if (empty($payload)) {
            throw new Exception("Payload for table '{$tableName}' cannot be empty.");
        }

        $idempotencyKey = $relationOptions['idempotency_key'] ?? $payload['_idempotency_key'] ?? null;
        unset($payload['_idempotency_key']);

        if ($idempotencyKey && Schema::hasTable('idempotency_keys')) {
            $existing = IdempotencyKey::where('idempotency_key', $idempotencyKey)
                ->where('status', 'COMMITTED')
                ->first();
            if ($existing) {
                return [
                    'success' => true,
                    'operation' => 'INSERT',
                    'table' => $tableName,
                    'record_id' => $existing->target_record_id,
                    'columns_written' => [],
                    'relation_resolutions' => [],
                    'idempotent_replayed' => true,
                ];
            }

            IdempotencyKey::updateOrCreate(
                ['idempotency_key' => $idempotencyKey],
                ['user_id' => $connection->user_id, 'status' => 'IN_PROGRESS']
            );
        }

        $pdo = null;
        try {
            $pdo = $connection->createTargetPdo();
            $info = $this->inspector->describe($pdo, $connection->database_name, $tableName);
            if ($info === null) {
                throw new Exception("Target table '{$tableName}' not found or has no accessible columns.");
            }

            $pdo->beginTransaction();

            $resolutions = [];
            $issues = [];
            $steps = [];
            $row = $this->prepareRow($pdo, $connection, $info, $payload, $relationOptions, false, $resolutions, $issues, $steps);

            $errors = array_values(array_filter($issues, fn($i) => $i['level'] === 'error'));
            if (!empty($errors)) {
                throw new Exception(implode(' ', array_map(fn($e) => $e['message'], $errors)));
            }
            if (empty($row)) {
                throw new Exception("No valid columns found in payload matching schema for '{$tableName}'.");
            }

            $insertedId = $this->insertRow($pdo, $tableName, $row, $info);

            // Many-to-many associations (e.g. post_tags) when present in the payload
            $this->handleAssociationTables($pdo, $connection, $tableName, (int) $insertedId, $payload, $resolutions);

            $pdo->commit();

            if (!empty($idempotencyKey) && Schema::hasTable('idempotency_keys')) {
                IdempotencyKey::where('idempotency_key', $idempotencyKey)->update([
                    'target_record_id' => (string) $insertedId,
                    'status' => 'COMMITTED',
                ]);
            }

            return [
                'success' => true,
                'operation' => 'INSERT',
                'table' => $tableName,
                'record_id' => $insertedId ?: 'inserted',
                'columns_written' => array_keys($row),
                'written_values' => $this->displayRow($row),
                'relation_resolutions' => $resolutions,
                'warnings' => array_values(array_filter($issues, fn($i) => $i['level'] !== 'error')),
            ];
        } catch (Exception $e) {
            if ($pdo && $pdo->inTransaction()) {
                $pdo->rollBack();
            }
            if (!empty($idempotencyKey) && Schema::hasTable('idempotency_keys')) {
                IdempotencyKey::where('idempotency_key', $idempotencyKey)->update(['status' => 'FAILED']);
            }
            throw new Exception("Target database write failed: " . $e->getMessage());
        } finally {
            $pdo = null; // Ephemeral release
        }
    }

    /**
     * Dry run of executeInsert(): validates the payload against the live schema and resolves parent
     * records with SELECTs only, inside a READ ONLY transaction that is always rolled back. Returns the
     * exact row that would be written, the ordered write steps (parent creations first), relation
     * decisions and any errors/warnings. Never writes.
     */
    public function planInsert(
        DbConnection $connection,
        string $tableName,
        array $payload,
        array $relationOptions = []
    ): array {
        $this->preflight($connection, $tableName);
        unset($payload['_idempotency_key']);

        $pdo = null;
        try {
            $pdo = $connection->createTargetPdo();
            $info = $this->inspector->describe($pdo, $connection->database_name, $tableName);
            if ($info === null) {
                throw new Exception("Target table '{$tableName}' not found or has no accessible columns.");
            }

            try {
                $pdo->exec('START TRANSACTION READ ONLY');
            } catch (\Throwable) {
                $pdo->beginTransaction();
            }

            $resolutions = [];
            $issues = [];
            $steps = [];
            $row = $this->prepareRow($pdo, $connection, $info, $payload, $relationOptions, true, $resolutions, $issues, $steps);

            $columns = [];
            foreach ($info['columns'] as $name => $c) {
                if ($c['auto_increment']) {
                    continue;
                }
                $columns[] = [
                    'column' => $name,
                    'type' => $c['column_type'],
                    'kind' => $c['kind'],
                    'nullable' => $c['nullable'],
                    'required' => $c['required'],
                    'written' => array_key_exists($name, $row),
                    'value' => array_key_exists($name, $row) ? $this->displayValue($row[$name]) : null,
                    'note' => array_key_exists($name, $row) ? null : ($c['has_default'] ? 'database default' : ($c['nullable'] ? 'left empty (NULL)' : null)),
                ];
            }

            return [
                'table' => $tableName,
                'row' => $this->displayRow($row),
                'columns' => $columns,
                'steps' => $steps,
                'relations' => $resolutions,
                'issues' => $issues,
                'can_publish' => empty(array_filter($issues, fn($i) => $i['level'] === 'error')),
            ];
        } finally {
            if ($pdo) {
                try {
                    $pdo->exec('ROLLBACK');
                } catch (\Throwable) {
                }
            }
            $pdo = null;
        }
    }

    // ------------------------------------------------------------------
    // Row preparation (shared by executeInsert and planInsert)
    // ------------------------------------------------------------------

    private function preflight(DbConnection $connection, string $tableName): void
    {
        $this->safetyService->validateConnectionTarget($connection->host, $connection->port);

        if (!in_array(strtolower((string) ($connection->db_type ?: 'mysql')), ['mysql', 'mariadb'], true)) {
            throw new Exception("Automations can currently write to MySQL connections only; '{$connection->name}' is " . ($connection->db_type ?? 'unknown') . '.');
        }
        if (!preg_match('/^[A-Za-z0-9_$\\-]+$/', $tableName)) {
            throw new Exception("Invalid table name '{$tableName}'.");
        }
        if ($this->safetyService->isTableSensitive($tableName)) {
            throw new Exception("Security violation: Table '{$tableName}' is classified as restricted and cannot receive automated writes.");
        }
        $class = $this->accessPolicy->getTableClass($connection, $tableName);
        if ($class === 'blocked' || $class === 'read_only') {
            throw new Exception("Table '{$tableName}' is protected ({$class}) and cannot receive automated writes.");
        }
    }

    /**
     * Turn a payload into the exact column => value row for the INSERT. Foreign keys are resolved
     * to real parent ids (creating parents only where allowed); values are coerced and validated
     * against the column types; required columns that nothing fills are reported as errors.
     */
    private function prepareRow(
        PDO $pdo,
        DbConnection $connection,
        array $info,
        array $payload,
        array $relationOptions,
        bool $dryRun,
        array &$resolutions,
        array &$issues,
        array &$steps
    ): array {
        $table = $info['table'];
        $cols = $info['columns'];
        $row = [];

        foreach ($payload as $key => $val) {
            if (!is_string($key) || !isset($cols[$key])) {
                continue; // not a column of this table (e.g. quality metrics)
            }
            $c = $cols[$key];

            if ($c['is_secret']) {
                $issues[] = ['level' => 'error', 'column' => $key, 'message' => "`{$key}` holds secrets and is never written by automations."];
                continue;
            }
            if ($c['auto_increment'] || $c['generated']) {
                continue;
            }
            if ($key === 'deleted_at') {
                if ($c['nullable']) {
                    $row[$key] = null; // never soft-delete a brand-new row
                }
                continue;
            }

            $opts = is_array($relationOptions[$key] ?? null) ? $relationOptions[$key] : [];
            if ($c['foreign_key'] || !empty($opts['referenced_table'])) {
                $res = $this->resolveForeignKey($pdo, $connection, $key, $c, $val, $opts, $dryRun, $steps);
                if ($res['status'] === 'error') {
                    $issues[] = ['level' => 'error', 'column' => $key, 'message' => $res['details']];
                    continue;
                }
                if ($res['status'] !== 'null') {
                    $resolutions[] = $res;
                }
                if ($res['status'] === 'null') {
                    $row[$key] = null;
                } elseif ($res['resolved_id'] !== null) {
                    $row[$key] = $res['resolved_id'];
                } else {
                    // Dry run of a parent that will be created: placeholder for display only.
                    $row[$key] = new PendingParentId($res['table'], (string) $res['lookup']);
                }
                continue;
            }

            [$value, $colIssues] = $this->coerceValue($c, $val);
            foreach ($colIssues as $ci) {
                $issues[] = $ci + ['column' => $key];
            }
            if ($value === self::OMIT) {
                continue;
            }

            if ($c['kind'] === 'slug' && is_string($value) && $value !== '') {
                $value = $this->uniqueValue($pdo, $table, $key, Str::slug($value) ?: $value, $c['max_length'], $dryRun, $issues);
            } elseif ($c['is_unique'] && !$c['is_primary'] && is_string($value) && $value !== '' && $this->valueExists($pdo, $table, $key, $value)) {
                $issues[] = [
                    'level' => $dryRun ? 'warning' : 'error',
                    'column' => $key,
                    'message' => "`{$key}` must be unique and '" . Str::limit($value, 60) . "' already exists in `{$table}`.",
                ];
            }

            $row[$key] = $value;
        }

        foreach ($cols as $name => $c) {
            if ($c['required'] && !array_key_exists($name, $row) && !$c['is_secret']) {
                $alreadyReported = (bool) array_filter($issues, fn($i) => ($i['column'] ?? null) === $name && $i['level'] === 'error');
                if (!$alreadyReported) {
                    $issues[] = ['level' => 'error', 'column' => $name, 'message' => "`{$name}` is required in `{$table}` (NOT NULL, no default) but this automation does not fill it."];
                }
            }
        }

        $steps[] = [
            'order' => count($steps) + 1,
            'action' => 'INSERT',
            'table' => $table,
            'description' => 'Insert the new row into `' . $table . '`.',
            'values' => $this->displayRow($row),
        ];

        return $row;
    }

    /**
     * Coerce a payload value to the column's type. Returns [value|OMIT, issues].
     */
    private function coerceValue(array $c, mixed $val): array
    {
        $issues = [];
        $name = $c['name'];
        $type = $c['data_type'];

        if ($val === null || (is_string($val) && trim($val) === '' && !in_array($c['kind'], ['text', 'body', 'summary', 'title', 'keywords', 'meta_title', 'meta_description', 'url', 'image', 'contact'], true))) {
            if ($c['nullable']) {
                return [null, []];
            }
            if ($c['has_default']) {
                return [self::OMIT, []];
            }
            if (is_string($val) && in_array($type, ['varchar', 'char', 'text', 'tinytext', 'mediumtext', 'longtext'], true)) {
                return ['', []];
            }
            return [self::OMIT, [['level' => 'error', 'message' => "`{$name}` is required but has no value."]]];
        }

        // Integers (non-FK) and booleans
        if (in_array($type, ['int', 'integer', 'bigint', 'smallint', 'mediumint', 'tinyint', 'bit'], true)) {
            if (is_bool($val)) {
                return [$val ? 1 : 0, []];
            }
            if (is_string($val) && in_array(strtolower(trim($val)), ['true', 'yes', 'on', 'active', 'published'], true)) {
                return [1, []];
            }
            if (is_string($val) && in_array(strtolower(trim($val)), ['false', 'no', 'off', 'inactive', 'draft'], true)) {
                return [0, []];
            }
            if (is_numeric($val)) {
                return [(int) $val, []];
            }
            if ($c['nullable']) {
                return [null, [['level' => 'warning', 'message' => "`{$name}` expected a whole number; left empty."]]];
            }
            return [self::OMIT, [['level' => 'error', 'message' => "`{$name}` must be a whole number (got '" . Str::limit((string) json_encode($val), 40) . "')."]]];
        }

        if (in_array($type, ['decimal', 'float', 'double', 'numeric'], true)) {
            if (is_numeric($val)) {
                return [(float) $val, []];
            }
            if ($c['nullable']) {
                return [null, [['level' => 'warning', 'message' => "`{$name}` expected a number; left empty."]]];
            }
            return [self::OMIT, [['level' => 'error', 'message' => "`{$name}` must be a number."]]];
        }

        if (in_array($type, ['datetime', 'timestamp', 'date', 'time', 'year'], true)) {
            $ts = is_numeric($val) ? (int) $val : strtotime((string) $val);
            if ($ts !== false && $ts > 0) {
                $fmt = match ($type) {
                    'date' => 'Y-m-d',
                    'time' => 'H:i:s',
                    'year' => 'Y',
                    default => 'Y-m-d H:i:s',
                };
                return [date($fmt, $ts), []];
            }
            if ($c['nullable']) {
                return [null, [['level' => 'warning', 'message' => "`{$name}` was not a valid date; left empty."]]];
            }
            return [self::OMIT, [['level' => 'error', 'message' => "`{$name}` must be a valid date/time."]]];
        }

        if ($type === 'enum') {
            foreach ($c['enum_values'] as $opt) {
                if (strcasecmp((string) $opt, trim((string) $val)) === 0) {
                    return [(string) $opt, []];
                }
            }
            return [self::OMIT, [['level' => 'error', 'message' => "`{$name}` must be one of: " . implode(', ', $c['enum_values']) . " (got '" . Str::limit((string) $val, 40) . "')."]]];
        }

        if ($type === 'json') {
            if (is_array($val) || is_object($val)) {
                return [json_encode($val, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), []];
            }
            json_decode((string) $val);
            return [json_last_error() === JSON_ERROR_NONE ? (string) $val : json_encode((string) $val), []];
        }

        // Strings
        $str = is_array($val) || is_object($val) ? json_encode($val, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : (string) $val;
        $str = str_replace("\0", '', $str);
        $max = $c['max_length'];
        if ($max !== null && mb_strlen($str) > $max) {
            $cut = mb_substr($str, 0, $max);
            if (in_array($c['kind'], ['title', 'summary', 'meta_title', 'meta_description', 'text', 'keywords'], true)) {
                $space = mb_strrpos($cut, ' ');
                if ($space !== false && $space > $max * 0.6) {
                    $cut = rtrim(mb_substr($cut, 0, $space), " ,.;:-");
                }
            }
            $issues[] = ['level' => 'warning', 'message' => "`{$name}` was shortened from " . mb_strlen($str) . " to " . mb_strlen($cut) . " characters to fit the column."];
            $str = $cut;
        }
        return [$str, $issues];
    }

    /**
     * Resolve a foreign-key value to a real parent id.
     *  - integer / numeric string: must exist in the parent table (no fallback to another id);
     *  - text label: matched case-insensitively against the parent's name/title (or slug);
     *  - no match: create the parent only when the relation options say CREATE_IF_MISSING and the
     *    parent table is not protected; otherwise fail with a clear message.
     */
    private function resolveForeignKey(
        PDO $pdo,
        DbConnection $connection,
        string $column,
        array $c,
        mixed $val,
        array $opts,
        bool $dryRun,
        array &$steps
    ): array {
        $refTable = $c['foreign_key']['table'] ?? $opts['referenced_table'];
        $refCol = $c['foreign_key']['column'] ?? ($opts['referenced_column'] ?? 'id');
        $policy = strtoupper((string) ($opts['creation_policy'] ?? $opts['policy'] ?? 'REUSE_EXISTING_ONLY'));
        $base = ['column' => $column, 'table' => $refTable, 'lookup' => $val, 'resolved_id' => null];

        if (!preg_match('/^[A-Za-z0-9_$\\-]+$/', (string) $refTable) || !preg_match('/^[A-Za-z0-9_$\\-]+$/', (string) $refCol)) {
            return $base + ['status' => 'error', 'action' => 'FAILED', 'details' => "Invalid relation target for `{$column}`."];
        }

        if (is_array($val)) {
            $val = $val['id'] ?? $val['label'] ?? $val['name'] ?? $val['title'] ?? null;
        }
        if ($val === null || (is_string($val) && trim($val) === '')) {
            if ($c['nullable']) {
                return $base + ['status' => 'null', 'action' => 'LEFT_EMPTY', 'details' => "`{$column}` left empty."];
            }
            return $base + ['status' => 'error', 'action' => 'FAILED', 'details' => "`{$column}` needs a `{$refTable}` record but none was chosen."];
        }

        if ($this->accessPolicy->getTableClass($connection, $refTable) === 'blocked') {
            return $base + ['status' => 'error', 'action' => 'FAILED', 'details' => "`{$column}` points at protected table `{$refTable}`, which automations cannot use."];
        }

        $refInfo = $this->inspector->describe($pdo, $connection->database_name, $refTable);
        if ($refInfo === null) {
            return $base + ['status' => 'error', 'action' => 'FAILED', 'details' => "Referenced table `{$refTable}` for `{$column}` was not found."];
        }

        // 1. Explicit id
        if (is_int($val) || (is_string($val) && ctype_digit(trim($val)))) {
            $id = (int) $val;
            $stmt = $pdo->prepare("SELECT 1 FROM `{$refTable}` WHERE `{$refCol}` = :id LIMIT 1");
            $stmt->execute(['id' => $id]);
            if ($stmt->fetchColumn()) {
                return ['status' => 'ok', 'action' => 'REUSED_BY_ID', 'column' => $column, 'table' => $refTable, 'lookup' => $id, 'resolved_id' => $id,
                    'details' => "Uses existing `{$refTable}` record #{$id}."];
            }
            return $base + ['status' => 'error', 'action' => 'FAILED', 'details' => "`{$column}` points at `{$refTable}` #{$id}, which does not exist (it may have been deleted). Choose another record."];
        }

        // 2. Label match
        $label = trim(preg_replace('/\s+/', ' ', (string) $val));
        $labelCol = TargetTableInspector::labelColumn($refInfo);
        $slugCol = TargetTableInspector::slugColumn($refInfo);
        if ($labelCol === null && $slugCol === null) {
            return $base + ['status' => 'error', 'action' => 'FAILED', 'details' => "`{$refTable}` has no name, title or slug column, so '{$label}' cannot be matched. Choose a fixed record instead."];
        }

        $where = [];
        $params = [];
        if ($labelCol) {
            $where[] = "LOWER(`{$labelCol}`) = LOWER(:label)";
            $params['label'] = $label;
        }
        if ($slugCol && ($slug = Str::slug($label)) !== '') {
            $where[] = "`{$slugCol}` = :slug";
            $params['slug'] = $slug;
        }
        $select = "`{$refCol}` AS id" . ($labelCol ? ", `{$labelCol}` AS label" : '');
        $stmt = $pdo->prepare("SELECT {$select} FROM `{$refTable}` WHERE " . implode(' OR ', $where) . " ORDER BY `{$refCol}` ASC LIMIT 5");
        $stmt->execute($params);
        $matches = $stmt->fetchAll(PDO::FETCH_ASSOC);
        if (!empty($matches)) {
            $pick = $matches[0];
            foreach ($matches as $m) {
                if (isset($m['label']) && strcasecmp((string) $m['label'], $label) === 0) {
                    $pick = $m;
                    break;
                }
            }
            $id = is_numeric($pick['id']) ? (int) $pick['id'] : $pick['id'];
            $shown = $pick['label'] ?? $label;
            return ['status' => 'ok', 'action' => 'MATCHED_EXISTING', 'column' => $column, 'table' => $refTable, 'lookup' => $label, 'resolved_id' => $id,
                'details' => "Matched existing `{$refTable}` record '{$shown}' (#{$id})."];
        }

        // 3. Create when allowed
        if ($policy !== 'CREATE_IF_MISSING') {
            return $base + ['status' => 'error', 'action' => 'FAILED', 'details' => "No `{$refTable}` record named '{$label}' exists, and this automation may only use existing records. Choose a fixed record or allow creating new ones."];
        }
        if ($this->safetyService->isTableSensitive($refTable) || $this->accessPolicy->getTableClass($connection, $refTable) !== 'writable') {
            return $base + ['status' => 'error', 'action' => 'FAILED', 'details' => "No `{$refTable}` record named '{$label}' exists, and `{$refTable}` is protected, so automations will not create one."];
        }

        $built = $this->parentRowBuilder->build($refInfo, $label, $opts['description'] ?? null, $connection->data_timezone ?: 'UTC');
        $errors = array_filter($built['issues'], fn($i) => $i['level'] === 'error');
        if (!empty($errors)) {
            return $base + ['status' => 'error', 'action' => 'FAILED', 'details' => implode(' ', array_map(fn($e) => $e['message'], $errors))];
        }
        $values = $built['values'];
        if ($slugCol && isset($values[$slugCol])) {
            $values[$slugCol] = $this->uniqueValue($pdo, $refTable, $slugCol, $values[$slugCol], $refInfo['columns'][$slugCol]['max_length'], $dryRun, $built['issues']);
        }

        $steps[] = [
            'order' => count($steps) + 1,
            'action' => 'CREATE_PARENT',
            'table' => $refTable,
            'description' => "Create `{$refTable}` record '{$label}' first, then use its new id for `{$column}`.",
            'values' => $this->displayRow($values),
        ];

        if ($dryRun) {
            return ['status' => 'create', 'action' => 'WILL_CREATE', 'column' => $column, 'table' => $refTable, 'lookup' => $label, 'resolved_id' => null,
                'values' => $this->displayRow($values),
                'details' => "No `{$refTable}` record named '{$label}' exists yet; it will be created in the same transaction and its new id stored in `{$column}`."];
        }

        try {
            $newId = $this->insertRow($pdo, $refTable, $values, $refInfo);
        } catch (PDOException $e) {
            if ($e->getCode() == 23000 || str_contains($e->getMessage(), 'Duplicate entry')) {
                $stmt = $pdo->prepare("SELECT {$select} FROM `{$refTable}` WHERE " . implode(' OR ', $where) . " ORDER BY `{$refCol}` ASC LIMIT 1");
                $stmt->execute($params);
                if ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
                    return ['status' => 'ok', 'action' => 'CONCURRENCY_REUSED', 'column' => $column, 'table' => $refTable, 'lookup' => $label, 'resolved_id' => (int) $row['id'],
                        'details' => "'{$label}' was created concurrently; reused `{$refTable}` #{$row['id']}."];
                }
            }
            throw new Exception("Could not create the `{$refTable}` record '{$label}': " . $e->getMessage());
        }

        $id = is_numeric($newId) ? (int) $newId : $newId;
        return ['status' => 'ok', 'action' => 'CREATED_NEW', 'column' => $column, 'table' => $refTable, 'lookup' => $label, 'resolved_id' => $id,
            'values' => $this->displayRow($values),
            'details' => "Created `{$refTable}` record '{$label}' (#{$id}) and used it for `{$column}`."];
    }

    /** Parameterised INSERT of an already-validated row; returns the new primary key. */
    private function insertRow(PDO $pdo, string $table, array $row, array $info): string|int
    {
        $columns = array_keys($row);
        $colSql = implode(', ', array_map(fn($c) => "`{$c}`", $columns));
        $paramSql = implode(', ', array_map(fn($i) => ":p{$i}", array_keys($columns)));
        $sql = "INSERT INTO `{$table}` ({$colSql}) VALUES ({$paramSql})";
        $this->safetyService->assertQueryIsSafe($sql);

        $stmt = $pdo->prepare($sql);
        foreach ($columns as $i => $col) {
            $val = $row[$col];
            if ($val === null) {
                $stmt->bindValue(":p{$i}", null, PDO::PARAM_NULL);
            } elseif (is_int($val)) {
                $stmt->bindValue(":p{$i}", $val, PDO::PARAM_INT);
            } elseif (is_bool($val)) {
                $stmt->bindValue(":p{$i}", $val ? 1 : 0, PDO::PARAM_INT);
            } else {
                $stmt->bindValue(":p{$i}", (string) $val, PDO::PARAM_STR);
            }
        }
        $stmt->execute();

        $id = $pdo->lastInsertId();
        if ((!$id || $id === '0') && $info['primary_key'] && array_key_exists($info['primary_key'], $row)) {
            return $row[$info['primary_key']];
        }
        return $id;
    }

    private function valueExists(PDO $pdo, string $table, string $column, string $value): bool
    {
        try {
            $stmt = $pdo->prepare("SELECT 1 FROM `{$table}` WHERE `{$column}` = :v LIMIT 1");
            $stmt->execute(['v' => $value]);
            return (bool) $stmt->fetchColumn();
        } catch (\Throwable) {
            return false;
        }
    }

    /** Make a slug-like value unique with a numeric suffix (-2, -3, ...), respecting the column length. */
    private function uniqueValue(PDO $pdo, string $table, string $column, string $value, ?int $maxLen, bool $dryRun, array &$issues): string
    {
        $base = $maxLen ? mb_substr($value, 0, $maxLen) : $value;
        if (!$this->valueExists($pdo, $table, $column, $base)) {
            return $base;
        }
        for ($n = 2; $n <= 50; $n++) {
            $suffix = "-{$n}";
            $candidate = ($maxLen && mb_strlen($base . $suffix) > $maxLen ? mb_substr($base, 0, $maxLen - strlen($suffix)) : $base) . $suffix;
            if (!$this->valueExists($pdo, $table, $column, $candidate)) {
                $issues[] = ['level' => 'info', 'column' => $column, 'message' => "`{$table}`.`{$column}` '{$base}' already exists, so '{$candidate}' will be used."];
                return $candidate;
            }
        }
        $candidate = mb_substr($base, 0, max(1, ($maxLen ?? 200) - 9)) . '-' . Str::lower(Str::random(8));
        $issues[] = ['level' => 'info', 'column' => $column, 'message' => "`{$table}`.`{$column}` made unique as '{$candidate}'."];
        return $candidate;
    }

    private function displayValue(mixed $v): mixed
    {
        if ($v instanceof PendingParentId) {
            return (string) $v;
        }
        return $v;
    }

    private function displayRow(array $row): array
    {
        return array_map(fn($v) => $this->displayValue($v), $row);
    }

    /**
     * Backwards-compatible single relation resolution (used for tag pivots): returns the parent id,
     * creating it when the options allow. Must run inside the caller's transaction.
     */
    public function resolveRelationalRecord(
        PDO $pdo,
        string $dbName,
        string $refTable,
        string $refCol,
        mixed $lookupValue,
        array $options = [],
        array &$relationResolutions = [],
        ?DbConnection $connection = null
    ): ?int {
        $connection ??= new DbConnection(['database_name' => $dbName]);
        $steps = [];
        $res = $this->resolveForeignKey(
            $pdo,
            $connection,
            $refTable . '_ref',
            ['foreign_key' => ['table' => $refTable, 'column' => $refCol], 'nullable' => true],
            $lookupValue,
            $options + ['creation_policy' => $options['creation_policy'] ?? 'CREATE_IF_MISSING'],
            false,
            $steps
        );
        if ($res['status'] === 'error') {
            throw new Exception($res['details']);
        }
        if ($res['status'] !== 'null') {
            $relationResolutions[] = $res;
        }
        return $res['resolved_id'] !== null ? (int) $res['resolved_id'] : null;
    }

    /**
     * Handle association pivot tables (e.g. post_tags linking posts to tags).
     */
    protected function handleAssociationTables(
        PDO $pdo,
        DbConnection $connection,
        string $tableName,
        int $recordId,
        array $payload,
        array &$relationResolutions
    ): void {
        if ($tableName !== 'posts' || (empty($payload['tags']) && empty($payload['tag_names']))) {
            return;
        }
        $tagList = $payload['tags'] ?? $payload['tag_names'];
        if (is_string($tagList)) {
            $tagList = array_map('trim', explode(',', $tagList));
        }
        if (!is_array($tagList)) {
            return;
        }

        $ptCheck = $pdo->prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = :db AND table_name = 'post_tags'");
        $ptCheck->execute(['db' => $connection->database_name]);
        $hasPivot = (bool) $ptCheck->fetchColumn();
        $tagsCheck = $pdo->prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = :db AND table_name = 'tags'");
        $tagsCheck->execute(['db' => $connection->database_name]);
        if (!$hasPivot || !$tagsCheck->fetchColumn()) {
            return;
        }

        foreach ($tagList as $tagItem) {
            $tagName = is_array($tagItem) ? ($tagItem['name'] ?? null) : trim((string) $tagItem);
            if (empty($tagName)) {
                continue;
            }
            try {
                $tagId = $this->resolveRelationalRecord($pdo, $connection->database_name, 'tags', 'id', $tagName, ['creation_policy' => 'CREATE_IF_MISSING'], $relationResolutions, $connection);
                if ($tagId) {
                    $insPt = $pdo->prepare("INSERT IGNORE INTO `post_tags` (`post_id`, `tag_id`) VALUES (:post_id, :tag_id)");
                    $insPt->execute(['post_id' => $recordId, 'tag_id' => $tagId]);
                    $relationResolutions[] = [
                        'table' => 'post_tags',
                        'action' => 'PIVOT_LINKED',
                        'lookup' => "post #{$recordId} -> tag #{$tagId} ('{$tagName}')",
                        'resolved_id' => $tagId,
                        'details' => "Linked post #{$recordId} to tag '{$tagName}' in post_tags.",
                    ];
                }
            } catch (Exception) {
                // Tag linking is best-effort and never blocks the main insert.
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

    /**
     * Safely delete a specifically verified record created by an automated execution for safe compensation / undo.
     * Strictly bounded to a single integer primary key on an allowlisted table.
     */
    public function executeDeleteForCompensation(
        DbConnection $connection,
        string $tableName,
        int|string $recordId
    ): array {
        $this->safetyService->validateConnectionTarget($connection->host, $connection->port);

        if ($this->safetyService->isTableSensitive($tableName)) {
            throw new Exception("Security violation: Table '{$tableName}' is classified as restricted and cannot undergo compensation.");
        }

        if (empty($recordId) || !is_numeric($recordId) || ((int) $recordId) <= 0) {
            throw new Exception("Invalid record ID for compensation: Must be a positive integer.");
        }

        $pdo = null;
        try {
            $pdo = $connection->createTargetPdo();
            $pdo->beginTransaction();

            // Strict single-row delete by primary key
            $sql = "DELETE FROM `{$tableName}` WHERE `id` = :id LIMIT 1";
            $stmt = $pdo->prepare($sql);
            $stmt->bindValue(':id', (int) $recordId, PDO::PARAM_INT);
            $stmt->execute();
            $rowsAffected = $stmt->rowCount();

            $pdo->commit();

            return [
                'success' => true,
                'operation' => 'COMPENSATION_DELETE',
                'table' => $tableName,
                'record_id' => (int) $recordId,
                'rows_affected' => $rowsAffected,
            ];
        } catch (Exception $e) {
            if ($pdo && $pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw new Exception("Target database compensation failed: " . $e->getMessage());
        } finally {
            $pdo = null;
        }
    }
}
