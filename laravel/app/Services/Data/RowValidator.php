<?php

namespace App\Services\Data;

use Carbon\Carbon;

/**
 * Checks values for one row against a table's live columns before any write is previewed: unknown, secret,
 * generated and auto-numbered columns, required values, types (numbers, booleans, dates, JSON), lengths and enum
 * values. Values typed by a person and values written by the AI go through the same rules (AI output is untrusted).
 */
class RowValidator
{
    /**
     * @param  array  $tableMeta  one table from LiveSchemaService::getCatalog()['tables']
     * @param  bool  $insert  true: every required column must be present; false (update): only the given columns
     * @return array{0: array<string, mixed>, 1: array<string, string>} clean row (normalised values), errors by column
     */
    public function validate(array $tableMeta, array $row, bool $insert): array
    {
        $columns = $tableMeta['columns'] ?? [];
        $pk = $tableMeta['primary_key'] ?? [];
        $clean = [];
        $errors = [];

        foreach ($row as $name => $value) {
            $name = (string) $name;
            $col = $columns[$name] ?? null;
            if (!$col) {
                $errors[$name] = "There is no column “{$name}” in this table.";
                continue;
            }
            if (ColumnClassifier::isSecret($name)) {
                $errors[$name] = 'This column holds secrets and is never written.';
                continue;
            }
            if (!empty($col['generated'])) {
                $errors[$name] = 'The database computes this column.';
                continue;
            }
            if (!$insert && in_array($name, $pk, true)) {
                $errors[$name] = 'The row id cannot be changed.';
                continue;
            }
            if ($insert && !empty($col['auto']) && $value !== null && $value !== '') {
                $errors[$name] = 'The database assigns this number automatically.';
                continue;
            }
            if ($insert && !empty($col['auto'])) {
                continue;
            }

            [$normalized, $problem] = $this->normalize($col, $value);
            if ($problem) {
                $errors[$name] = $problem;
                continue;
            }
            $clean[$name] = $normalized;
        }

        if ($insert) {
            foreach ($columns as $name => $col) {
                if (isset($errors[$name]) || array_key_exists($name, $clean)) {
                    continue;
                }
                if (!empty($col['auto']) || !empty($col['generated']) || ColumnClassifier::isSecret($name)) {
                    continue;
                }
                if (empty($col['nullable']) && $col['default'] === null) {
                    $errors[$name] = 'Required: the table needs a value here.';
                }
            }
        }

        return [$clean, $errors];
    }

    /** @return array{0: mixed, 1: ?string} value ready for the database, or a problem in plain words */
    public function normalize(array $col, mixed $value): array
    {
        $family = $col['family'] ?? 'other';
        $isEmpty = $value === null || (is_string($value) && trim($value) === '' && !in_array($family, ['string', 'text'], true));

        if ($isEmpty) {
            if (empty($col['nullable'])) {
                return [null, $col['default'] !== null ? null : 'Required: the table needs a value here.'];
            }
            return [null, null];
        }

        switch ($family) {
            case 'integer':
                if (is_bool($value) || !preg_match('/^[+-]?\d+$/', trim((string) $value))) {
                    return [null, 'Enter a whole number.'];
                }
                $n = (int) $value;
                if ($n < 0 && str_contains(strtolower((string) ($col['raw_type'] ?? '')), 'unsigned')) {
                    return [null, 'This number cannot be negative.'];
                }
                return [$n, null];
            case 'decimal':
                if (!is_numeric($value)) {
                    return [null, 'Enter a number.'];
                }
                $s = (string) $value;
                $scale = $col['scale'] ?? null;
                if ($scale !== null && str_contains($s, '.') && strlen(rtrim(explode('.', $s)[1], '0')) > $scale) {
                    return [null, "Use at most {$scale} decimal place" . ($scale === 1 ? '' : 's') . '.'];
                }
                if ((float) $value < 0 && str_contains(strtolower((string) ($col['raw_type'] ?? '')), 'unsigned')) {
                    return [null, 'This number cannot be negative.'];
                }
                return [$s, null];
            case 'boolean':
                $b = filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
                return $b === null ? [null, 'Use yes or no.'] : [$b ? 1 : 0, null];
            case 'enum':
                $allowed = $col['enum'] ?? [];
                return in_array((string) $value, $allowed, true) ? [(string) $value, null] : [null, 'Choose one of: ' . implode(', ', $allowed) . '.'];
            case 'date':
                $d = $this->parseDate((string) $value, 'Y-m-d');
                return $d ? [$d, null] : [null, 'Enter a date like 2026-10-22.'];
            case 'time':
                return preg_match('/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/', trim((string) $value)) ? [strlen(trim((string) $value)) === 5 ? trim((string) $value) . ':00' : trim((string) $value), null] : [null, 'Enter a time like 09:30.'];
            case 'timestamp_tz':
            case 'timestamp_naive':
                $d = $this->parseDate((string) $value, 'Y-m-d H:i:s');
                return $d ? [$d, null] : [null, 'Enter a date and time like 2026-10-22 09:30.'];
            case 'json':
                if (is_array($value)) {
                    return [json_encode($value, JSON_UNESCAPED_UNICODE), null];
                }
                json_decode((string) $value);
                return json_last_error() === JSON_ERROR_NONE ? [(string) $value, null] : [null, 'This must be valid JSON.'];
            case 'binary':
                return [null, 'Binary data cannot be edited here.'];
            default:
                if (is_array($value) || is_object($value)) {
                    return [null, 'Enter text.'];
                }
                $s = (string) $value;
                $max = $col['max_length'] ?? null;
                if ($max !== null && mb_strlen($s) > $max) {
                    return [null, "At most {$max} characters (this has " . mb_strlen($s) . ').'];
                }
                if (($col['data_type'] ?? '') === 'set') {
                    $allowed = $col['enum'] ?? [];
                    foreach (array_filter(array_map('trim', explode(',', $s))) as $part) {
                        if (!in_array($part, $allowed, true)) {
                            return [null, 'Use only: ' . implode(', ', $allowed) . '.'];
                        }
                    }
                }
                return [$s, null];
        }
    }

    private function parseDate(string $value, string $format): ?string
    {
        $value = trim($value);
        $pattern = $format === 'Y-m-d' ? '/^\d{4}-\d{2}-\d{2}$/' : '/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/';
        if (!preg_match($pattern, $value)) {
            return null;
        }
        try {
            $d = Carbon::parse($value);
        } catch (\Throwable) {
            return null;
        }
        // Reject dates PHP silently rolled over (2026-02-31 -> March).
        if ($d->format('Y-m-d') !== substr(str_replace('T', ' ', $value), 0, 10)) {
            return null;
        }
        return $d->format($format);
    }
}
