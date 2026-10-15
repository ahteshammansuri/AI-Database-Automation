<?php

namespace App\Services;

use App\Models\DbConnection;
use App\Models\SchemaSnapshot;
use App\Models\SchemaTableAnnotation;
use Illuminate\Support\Facades\Log;
use PDO;
use Exception;

class SchemaIntrospectionService
{
    public function __construct(
        protected DatabaseSafetyService $safetyService,
        protected ?AiServiceClient $aiClient = null
    ) {
        $this->aiClient = $aiClient ?? app(AiServiceClient::class);
    }

    /**
     * Alias for introspectSchema without forced snapshot persistence.
     */
    public function introspect(DbConnection $connection, bool $persistSnapshot = false): array
    {
        return $this->introspectSchema($connection, $persistSnapshot);
    }

    /**
     * Introspect MySQL database schema in read-only mode, classify table eligibility,
     * enrich with semantic annotations, and persist a versioned snapshot with diff tracking.
     */
    public function introspectSchema(DbConnection $connection, bool $persistSnapshot = true): array
    {
        $this->safetyService->validateConnectionTarget($connection->host, $connection->port);

        $pdo = null;
        try {
            $pdo = $connection->createTargetPdo();
            $dbName = $connection->database_name;

            // 1. Fetch tables
            $stmt = $pdo->prepare("
                SELECT 
                    table_name AS table_name,
                    table_rows AS approx_rows
                FROM information_schema.tables 
                WHERE table_schema = :db_name AND table_type = 'BASE TABLE'
                ORDER BY table_name ASC
            ");
            $stmt->execute(['db_name' => $dbName]);
            $rawTables = $stmt->fetchAll();

            $tables = [];

            // Pre-load user workspace annotations for this connection
            $annotations = SchemaTableAnnotation::where('user_id', $connection->user_id)
                ->where('connection_id', $connection->id)
                ->get()
                ->keyBy('table_name');

            foreach ($rawTables as $rawTableRow) {
                $tableRow = array_change_key_case($rawTableRow, CASE_LOWER);
                $tableName = $tableRow['table_name'];

                // Fetch columns
                $colStmt = $pdo->prepare("
                    SELECT 
                        column_name,
                        column_type,
                        data_type,
                        is_nullable,
                        column_key,
                        column_default,
                        character_maximum_length
                    FROM information_schema.columns
                    WHERE table_schema = :db_name AND table_name = :table_name
                    ORDER BY ordinal_position ASC
                ");
                $colStmt->execute(['db_name' => $dbName, 'table_name' => $tableName]);
                $rawCols = $colStmt->fetchAll();

                $columns = [];
                foreach ($rawCols as $rawCol) {
                    $col = array_change_key_case($rawCol, CASE_LOWER);
                    $colType = $col['column_type'];
                    $enumValues = [];
                    if (str_starts_with(strtolower($colType), 'enum(')) {
                        preg_match_all("/'([^']+)'/", $colType, $matches);
                        $enumValues = $matches[1] ?? [];
                    }

                    $columns[] = [
                        'name' => $col['column_name'],
                        'type' => $colType,
                        'data_type' => $col['data_type'],
                        'is_nullable' => strtoupper($col['is_nullable'] ?? '') === 'YES',
                        'is_primary_key' => ($col['column_key'] ?? '') === 'PRI',
                        'is_unique' => in_array($col['column_key'] ?? '', ['UNI', 'PRI'], true),
                        'default' => $col['column_default'] ?? null,
                        'max_length' => $col['character_maximum_length'] ?? null,
                        'enum_values' => $enumValues,
                    ];
                }

                // Fetch foreign key relationships
                $fkStmt = $pdo->prepare("
                    SELECT 
                        column_name,
                        referenced_table_name,
                        referenced_column_name
                    FROM information_schema.key_column_usage
                    WHERE table_schema = :db_name 
                      AND table_name = :table_name 
                      AND referenced_table_name IS NOT NULL
                ");
                $fkStmt->execute(['db_name' => $dbName, 'table_name' => $tableName]);
                $rawFks = $fkStmt->fetchAll();

                $relationships = [];
                foreach ($rawFks as $rawFk) {
                    $fk = array_change_key_case($rawFk, CASE_LOWER);
                    $relationships[] = [
                        'foreign_key' => $fk['column_name'],
                        'referenced_table' => $fk['referenced_table_name'],
                        'referenced_column' => $fk['referenced_column_name'],
                    ];
                }

                // Deterministic 4-tier table eligibility classification
                $classification = $this->safetyService->classifyTableEligibility($tableName, $columns, $relationships);

                // Fetch or default AI semantic annotation
                $ann = $annotations->get($tableName);
                $aiPurpose = $ann ? $ann->ai_purpose : $this->generateInitialTablePurpose($tableName, $classification['tier'], $columns);
                $aiConcept = $ann ? $ann->ai_business_concept : $this->inferBusinessConcept($tableName);
                $userNotes = $ann ? $ann->user_override_notes : null;

                $tables[] = [
                    'name' => $tableName,
                    'table_name' => $tableName,
                    'category' => $classification['tier'],
                    'eligibility_tier' => $classification['tier'],
                    'recommendation_score' => $classification['recommendation_score'],
                    'evidence' => $classification['evidence'],
                    'is_sensitive' => $classification['is_sensitive'],
                    'eligible_for_automation' => !$classification['is_sensitive'],
                    'restriction_reason' => $classification['restriction_reason'],
                    'approx_rows' => (int) ($tableRow['approx_rows'] ?? 0),
                    'columns' => $columns,
                    'relationships' => $relationships,
                    'ai_suggestion' => [
                        'purpose' => $aiPurpose,
                        'concept' => $aiConcept,
                        'user_notes' => $userNotes,
                        'is_user_verified' => $ann ? $ann->is_user_verified : false,
                    ],
                ];
            }

            $currentSchema = [
                'connection_id' => $connection->id,
                'database' => $dbName,
                'tables' => $tables,
            ];

            // 2. Snapshot persistence & diff detection
            $diff = null;
            if ($persistSnapshot) {
                $latestSnapshot = SchemaSnapshot::where('connection_id', $connection->id)
                    ->orderByDesc('id')
                    ->first();

                $newVersion = $latestSnapshot ? ($latestSnapshot->version + 1) : 1;

                if ($latestSnapshot) {
                    $diff = $this->calculateSchemaDiff($latestSnapshot->schema_payload, $currentSchema);
                }

                $totalCols = array_sum(array_map(fn($t) => count($t['columns']), $tables));

                $shouldCreateSnapshot = ($latestSnapshot === null) || ($diff && !empty($diff['has_changes']));

                if ($shouldCreateSnapshot) {
                    SchemaSnapshot::create([
                        'user_id' => $connection->user_id,
                        'connection_id' => $connection->id,
                        'version' => $newVersion,
                        'schema_payload' => $currentSchema,
                        'table_count' => count($tables),
                        'column_count' => $totalCols,
                    ]);

                    $currentSchema['snapshot_version'] = $newVersion;

                    // 3. Index structured Table Profiles into Python RAG for user-scoped semantic retrieval
                    if ($latestSnapshot && !empty($diff['has_changes'])) {
                        // Only re-index added or modified tables to avoid Ollama CPU saturation
                        $tablesToIndex = array_filter($tables, function ($t) use ($diff) {
                            $name = $t['name'] ?? '';
                            $isAdded = in_array($name, $diff['added_tables'] ?? []);
                            $isModified = in_array($name, array_column($diff['modified_tables'] ?? [], 'table'));
                            return $isAdded || $isModified;
                        });
                        $this->indexTableProfilesIntoRag($connection, array_values($tablesToIndex));
                    } else {
                        // First snapshot for connection: index all tables once
                        $this->indexTableProfilesIntoRag($connection, $tables);
                    }
                } else {
                    $currentSchema['snapshot_version'] = $latestSnapshot->version;
                }

                $currentSchema['schema_diff'] = $diff;
            }

            return $currentSchema;
        } finally {
            $pdo = null; // Explicitly release PDO connection
        }
    }

    /**
     * Generate structured Markdown Table Profile for a table.
     */
    public function generateTableProfileMarkdown(DbConnection $connection, array $table): string
    {
        $name = $table['name'] ?? 'unknown';
        $tier = $table['tier'] ?? 'UNKNOWN';
        $eligible = !empty($table['eligible']) ? 'Yes' : 'No';
        $approxRows = $table['approx_rows'] ?? 0;
        $notes = $table['user_notes'] ?? 'None';

        $pks = [];
        $fks = [];
        $colLines = [];

        foreach ($table['columns'] ?? [] as $col) {
            $cName = $col['name'] ?? '';
            $cType = $col['type'] ?? $col['data_type'] ?? 'varchar';
            $nullable = !empty($col['nullable']) ? 'nullable' : 'NOT NULL';
            $maxLen = !empty($col['max_length']) ? "max={$col['max_length']}" : null;
            $enums = !empty($col['enum_values']) ? 'enum=[' . implode(', ', $col['enum_values']) . ']' : null;
            $attrs = array_filter([$nullable, $maxLen, $enums]);
            $attrStr = $attrs ? ' (' . implode(', ', $attrs) . ')' : '';

            $colLines[] = "- `{$cName}`: `{$cType}`{$attrStr}";

            if (!empty($col['is_pk'])) {
                $pks[] = $cName;
            }
            if (!empty($col['fk_table'])) {
                $fks[] = "`{$cName}` → `{$col['fk_table']}`";
            }
        }

        $pkStr = $pks ? implode(', ', $pks) : 'None';
        $fkStr = $fks ? implode('; ', $fks) : 'None';
        $colsFormatted = implode("\n", $colLines);

        $guidance = match ($tier) {
            'RECOMMENDED' => 'This is an approved editorial/content table. Safe for parameterized automated operations.',
            'RESTRICTED'  => 'RESTRICTED TABLE: Authentication, credentials, payments, or audit logs. Automated writes are strictly prohibited by platform security invariants.',
            default       => 'Auxiliary or reference table. Requires review and explicit field mapping before automation.',
        };

        return <<<MD
# Table Profile: {$name}
- **Connection**: #{$connection->id} ({$connection->name})
- **Database**: `{$connection->database_name}`
- **Eligibility Tier**: {$tier} (Automation Eligible: {$eligible})
- **Approximate Rows**: {$approxRows}
- **Primary Key**: {$pkStr}
- **Foreign Keys**: {$fkStr}
- **Workspace Notes**: {$notes}

## Columns & Constraints
{$colsFormatted}

## Operational Guidance
{$guidance}
MD;
    }

    /**
     * Index Table Profiles into the Python AI RAG service for semantic retrieval.
     */
    public function indexTableProfilesIntoRag(DbConnection $connection, array $tables): int
    {
        $indexed = 0;
        foreach ($tables as $index => $table) {
            $tableName = $table['name'] ?? '';
            try {
                if (!$tableName) continue;

                $profile = $this->generateTableProfileMarkdown($connection, $table);
                // Unique document ID derived from connection and index
                $docId = (int) (100000 + ($connection->id * 100) + ($index % 100));

                $this->aiClient->indexDocument(
                    userId: $connection->user_id,
                    docId: $docId,
                    title: "Table Profile: {$tableName}",
                    textContent: $profile,
                    fileType: 'md'
                );
                $indexed++;
            } catch (\Throwable $e) {
                Log::debug("[SchemaIntrospection] Failed to index Table Profile for {$tableName} into RAG: " . $e->getMessage());
            }
        }
        return $indexed;
    }

    /**
     * Compute difference between old snapshot and newly discovered schema.
     */
    protected function calculateSchemaDiff(array $oldSchema, array $newSchema): array
    {
        $oldTables = collect($oldSchema['tables'] ?? [])->keyBy('name');
        $newTables = collect($newSchema['tables'] ?? [])->keyBy('name');

        $addedTables = $newTables->keys()->diff($oldTables->keys())->values()->all();
        $removedTables = $oldTables->keys()->diff($newTables->keys())->values()->all();

        $modifiedTables = [];
        foreach ($newTables as $name => $table) {
            if ($oldTables->has($name)) {
                $oldCols = collect($oldTables[$name]['columns'])->pluck('name');
                $newCols = collect($table['columns'])->pluck('name');

                $addedCols = $newCols->diff($oldCols)->values()->all();
                $removedCols = $oldCols->diff($newCols)->values()->all();

                if (!empty($addedCols) || !empty($removedCols)) {
                    $modifiedTables[] = [
                        'table' => $name,
                        'added_columns' => $addedCols,
                        'removed_columns' => $removedCols,
                    ];
                }
            }
        }

        return [
            'has_changes' => (!empty($addedTables) || !empty($removedTables) || !empty($modifiedTables)),
            'added_tables' => $addedTables,
            'removed_tables' => $removedTables,
            'modified_tables' => $modifiedTables,
        ];
    }

    /**
     * Infer human-readable initial business concept.
     */
    protected function inferBusinessConcept(string $tableName): string
    {
        $clean = strtolower(str_replace(['_', '-'], ' ', $tableName));
        if (str_contains($clean, 'post') || str_contains($clean, 'blog') || str_contains($clean, 'article')) {
            return 'Editorial Content & Publications';
        }
        if (str_contains($clean, 'cat') || str_contains($clean, 'topic') || str_contains($clean, 'tag')) {
            return 'Taxonomy & Categorization';
        }
        if (str_contains($clean, 'prod') || str_contains($clean, 'item') || str_contains($clean, 'catalog')) {
            return 'E-Commerce Product Catalog';
        }
        if (str_contains($clean, 'user') || str_contains($clean, 'account') || str_contains($clean, 'auth')) {
            return 'Identity & Access Management (Restricted)';
        }
        return 'Business Entity Records';
    }

    /**
     * Generate helpful initial AI purpose suggestion based on table structure.
     */
    protected function generateInitialTablePurpose(string $tableName, string $tier, array $columns): string
    {
        if ($tier === 'RESTRICTED') {
            return "Contains sensitive credentials, authentication, or financial records. Excluded from automated writes by safety policy.";
        }

        $colList = implode(', ', array_slice(array_map(fn($c) => $c['name'], $columns), 0, 5));
        if ($tier === 'RECOMMENDED') {
            return "Primary content/catalog entity for articles, publications, or listings. Recommended for automated scheduled creation and enrichment ({$colList}).";
        }

        return "Auxiliary table or association mapping. Useful for relational references and metadata lookups.";
    }

    /**
     * Fetch real rows from target table to populate relational dropdowns and foreign key options.
     */
    public function getTableLookupRecords(DbConnection $connection, string $tableName, int $limit = 100, ?string $search = null): array
    {
        $this->safetyService->validateConnectionTarget($connection->host, $connection->port);

        $pdo = null;
        try {
            $pdo = $connection->createTargetPdo();
            $dbName = $connection->database_name;

            // 1. Discover columns and primary key of target table
            $colStmt = $pdo->prepare("
                SELECT column_name, column_key
                FROM information_schema.columns
                WHERE table_schema = :db_name AND table_name = :table_name
                ORDER BY ordinal_position ASC
            ");
            $colStmt->execute(['db_name' => $dbName, 'table_name' => $tableName]);
            $rawCols = $colStmt->fetchAll();

            if (empty($rawCols)) {
                return [];
            }

            $pkCol = 'id';
            $allCols = [];
            foreach ($rawCols as $rc) {
                $c = array_change_key_case($rc, CASE_LOWER);
                $name = $c['column_name'];
                $allCols[] = $name;
                if (($c['column_key'] ?? '') === 'PRI') {
                    $pkCol = $name;
                }
            }

            // 2. Pick best label candidate
            $labelCandidates = ['name', 'title', 'label', 'display_name', 'username', 'slug', 'category_name', 'topic', 'email', 'description'];
            $labelCol = $pkCol;
            foreach ($labelCandidates as $cand) {
                if (in_array($cand, $allCols, true)) {
                    $labelCol = $cand;
                    break;
                }
            }

            // 3. Query records safely with optional search filtering
            $params = [];
            $whereSql = "";
            if (!empty($search)) {
                $whereSql = "WHERE `{$labelCol}` LIKE :search OR CAST(`{$pkCol}` AS CHAR) LIKE :search_id";
                $params['search'] = '%' . trim($search) . '%';
                $params['search_id'] = trim($search) . '%';
            }

            $query = "SELECT `{$pkCol}` AS id, `{$labelCol}` AS label FROM `{$tableName}` {$whereSql} ORDER BY `{$pkCol}` ASC LIMIT " . (int) $limit;
            $stmt = $pdo->prepare($query);
            $stmt->execute($params);
            $results = $stmt->fetchAll(PDO::FETCH_ASSOC);

            return array_map(function ($row) {
                return [
                    'id' => $row['id'],
                    'label' => (string) ($row['label'] ?? $row['id']),
                    'value' => $row['id'],
                ];
            }, $results ?: []);
        } catch (Exception $e) {
            return [];
        } finally {
            $pdo = null;
        }
    }
}
