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
}
