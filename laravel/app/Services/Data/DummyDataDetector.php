<?php

namespace App\Services\Data;

use App\Models\DbConnection;
use PDO;

class DummyDataDetector
{
    private const DUMMY_DOMAINS = [
        'example.com',
        'example.org',
        'example.net',
        'test.com',
        'mailinator.com',
        'yopmail.com',
        'fakemail.com',
        'demo.com',
        'ipsum.com',
        'asdf.com',
    ];

    private const DUMMY_NAME_PATTERNS = [
        '/^test(\s+user)?$/i',
        '/^asdf(\s+asdf)?$/i',
        '/^john\s+doe$/i',
        '/^jane\s+doe$/i',
        '/^demo(\s+account)?$/i',
        '/^lorem\s+ipsum/i',
        '/^fake\s+person$/i',
        '/^qwerty$/i',
        '/^user\d+$/i',
        '/^sample(\s+user)?$/i',
    ];

    private const DUMMY_PHONE_PATTERNS = [
        '/^1234567890$/',
        '/^0{7,15}$/',
        '/^1{7,15}$/',
        '/^9{7,15}$/',
    ];

    private const DUMMY_CONTENT_PATTERNS = [
        '/^lorem\s+ipsum/i',
        '/^test(\s+post|\s+test)?$/i',
        '/^asdf(asdf)?/i',
    ];

    public function __construct(
        protected TargetConnector $targetConnector,
        protected LiveSchemaService $schemaService,
        protected DataAccessPolicy $policy
    ) {}

    /**
     * Inspect a table's bounded sample and report likely dummy/test records with evidence.
     */
    public function detect(DbConnection $connection, string $tableName, int $sampleLimit = 200): array
    {
        $this->policy->assertCanReadTable($connection, $tableName);

        $catalog = $this->schemaService->getCatalog($connection);
        $tableMeta = $catalog['tables'][$tableName] ?? null;
        if (!$tableMeta) {
            throw new DataException('TABLE_NOT_FOUND', "Table '{$tableName}' not found in live schema.");
        }

        $pkCol = $tableMeta['primary_key'][0] ?? 'id';
        $driver = $connection->driver ?: 'mysql';
        $quote = $driver === 'postgres' ? '"' : '`';

        $pdo = $this->targetConnector->getReadOnlyPdo($connection);
        $stmt = $pdo->query("SELECT * FROM {$quote}{$tableName}{$quote} LIMIT {$sampleLimit}");
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        if (empty($rows)) {
            return [
                'table' => $tableName,
                'sample_size' => 0,
                'dummy_count' => 0,
                'confidence' => 'low',
                'suspected_ids' => [],
                'evidence' => ['Table is empty.'],
                'sample_records' => [],
            ];
        }

        // Detect burst timestamps
        $timestampCounts = [];
        foreach ($rows as $r) {
            foreach (['created_at', 'crt_dt', 'registered_at'] as $tCol) {
                if (!empty($r[$tCol])) {
                    $ts = (string) $r[$tCol];
                    $timestampCounts[$ts] = ($timestampCounts[$ts] ?? 0) + 1;
                }
            }
        }
        $burstTimestamps = array_keys(array_filter($timestampCounts, fn($cnt) => $cnt >= 3));

        $suspectedIds = [];
        $suspectedRows = [];
        $evidenceTypes = [];

        foreach ($rows as $row) {
            $rowScore = 0;
            $rowEvidence = [];
            $pkVal = $row[$pkCol] ?? null;

            // 1. Email check
            foreach ($row as $col => $val) {
                if (preg_match('/email|eml/i', $col) && is_string($val) && str_contains($val, '@')) {
                    $domain = strtolower(substr(strrchr($val, '@'), 1));
                    if (in_array($domain, self::DUMMY_DOMAINS, true)) {
                        $rowScore += 3;
                        $rowEvidence[] = "Disposable or test domain '@{$domain}'";
                        $evidenceTypes['dummy_domains'] = true;
                    }
                }
            }

            // 2. Name check
            foreach ($row as $col => $val) {
                if (preg_match('/name|author|title/i', $col) && is_string($val)) {
                    $vTrim = trim($val);
                    foreach (self::DUMMY_NAME_PATTERNS as $pat) {
                        if (preg_match($pat, $vTrim)) {
                            $rowScore += 3;
                            $rowEvidence[] = "Placeholder name '{$vTrim}'";
                            $evidenceTypes['dummy_names'] = true;
                            break;
                        }
                    }
                    foreach (self::DUMMY_CONTENT_PATTERNS as $pat) {
                        if (preg_match($pat, $vTrim)) {
                            $rowScore += 3;
                            $rowEvidence[] = "Placeholder title/content '{$vTrim}'";
                            $evidenceTypes['dummy_content'] = true;
                            break;
                        }
                    }
                }
            }

            // 3. Body/Content check
            foreach (['body', 'content', 'description'] as $bCol) {
                if (isset($row[$bCol]) && is_string($row[$bCol])) {
                    $vTrim = trim($row[$bCol]);
                    foreach (self::DUMMY_CONTENT_PATTERNS as $pat) {
                        if (preg_match($pat, $vTrim)) {
                            $rowScore += 3;
                            $rowEvidence[] = "Placeholder body text";
                            $evidenceTypes['dummy_content'] = true;
                            break;
                        }
                    }
                }
            }

            // 4. Phone check
            foreach ($row as $col => $val) {
                if (preg_match('/phone|mobile|contact/i', $col) && is_string($val)) {
                    $vTrim = trim($val);
                    foreach (self::DUMMY_PHONE_PATTERNS as $pat) {
                        if (preg_match($pat, $vTrim)) {
                            $rowScore += 2;
                            $rowEvidence[] = "Sequential/dummy phone number '{$vTrim}'";
                            $evidenceTypes['dummy_phones'] = true;
                            break;
                        }
                    }
                }
            }

            // 5. Burst timestamp check
            foreach (['created_at', 'crt_dt', 'registered_at'] as $tCol) {
                if (!empty($row[$tCol]) && in_array((string) $row[$tCol], $burstTimestamps, true)) {
                    $rowScore += 2;
                    $rowEvidence[] = "Created in a synchronized burst at {$row[$tCol]}";
                    $evidenceTypes['burst_timestamps'] = true;
                    break;
                }
            }

            if ($rowScore >= 2) {
                $suspectedIds[] = $pkVal;
                $suspectedRows[] = $row;
            }
        }

        // Formulate overall evidence and confidence
        $evidenceSummary = [];
        if (!empty($evidenceTypes['dummy_domains'])) {
            $evidenceSummary[] = "Found placeholder and test email domains (@example.com, @test.com, @mailinator.com, @demo.com).";
        }
        if (!empty($evidenceTypes['dummy_names'])) {
            $evidenceSummary[] = "Found known sample and placeholder names ('Test User', 'John Doe', 'Jane Doe', 'asdf').";
        }
        if (!empty($evidenceTypes['dummy_content'])) {
            $evidenceSummary[] = "Found generic filler text and lorem ipsum content.";
        }
        if (!empty($evidenceTypes['dummy_phones'])) {
            $evidenceSummary[] = "Found obviously fake or sequential telephone numbers (1234567890, 0000000000, 9999999999).";
        }
        if (!empty($evidenceTypes['burst_timestamps'])) {
            $evidenceSummary[] = "Found multiple accounts created at the exact same second from batch seed scripts.";
        }

        $dummyCount = count($suspectedIds);
        $confidence = 'low';
        if ($dummyCount > 0 && count($evidenceSummary) >= 2) {
            $confidence = 'high';
        } elseif ($dummyCount > 0) {
            $confidence = 'medium';
        }

        // Mask sample records
        $maskedSamples = $this->policy->maskResultRows(array_slice($suspectedRows, 0, 5));

        return [
            'table' => $tableName,
            'sample_size' => count($rows),
            'dummy_count' => $dummyCount,
            'confidence' => $confidence,
            'suspected_ids' => $suspectedIds,
            'evidence' => $evidenceSummary ?: ['No obvious placeholder patterns detected in sample.'],
            'sample_records' => $maskedSamples,
        ];
    }

    /**
     * Inspect one, several, or all recommended tables for dummy/test records.
     *
     * @param DbConnection $connection
     * @param array|string|null $tables Specific table, comma-separated list, 'recommended', 'all', or null
     * @param int $sampleLimit
     * @return array
     */
    public function detectAcrossTables(DbConnection $connection, array|string|null $tables = 'recommended', int $sampleLimit = 150): array
    {
        $catalog = $this->schemaService->getCatalog($connection);
        $allCatalogTables = $catalog['tables'] ?? [];

        // Check if single specific table requested
        if (is_string($tables)) {
            $tTrim = trim($tables);
            if ($tTrim !== '' && !in_array(strtolower($tTrim), ['all', 'recommended', 'content', 'required', 'useful'], true) && !str_contains($tTrim, ',')) {
                if (isset($allCatalogTables[$tTrim])) {
                    $single = $this->detect($connection, $tTrim, $sampleLimit);
                    $dummyCount = $single['dummy_count'] ?? 0;
                    $msg = $dummyCount > 0
                        ? "Analyzed table '{$tTrim}': detected {$dummyCount} likely dummy/test records with {$single['confidence']} confidence."
                        : "Analyzed table '{$tTrim}': no obvious dummy or placeholder records detected in sample.";
                    return array_merge($single, [
                        'summary_message' => $msg,
                        'safe_message' => $msg,
                        'total_tables_scanned' => 1,
                        'scanned_tables' => [$tTrim],
                        'tables_with_dummy_data' => $dummyCount > 0 ? [$single] : [],
                        'total_dummy_records' => $dummyCount,
                    ]);
                }
            }
        }

        // Determine list of target tables to scan
        $targetList = [];
        if (is_array($tables)) {
            $targetList = array_values(array_filter($tables, fn($t) => is_string($t) && isset($allCatalogTables[trim($t)])));
        } elseif (is_string($tables) && str_contains($tables, ',')) {
            $parts = array_map('trim', explode(',', $tables));
            $targetList = array_values(array_filter($parts, fn($t) => isset($allCatalogTables[$t])));
        }

        $mode = is_string($tables) ? strtolower(trim($tables)) : 'recommended';
        if (empty($targetList)) {
            if ($mode === 'all') {
                foreach ($allCatalogTables as $tName => $tMeta) {
                    if ($this->isReadableTable($connection, $tName) && ($tMeta['rows_estimate'] ?? 0) > 0) {
                        $targetList[] = $tName;
                    }
                    if (count($targetList) >= 25) break;
                }
            } else {
                // 'recommended', 'content', 'required', or default:
                $candidates = [];
                $snapshot = \App\Models\SchemaSnapshot::where('connection_id', $connection->id)->latest()->first();
                $recFromSnap = [];
                if ($snapshot && !empty($snapshot->schema_metadata['tables'])) {
                    foreach ($snapshot->schema_metadata['tables'] as $snapT) {
                        if (is_array($snapT) && in_array(strtoupper($snapT['category'] ?? ''), ['RECOMMENDED', 'PRIMARY', 'EDITORIAL'], true)) {
                            $recFromSnap[] = $snapT['table_name'] ?? ($snapT['name'] ?? '');
                        }
                    }
                }

                foreach ($allCatalogTables as $tName => $tMeta) {
                    if (!$this->isReadableTable($connection, $tName)) {
                        continue;
                    }
                    $rowsEst = $tMeta['rows_estimate'] ?? 0;
                    if ($rowsEst === 0) {
                        continue;
                    }

                    $score = 0;
                    if (in_array($tName, $recFromSnap, true)) {
                        $score += 10;
                    }
                    if (preg_match('/^(users?|customers?|profiles?|accounts?|members?)$/i', $tName)) {
                        $score += 15;
                    } elseif (preg_match('/(blog|post|article|comment|review|brand|categor|product|item|service|listing|faq|page)/i', $tName)) {
                        $score += 8;
                    }

                    foreach ($catalog['columns'] ?? [] as $col) {
                        if (($col['table'] ?? '') === $tName) {
                            $cName = $col['name'] ?? '';
                            if (preg_match('/email|mail/i', $cName)) $score += 6;
                            if (preg_match('/^(name|full_name|username|title|slug)$/i', $cName)) $score += 4;
                            if (preg_match('/body|content|description|bio/i', $cName)) $score += 3;
                            if (preg_match('/phone|mobile/i', $cName)) $score += 2;
                        }
                    }

                    if ($score > 0) {
                        $candidates[$tName] = $score;
                    }
                }

                arsort($candidates);
                $targetList = array_slice(array_keys($candidates), 0, 15);

                if (empty($targetList)) {
                    foreach ($allCatalogTables as $tName => $tMeta) {
                        if ($this->isReadableTable($connection, $tName) && ($tMeta['rows_estimate'] ?? 0) > 0) {
                            $targetList[] = $tName;
                        }
                        if (count($targetList) >= 8) break;
                    }
                }
            }
        }

        if (empty($targetList)) {
            $msg = "No suitable tables with data found to scan for dummy records in this database.";
            return [
                'success' => true,
                'total_tables_scanned' => 0,
                'scanned_tables' => [],
                'tables_with_dummy_data' => [],
                'total_dummy_records' => 0,
                'summary_message' => $msg,
                'safe_message' => $msg,
                'details' => [],
            ];
        }

        $scanned = [];
        $tablesWithDummies = [];
        $totalDummyCount = 0;
        $perTableReports = [];

        foreach ($targetList as $tName) {
            try {
                $report = $this->detect($connection, $tName, $sampleLimit);
                $scanned[] = $tName;
                $perTableReports[$tName] = $report;
                if (!empty($report['dummy_count']) && $report['dummy_count'] > 0) {
                    $tablesWithDummies[] = $report;
                    $totalDummyCount += $report['dummy_count'];
                }
            } catch (\Throwable $e) {
                continue;
            }
        }

        $scannedCount = count($scanned);
        if ($totalDummyCount > 0) {
            $breakdown = [];
            foreach ($tablesWithDummies as $item) {
                $breakdown[] = "'{$item['table']}' ({$item['dummy_count']} records)";
            }
            $breakdownStr = implode(', ', $breakdown);
            $msg = "Scanned {$scannedCount} table(s). Detected {$totalDummyCount} likely dummy/test record(s) across " . count($tablesWithDummies) . " table(s): {$breakdownStr}.";
        } else {
            $tableNamesStr = implode(', ', array_slice($scanned, 0, 5)) . ($scannedCount > 5 ? " and " . ($scannedCount - 5) . " more" : "");
            $msg = "Scanned {$scannedCount} table(s) ({$tableNamesStr}). No obvious dummy or placeholder records detected in samples.";
        }

        return [
            'success' => true,
            'total_tables_scanned' => $scannedCount,
            'scanned_tables' => $scanned,
            'tables_with_dummy_data' => $tablesWithDummies,
            'total_dummy_records' => $totalDummyCount,
            'summary_message' => $msg,
            'safe_message' => $msg,
            'details' => $perTableReports,
        ];
    }

    protected function isReadableTable(DbConnection $connection, string $tableName): bool
    {
        try {
            $this->policy->assertCanReadTable($connection, $tableName);
            return true;
        } catch (\Throwable) {
            return false;
        }
    }
}
