<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\DataChangeRequest;
use App\Models\DbConnection;
use App\Services\Data\ColumnClassifier;
use App\Services\Data\DataAccessPolicy;
use App\Services\Data\DataChangeService;
use App\Services\Data\DataException;
use App\Services\Data\LiveSchemaService;
use App\Services\Data\RowValidator;
use App\Services\Data\TargetConnector;
use App\Services\FeatureFlagService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use PDO;

/**
 * Data Explorer (browse rows) and Data Manager (add, edit, delete rows) for the customer's own connections.
 * Reads run in a read-only transaction with the statement time limit; secret columns are never returned and personal
 * data is masked unless the customer reveals it (audited). Every change goes through DataChangeService: validated,
 * previewed, confirmed, pinned to the previewed rows, recorded and undoable.
 */
class DataExplorerController extends Controller
{
    use \App\Http\Controllers\Concerns\StreamsProgress;

    public function __construct(
        private LiveSchemaService $schema,
        private DataAccessPolicy $policy,
        private TargetConnector $connector,
        private DataChangeService $changes,
        private RowValidator $validator,
    ) {}

    private function connection(Request $request, int $id): DbConnection
    {
        abort_unless(app(FeatureFlagService::class)->isEnabled('FEATURE_DATA_EXPLORER'), 403, 'The Data Explorer is turned off by the administrator.');
        return DbConnection::where('user_id', $request->user()->id)->findOrFail($id);
    }

    private function tableMeta(DbConnection $connection, string $table): array
    {
        $meta = $this->schema->getCatalog($connection)['tables'][$table] ?? null;
        if (!$meta) {
            throw new DataException('TABLE_NOT_FOUND', "There is no table “{$table}” in this database.");
        }
        $this->policy->assertCanReadTable($connection, $table);
        return $meta;
    }

    /** What the customer may do with a table on this connection, and why not. */
    private function permissions(DbConnection $connection, string $table): array
    {
        $out = ['read' => true, 'insert' => false, 'update' => false, 'delete' => false, 'reason' => null];
        $managerOn = app(FeatureFlagService::class)->isEnabled('FEATURE_DATA_MANAGER');
        foreach (['insert', 'update', 'delete'] as $op) {
            // Only a preview of what is possible: nothing is attempted, so nothing is logged.
            $refusal = $this->policy->writeRefusal($connection, $table, $op);
            if ($refusal === null) {
                $out[$op] = $managerOn;
            } else {
                $out['reason'] ??= $refusal['message'];
            }
        }
        if (!$managerOn) {
            $out['reason'] = 'Changing data in the portal is turned off by the administrator.';
        }
        return $out;
    }

    /** Tables of a connection with size, protection class and what can be done with each. */
    public function tables(Request $request, int $id): JsonResponse
    {
        $connection = $this->connection($request, $id);
        $catalog = $this->schema->getCatalog($connection, $request->boolean('refresh'));
        $tables = [];
        foreach ($catalog['tables'] as $name => $t) {
            $blocked = ($t['class'] ?? null) === 'blocked';
            $tables[] = [
                'name' => $name,
                'kind' => $t['kind'] ?? 'table',
                'rows_estimate' => $t['rows_estimate'] ?? null,
                'columns' => count($t['columns'] ?? []),
                'primary_key' => $t['primary_key'] ?? [],
                'class' => $t['class'] ?? 'normal',
                'blocked' => $blocked,
                'permissions' => $blocked ? ['read' => false, 'insert' => false, 'update' => false, 'delete' => false, 'reason' => 'Credential and session tables are never shown.'] : $this->permissions($connection, $name),
            ];
        }
        usort($tables, fn ($a, $b) => [$a['blocked'], $a['name']] <=> [$b['blocked'], $b['name']]);

        return response()->json([
            'connection' => ['id' => $connection->id, 'name' => $connection->name, 'database' => $connection->database_name, 'access_mode' => $connection->access_mode ?: 'read_only'],
            'tables' => $tables,
        ]);
    }

    /** One page of rows: search, filters, sort; secrets never returned; personal data masked unless revealed. */
    public function rows(Request $request, int $id, string $table): JsonResponse
    {
        $connection = $this->connection($request, $id);
        $meta = $this->tableMeta($connection, $table);
        $maxPage = max(10, (int) config('data_explorer.max_page_size', 100));
        $v = $request->validate([
            'page' => 'nullable|integer|min:1|max:100000',
            'per_page' => "nullable|integer|min:5|max:{$maxPage}",
            'sort' => 'nullable|string|max:64',
            'dir' => 'nullable|in:asc,desc',
            'search' => 'nullable|string|max:200',
            'filters' => 'nullable|array|max:10',
            'filters.*' => 'nullable|string|max:200',
            'reveal' => 'nullable|boolean',
        ]);

        $columns = array_filter($meta['columns'], fn ($c, $name) => !ColumnClassifier::isSecret($name) && ($c['family'] ?? '') !== 'binary', ARRAY_FILTER_USE_BOTH);
        $names = array_keys($columns);
        $pk = $meta['primary_key'] ?? [];
        $sort = in_array($v['sort'] ?? null, $names, true) ? $v['sort'] : ($pk[0] ?? $names[0] ?? null);
        $dir = ($v['dir'] ?? ($sort === ($pk[0] ?? null) ? 'desc' : 'asc')) === 'desc' ? 'DESC' : 'ASC';
        $perPage = (int) ($v['per_page'] ?? 25);
        $page = (int) ($v['page'] ?? 1);
        $reveal = (bool) ($v['reveal'] ?? false);

        $result = $this->connector->read($connection, function (PDO $pdo, $dialect) use ($table, $names, $columns, $v, $sort, $dir, $perPage, $page) {
            $where = [];
            $bind = [];
            if (!empty($v['search'])) {
                $textCols = array_keys(array_filter($columns, fn ($c) => in_array($c['family'] ?? '', ['string', 'text', 'enum'], true)));
                if ($textCols) {
                    $where[] = '(' . implode(' OR ', array_map(fn ($c) => $dialect->quoteIdentifier($c) . ' ' . $dialect->ciLike() . ' ?', $textCols)) . ')';
                    foreach ($textCols as $_) {
                        $bind[] = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $v['search']) . '%';
                    }
                }
            }
            foreach ((array) ($v['filters'] ?? []) as $col => $val) {
                if (!in_array($col, $names, true)) {
                    throw new DataException('UNKNOWN_COLUMN', "There is no column “{$col}” to filter by.");
                }
                if ($val === null || $val === '') {
                    $where[] = $dialect->quoteIdentifier($col) . ' IS NULL';
                } else {
                    $where[] = $dialect->quoteIdentifier($col) . ' = ?';
                    $bind[] = $val;
                }
            }
            $qTable = $dialect->quoteIdentifier($table);
            $whereSql = $where ? ' WHERE ' . implode(' AND ', $where) : '';

            $total = null;
            try {
                $stmt = $pdo->prepare("SELECT COUNT(*) FROM {$qTable}{$whereSql}");
                $stmt->execute($bind);
                $total = (int) $stmt->fetchColumn();
            } catch (\Throwable) {
                // very large tables may hit the time limit: rows are still shown, without a total
            }

            $select = implode(', ', array_map(fn ($c) => $dialect->quoteIdentifier($c), $names));
            $order = $sort ? ' ORDER BY ' . $dialect->quoteIdentifier($sort) . " {$dir}" : '';
            $stmt = $pdo->prepare("SELECT {$select} FROM {$qTable}{$whereSql}{$order} LIMIT " . ($perPage) . ' OFFSET ' . (($page - 1) * $perPage));
            $stmt->execute($bind);
            return ['rows' => $stmt->fetchAll(PDO::FETCH_ASSOC), 'total' => $total];
        });

        $labels = $this->linkLabels($connection, $meta, $result['rows']);
        $rows = $this->policy->maskResultRows($result['rows'], $reveal);
        if ($reveal) {
            AuditLog::log($request->user()->id, 'data.pii_revealed', 'db_connections', (string) $connection->id, ['table' => $table, 'rows' => count($rows)]);
        }

        $fks = [];
        foreach ($meta['foreign_keys'] ?? [] as $fk) {
            if (count($fk['columns']) === 1) {
                $fks[$fk['columns'][0]] = ['table' => $fk['ref_table'], 'column' => $fk['ref_columns'][0]];
            }
        }

        return response()->json([
            'table' => $table,
            'primary_key' => $pk,
            'columns' => array_values(array_map(fn ($name) => [
                'name' => $name,
                'type' => $columns[$name]['raw_type'] ?? $columns[$name]['data_type'] ?? '',
                'family' => $columns[$name]['family'] ?? 'other',
                'nullable' => (bool) ($columns[$name]['nullable'] ?? true),
                'default' => $columns[$name]['default'] ?? null,
                'max_length' => $columns[$name]['max_length'] ?? null,
                'enum' => $columns[$name]['enum'] ?? [],
                'auto' => (bool) ($columns[$name]['auto'] ?? false),
                'generated' => (bool) ($columns[$name]['generated'] ?? false),
                'is_pk' => in_array($name, $pk, true),
                'link' => $fks[$name] ?? null,
                'personal' => ColumnClassifier::isPii($name),
                'comment' => $columns[$name]['comment'] ?? '',
            ], $names)),
            'hidden_columns' => array_values(array_diff(array_keys($meta['columns']), $names)),
            'rows' => $rows,
            'labels' => $labels,
            'total' => $result['total'],
            'page' => $page,
            'per_page' => $perPage,
            'sort' => $sort,
            'dir' => strtolower($dir),
            'revealed' => $reveal,
            'permissions' => $this->permissions($connection, $table),
        ]);
    }

    /** Readable names for linked ids on this page (category_id 3 -> "Fashion"). */
    private function linkLabels(DbConnection $connection, array $meta, array $rows): array
    {
        if (!$rows) {
            return [];
        }
        $catalog = $this->schema->getCatalog($connection);
        $wanted = [];
        foreach ($meta['foreign_keys'] ?? [] as $fk) {
            if (count($fk['columns']) !== 1) {
                continue;
            }
            $ref = $catalog['tables'][$fk['ref_table']] ?? null;
            if (!$ref || ($ref['class'] ?? null) === 'blocked') {
                continue;
            }
            $label = null;
            foreach ($ref['columns'] as $n => $c) {
                if (!empty($c['is_label']) && !ColumnClassifier::isSecret($n) && !ColumnClassifier::isPii($n)) {
                    $label = $n;
                    break;
                }
            }
            $ids = array_values(array_unique(array_filter(array_column($rows, $fk['columns'][0]), fn ($x) => $x !== null)));
            if ($label && $ids) {
                $wanted[$fk['columns'][0]] = [$fk['ref_table'], $fk['ref_columns'][0], $label, array_slice($ids, 0, 200)];
            }
        }
        if (!$wanted) {
            return [];
        }
        return $this->connector->read($connection, function (PDO $pdo, $dialect) use ($wanted) {
            $out = [];
            foreach ($wanted as $col => [$refTable, $refCol, $label, $ids]) {
                $stmt = $pdo->prepare('SELECT ' . $dialect->quoteIdentifier($refCol) . ' AS k, ' . $dialect->quoteIdentifier($label) . ' AS v FROM ' . $dialect->quoteIdentifier($refTable)
                    . ' WHERE ' . $dialect->quoteIdentifier($refCol) . ' IN (' . implode(', ', array_fill(0, count($ids), '?')) . ')');
                $stmt->execute($ids);
                foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
                    $out[$col][(string) $r['k']] = mb_substr((string) $r['v'], 0, 120);
                }
            }
            return $out;
        });
    }

    /** Choices for a linked column (search the parent table by its readable name). */
    public function linkOptions(Request $request, int $id, string $table, string $column): JsonResponse
    {
        $connection = $this->connection($request, $id);
        $meta = $this->tableMeta($connection, $table);
        $fk = collect($meta['foreign_keys'] ?? [])->first(fn ($f) => $f['columns'] === [$column]);
        abort_unless($fk, 404, 'This column does not link to another table.');
        $q = trim((string) $request->query('q', ''));
        $ref = $this->tableMeta($connection, $fk['ref_table']);
        $label = collect($ref['columns'])->keys()->first(fn ($n) => !empty($ref['columns'][$n]['is_label']) && !ColumnClassifier::isSecret($n) && !ColumnClassifier::isPii($n));

        $options = $this->connector->read($connection, function (PDO $pdo, $dialect) use ($fk, $label, $q) {
            $key = $dialect->quoteIdentifier($fk['ref_columns'][0]);
            $sel = $label ? ", {$dialect->quoteIdentifier($label)} AS label" : '';
            $sql = "SELECT {$key} AS id{$sel} FROM " . $dialect->quoteIdentifier($fk['ref_table']);
            $bind = [];
            if ($q !== '' && $label) {
                $sql .= ' WHERE ' . $dialect->quoteIdentifier($label) . ' ' . $dialect->ciLike() . ' ?';
                $bind[] = '%' . $q . '%';
            }
            $stmt = $pdo->prepare($sql . " ORDER BY {$key} LIMIT 50");
            $stmt->execute($bind);
            return $stmt->fetchAll(PDO::FETCH_ASSOC);
        });

        return response()->json(['table' => $fk['ref_table'], 'options' => array_map(fn ($o) => ['id' => $o['id'], 'label' => isset($o['label']) ? mb_substr((string) $o['label'], 0, 120) : null], $options)]);
    }

    // ------------------------------------------------------------------ Data Manager (changes)

    public function previewInsert(Request $request, int $id, string $table): JsonResponse
    {
        $connection = $this->connection($request, $id);
        $this->managerOn();
        $v = $request->validate(['rows' => 'required|array|min:1|max:100', 'rows.*' => 'array']);
        $this->tableMeta($connection, $table);
        $res = $this->changes->previewInsert($connection, $request->user(), $table, $v['rows'], 'manual');
        return $res['success'] ? response()->json($res) : response()->json(['message' => 'Fix the values marked in red.', 'row_errors' => $res['errors']], 422);
    }

    public function previewUpdate(Request $request, int $id, string $table): JsonResponse
    {
        $connection = $this->connection($request, $id);
        $this->managerOn();
        $v = $request->validate(['key' => 'required', 'values' => 'required|array|min:1|max:200']);
        $meta = $this->tableMeta($connection, $table);
        $pk = $meta['primary_key'][0] ?? null;
        if (!$pk) {
            throw new DataException('NO_PRIMARY_KEY', 'This table has no primary key, so a single row cannot be changed safely.');
        }
        [$clean, $errors] = $this->validator->validate($meta, $v['values'], false);
        $errors += $this->changes->checkUniqueAndLinks($connection, $table, $meta, [$clean], [0 => $v['key']])[0] ?? [];
        if ($errors) {
            return response()->json(['message' => 'Fix the values marked in red.', 'row_errors' => [0 => $errors]], 422);
        }
        $res = $this->changes->previewUpdate($connection, $request->user(), $table, [$pk => $v['key']], $clean);
        return response()->json($res, $res['success'] ? 200 : 404);
    }

    public function previewDelete(Request $request, int $id, string $table): JsonResponse
    {
        $connection = $this->connection($request, $id);
        $this->managerOn();
        $v = $request->validate(['key' => 'required']);
        $meta = $this->tableMeta($connection, $table);
        $pk = $meta['primary_key'][0] ?? null;
        if (!$pk) {
            throw new DataException('NO_PRIMARY_KEY', 'This table has no primary key, so a single row cannot be deleted safely.');
        }
        $res = $this->changes->previewDelete($connection, $request->user(), $table, [$pk => $v['key']]);
        return response()->json($res, $res['success'] ? 200 : 404);
    }

    /**
     * AI sample rows: the customer's writing model proposes rows, every value is checked, and the valid rows become
     * an insert preview to confirm. ?stream=1 reports each step as it happens.
     */
    public function sampleRows(Request $request, int $id, string $table, \App\Services\Data\SampleDataService $samples): \Symfony\Component\HttpFoundation\Response
    {
        $connection = $this->connection($request, $id);
        $this->managerOn();
        abort_unless(app(FeatureFlagService::class)->isEnabled('FEATURE_SAMPLE_DATA'), 403, 'AI sample rows are turned off by the administrator.');
        $v = $request->validate([
            'count' => 'required|integer|min:1|max:' . \App\Services\Data\SampleDataService::maxRows(),
            'instructions' => 'nullable|string|max:1000',
        ]);
        $this->tableMeta($connection, $table);
        $user = $request->user();

        return $this->respondWithProgress($request->boolean('stream'), function (callable $emit) use ($samples, $connection, $user, $table, $v) {
            try {
                $gen = $samples->generate($connection, $user, $table, (int) $v['count'], (string) ($v['instructions'] ?? ''), $emit);
            } catch (DataException $e) {
                return [422, ['message' => $e->getMessage()]];
            } catch (\Throwable $e) {
                return [422, ['message' => DbConnection::explainFailure($e, $connection)]];
            }
            if (!$gen['rows']) {
                return [422, [
                    'message' => 'No usable rows came back' . ($gen['error'] ? ': ' . $gen['error'] : '.') . ' Try again, or describe the rows you want.',
                    'dropped' => $gen['dropped'],
                    'problems' => $gen['problems'],
                ]];
            }
            $preview = $this->changes->previewInsert($connection, $user, $table, $gen['rows'], 'sample');
            if (!$preview['success']) {
                return [422, ['message' => 'The rows did not pass the final check.', 'row_errors' => $preview['errors']]];
            }
            $emit('READY', 'Ready: review the rows, then add them.');
            return [200, $preview + [
                'rows' => $gen['rows'],
                'dropped' => $gen['dropped'],
                'problems' => $gen['problems'],
                'model' => $gen['model'],
                'requested' => $gen['requested'],
            ]];
        });
    }

    public function confirm(Request $request, int $changeId): JsonResponse
    {
        $v = $request->validate(['typed_phrase' => 'nullable|string|max:200']);
        $change = DataChangeRequest::where('user_id', $request->user()->id)->findOrFail($changeId);
        return response()->json($this->changes->executeChange($request->user(), $change->id, $v['typed_phrase'] ?? null));
    }

    public function cancel(Request $request, int $changeId): JsonResponse
    {
        $change = DataChangeRequest::where('user_id', $request->user()->id)->where('status', 'pending_confirmation')->findOrFail($changeId);
        $change->update(['status' => 'cancelled']);
        return response()->json(['cancelled' => true]);
    }

    public function undo(Request $request, int $changeId): JsonResponse
    {
        $change = DataChangeRequest::where('user_id', $request->user()->id)->findOrFail($changeId);
        return response()->json($this->changes->undo($request->user(), $change->id));
    }

    /** Recent changes to a table (who/what/when, and whether they can still be undone). */
    public function history(Request $request, int $id, string $table): JsonResponse
    {
        $connection = $this->connection($request, $id);
        $items = DataChangeRequest::where('user_id', $request->user()->id)->where('connection_id', $connection->id)
            ->where('target_table', $table)->whereIn('status', ['executed', 'undone', 'rolled_back'])
            ->latest('id')->limit(20)->get();
        return response()->json(['changes' => $items->map(fn (DataChangeRequest $c) => [
            'id' => $c->id,
            'action' => $c->action,
            'source' => $c->patch_values['source'] ?? ($c->task_id ? 'orbit' : 'manual'),
            'rows' => $c->affected_count,
            'status' => $c->status,
            'executed_at' => $c->executed_at?->toIso8601String(),
            'undone_at' => $c->undone_at?->toIso8601String(),
            'can_undo' => $c->status === 'executed' && ($c->action !== 'insert' || ($c->executed_at && $c->executed_at->gt(now()->subDay()))),
        ])]);
    }

    private function managerOn(): void
    {
        abort_unless(app(FeatureFlagService::class)->isEnabled('FEATURE_DATA_MANAGER'), 403, 'Changing data in the portal is turned off by the administrator.');
    }
}
