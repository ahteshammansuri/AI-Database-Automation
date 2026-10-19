<?php

namespace App\Services\Data;

class ColumnClassifier
{
    // Whole-token matches where a bare substring would misfire (e.g. "company" contains "pan",
    // "passenger" contains "pass", "hashtag" contains "hash").
    private const SECRET_PATTERNS = [
        '/password|passwd|passphrase|passcode/i',
        '/(^|_)pass($|_)/i',
        '/pwd/i',
        '/hash(?!tag)/i',
        '/token/i',
        '/secret/i',
        '/api[_-]?key/i',
        '/auth[_-]?key/i',
        '/private[_-]?key/i',
        '/card[_-]?(?:number|no|num)/i',
        '/cvv/i',
        '/(^|_)ssn($|_)/i',
        '/aadhaa?r/i',
        '/(^|_)pan($|_|no|num)/i',
        // One-time, verification, reset and recovery codes; two-factor secrets.
        '/(^|_)otp($|_)/i',
        '/verifi\w*code/i',
        '/(reset|recovery|backup|activation|confirmation|security)[_-]?(code|answer)/i',
        '/two[_-]?factor|(^|_)(2fa|mfa)($|_)/i',
        '/(^|_)pin($|_)/i',
    ];

    private const PII_PATTERNS = [
        '/email/i',
        '/eml/i',
        '/phone/i',
        '/mobile/i',
        '/telephone/i',
        '/contact[_-]?(?:no|num)/i',
        '/ip[_-]?addr(?:ess)?/i',
    ];

    private const CREATED_PATTERNS = [
        '/created[_-]?at/i',
        '/crt[_-]?dt/i',
        '/creation[_-]?date/i',
        '/registered[_-]?at/i',
        '/reg[_-]?dt/i',
        '/signup[_-]?(?:at|date)/i',
    ];

    private const UPDATED_PATTERNS = [
        '/updated[_-]?at/i',
        '/upd[_-]?dt/i',
        '/modified[_-]?at/i',
    ];

    private const DELETED_PATTERNS = [
        '/deleted[_-]?at/i',
        '/del[_-]?dt/i',
        '/is[_-]?deleted/i',
    ];

    private const PUBLISHED_PATTERNS = [
        '/published[_-]?at/i',
        '/pub[_-]?dt/i',
    ];

    private const LABEL_PATTERNS = [
        '/^name$/i',
        '/^title$/i',
        '/usr[_-]?nm/i',
        '/full[_-]?name/i',
        '/label/i',
        '/heading/i',
    ];

    public static function classify(string $columnName, string $dataType = ''): array
    {
        $name = strtolower(trim($columnName));

        // 1. Data classification
        $class = 'standard';
        foreach (self::SECRET_PATTERNS as $p) {
            if (preg_match($p, $name)) {
                $class = 'secret';
                break;
            }
        }
        if ($class === 'standard') {
            foreach (self::PII_PATTERNS as $p) {
                if (preg_match($p, $name)) {
                    $class = 'pii';
                    break;
                }
            }
        }

        // 2. Temporal role
        $temporal = null;
        if (preg_match('/date|time|timestamp/i', $dataType) || preg_match('/_at$|_dt$|date|time/i', $name)) {
            if (self::matchesAny($name, self::DELETED_PATTERNS)) {
                $temporal = 'deleted';
            } elseif (self::matchesAny($name, self::PUBLISHED_PATTERNS)) {
                $temporal = 'published';
            } elseif (self::matchesAny($name, self::CREATED_PATTERNS)) {
                $temporal = 'created';
            } elseif (self::matchesAny($name, self::UPDATED_PATTERNS)) {
                $temporal = 'updated';
            } else {
                $temporal = 'event';
            }
        }

        // 3. Soft delete indicator
        $isSoftDelete = self::matchesAny($name, self::DELETED_PATTERNS) ||
            ($name === 'status' || $name === 'active' || $name === 'is_active');

        // 4. Human-readable label
        $isLabel = self::matchesAny($name, self::LABEL_PATTERNS);

        return [
            'class' => $class, // 'secret' | 'pii' | 'standard'
            'temporal_role' => $temporal, // 'created' | 'updated' | 'deleted' | 'published' | 'event' | null
            'is_soft_delete' => $isSoftDelete,
            'is_label' => $isLabel,
        ];
    }

    public static function isSecret(string $columnName): bool
    {
        return self::classify($columnName)['class'] === 'secret';
    }

    public static function isPii(string $columnName): bool
    {
        return self::classify($columnName)['class'] === 'pii';
    }

    public static function mask(mixed $value, string $columnName): mixed
    {
        if ($value === null || $value === '') {
            return $value;
        }
        $name = strtolower($columnName);
        $val = (string) $value;

        if (self::isSecret($name)) {
            return '[REDACTED]';
        }

        if (preg_match('/email|eml/i', $name) && str_contains($val, '@')) {
            [$local, $domain] = explode('@', $val, 2);
            $visible = mb_substr($local, 0, 1);
            return $visible . '***@' . $domain;
        }

        if (preg_match('/phone|mobile|tel|contact/i', $name)) {
            $len = strlen($val);
            if ($len <= 4) {
                return '****';
            }
            return substr($val, 0, 2) . str_repeat('*', max(2, $len - 4)) . substr($val, -2);
        }

        if (self::isPii($name)) {
            $len = strlen($val);
            if ($len <= 3) {
                return '***';
            }
            return substr($val, 0, 1) . '***' . substr($val, -1);
        }

        return $value;
    }

    private static function matchesAny(string $subject, array $patterns): bool
    {
        foreach ($patterns as $p) {
            if (preg_match($p, $subject)) {
                return true;
            }
        }
        return false;
    }
}
