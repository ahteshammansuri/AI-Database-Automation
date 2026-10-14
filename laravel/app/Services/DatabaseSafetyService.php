<?php

namespace App\Services;

use Exception;

class DatabaseSafetyService
{
    /**
     * Forbidden SQL keywords strictly prohibited from executing against any target database.
     */
    protected const FORBIDDEN_SQL_PATTERNS = [
        '/\bDELETE\b/i',
        '/\bDROP\b/i',
        '/\bTRUNCATE\b/i',
        '/\bALTER\b/i',
        '/\bCREATE\s+(TABLE|DATABASE|VIEW|PROCEDURE|FUNCTION|TRIGGER|INDEX)\b/i',
        '/\bRENAME\b/i',
        '/\bGRANT\b/i',
        '/\bREVOKE\b/i',
        '/\bEXEC(UTE)?\b/i',
        '/\bCALL\b/i',
    ];

    /**
     * Table names classified as sensitive / restricted by default.
     */
    protected const SENSITIVE_TABLE_PATTERNS = [
        'user',
        'users',
        'account',
        'accounts',
        'auth',
        'password',
        'passwords',
        'credential',
        'credentials',
        'session',
        'sessions',
        'token',
        'tokens',
        'oauth',
        'role',
        'roles',
        'permission',
        'permissions',
        'payment',
        'payments',
        'transaction',
        'transactions',
        'billing',
        'credit_card',
        'credit_cards',
        'invoice',
        'invoices',
        'wallet',
        'wallets',
        'financial',
        'audit',
        'audits',
        'audit_log',
        'audit_logs',
        'log',
        'logs',
        'migration',
        'migrations',
    ];

    /**
     * Prohibited SSRF destinations.
     */
    protected const BLOCKED_IPS = [
        '169.254.169.254', // AWS/GCP/Azure link-local metadata
        '0.0.0.0',
    ];

    /**
     * Dangerous internal service ports prohibited for customer database connection targets.
     */
    protected const BLOCKED_PORTS = [
        22,    // SSH
        23,    // Telnet
        25,    // SMTP
        110,   // POP3
        143,   // IMAP
        2375,  // Docker daemon
        2376,  // Docker daemon TLS
        2379,  // Etcd
        6379,  // Redis
        6443,  // Kubernetes API
        8500,  // Consul
        9200,  // Elasticsearch
        11211, // Memcached
    ];

    /**
     * Validate host and port to prevent SSRF and network abuse.
     */
    public function validateConnectionTarget(string $host, int $port): void
    {
        $cleanHost = trim($host);

        if (empty($cleanHost)) {
            throw new Exception("Host cannot be empty.");
        }

        if (in_array($cleanHost, self::BLOCKED_IPS, true)) {
            throw new Exception("Security violation: Connection to metadata IP '{$cleanHost}' is prohibited.");
        }

        // Port boundary check
        if ($port < 1 || $port > 65535) {
            throw new Exception("Invalid port number: {$port}.");
        }

        // Reject dangerous / cloud metadata ports
        if (in_array($port, self::BLOCKED_PORTS, true)) {
            throw new Exception("Port {$port} is prohibited for database connections.");
        }
    }

    /**
     * Check if a table is sensitive and restricted from target database automations.
     * Uses token boundary matching to avoid false positives on tables like blog_category or blog_posts.
     */
    public function isTableSensitive(string $tableName): bool
    {
        $lower = strtolower(trim($tableName));
        $tokens = preg_split('/[_\-\s]+/', $lower);

        foreach (self::SENSITIVE_TABLE_PATTERNS as $pattern) {
            // Exact full table match
            if ($lower === $pattern) {
                return true;
            }
            // Exact token match (e.g. audit_log has token 'log', but blog_category has token 'blog')
            if (in_array($pattern, $tokens, true)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Deterministic Four-Tier Table Eligibility Classifier:
     * - RECOMMENDED: Content/catalog tables with descriptive text fields, low relational friction.
     * - REVIEW_REQUIRED: Complex relations, junction/pivot tables, or non-null FK dependencies.
     * - RESTRICTED: Matches security deny patterns (auth, credentials, payments, logs).
     * - READ_ONLY: Auxiliary lookup tables or reference datasets.
     */
    public function classifyTableEligibility(string $tableName, array $columns = [], array $relationships = []): array
    {
        $isSensitive = $this->isTableSensitive($tableName);

        if ($isSensitive) {
            return [
                'tier' => 'RESTRICTED',
                'eligible' => false,
                'is_sensitive' => true,
                'restriction_reason' => 'Security policy: Table contains sensitive authentication, credentials, financial, or system audit data.',
                'evidence' => [
                    'Matched hard-deny security policy rules',
                    'Zero write access permitted by control plane policy',
                ],
                'recommendation_score' => 0,
            ];
        }

        $colNames = array_map(function ($c) {
            if (is_array($c)) {
                return strtolower($c['name'] ?? '');
            }
            return strtolower((string) $c);
        }, $columns);
        $fkCount = count($relationships);

        // Detect content/catalog fields
        $contentKeywords = ['title', 'name', 'content', 'body', 'excerpt', 'description', 'summary', 'text', 'slug', 'article', 'post', 'topic'];
        $hasContentFields = false;
        $matchedFields = [];

        foreach ($colNames as $cName) {
            foreach ($contentKeywords as $kw) {
                if (str_contains($cName, $kw)) {
                    $hasContentFields = true;
                    $matchedFields[] = $cName;
                }
            }
        }
        $matchedFields = array_unique($matchedFields);

        // Check if table is a pure junction/association pivot table (e.g. post_tags)
        $isPivot = false;
        if (count($colNames) <= 4 && $fkCount >= 2) {
            $isPivot = true;
        }

        if ($isPivot) {
            return [
                'tier' => 'REVIEW_REQUIRED',
                'eligible' => false,
                'is_sensitive' => false,
                'restriction_reason' => null,
                'evidence' => [
                    'Junction/pivot association table linking multiple foreign entities',
                    "Foreign key count: {$fkCount}",
                    'Requires parent records to be created and linked explicitly',
                ],
                'recommendation_score' => 45,
            ];
        }

        if ($hasContentFields) {
            $hasLongFormContent = false;
            foreach ($colNames as $c) {
                if (in_array($c, ['content', 'body', 'markdown', 'article', 'post_content', 'entry', 'text'], true)) {
                    $hasLongFormContent = true;
                    break;
                }
            }

            $recScore = $hasLongFormContent ? 98 : 88;

            if ($fkCount <= 2) {
                return [
                    'tier' => 'RECOMMENDED',
                    'eligible' => true,
                    'is_sensitive' => false,
                    'restriction_reason' => null,
                    'evidence' => [
                        'Detected rich content/editorial columns: ' . implode(', ', array_slice($matchedFields, 0, 4)),
                        "Manageable relational dependencies ({$fkCount} foreign key" . ($fkCount === 1 ? '' : 's') . ')',
                        'Passed all hard-deny security inspections',
                    ],
                    'recommendation_score' => $recScore,
                ];
            } else {
                return [
                    'tier' => 'REVIEW_REQUIRED',
                    'eligible' => false,
                    'is_sensitive' => false,
                    'restriction_reason' => 'Complex relational dependencies: Table has more than 2 foreign key constraints.',
                    'evidence' => [
                        "High foreign key count ({$fkCount})",
                        'Requires coordinated multi-table relational planning',
                    ],
                    'recommendation_score' => 60,
                ];
            }
        }

        // Fallback for non-content tables
        return [
            'tier' => 'REVIEW_REQUIRED',
            'eligible' => false,
            'is_sensitive' => false,
            'restriction_reason' => null,
            'evidence' => [
                'No primary editorial text fields detected',
                'Table may be a reference lookup or auxiliary catalog',
            ],
            'recommendation_score' => 30,
        ];
    }

    /**
     * Hard security interceptor: Inspect a raw SQL statement before execution.
     * Throws an exception if any forbidden keyword is found.
     */
    public function assertQueryIsSafe(string $sql): void
    {
        foreach (self::FORBIDDEN_SQL_PATTERNS as $regex) {
            if (preg_match($regex, $sql)) {
                throw new Exception("Security violation: Target database operation contains prohibited keyword or statement ({$regex}).");
            }
        }
    }
}
