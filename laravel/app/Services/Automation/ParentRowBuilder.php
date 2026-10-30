<?php

namespace App\Services\Automation;

use Illuminate\Support\Str;

/**
 * Builds the row for a new parent record (for example a category that a new post needs) from the
 * parent table's live schema. It fills the label column, a slug, an optional description and
 * timestamps, and then every remaining required column with the safest neutral value its type
 * allows. It refuses (returns an error issue) rather than guessing when a required column cannot be
 * filled honestly: another foreign key, or a secret column.
 */
class ParentRowBuilder
{
    private const ACTIVE_WORDS = ['active', 'published', 'publish', 'enabled', 'visible', 'live', 'public', 'approved', 'on', 'yes', '1'];

    /**
     * @return array{values: array<string, mixed>, issues: array<int, array{level: string, column: ?string, message: string}>, label_column: ?string}
     */
    public function build(array $parentInfo, string $label, ?string $description = null, string $dbTimezone = 'UTC', array $given = []): array
    {
        $values = [];
        $issues = [];
        $table = $parentInfo['table'] ?? 'parent';
        $labelCol = TargetTableInspector::labelColumn($parentInfo);

        if ($labelCol === null) {
            $issues[] = ['level' => 'error', 'column' => null, 'message' => "Table `{$table}` has no name or title column, so a new record cannot be named."];
            return ['values' => [], 'issues' => $issues, 'label_column' => null];
        }

        $now = now($dbTimezone)->format('Y-m-d H:i:s');
        $label = trim(preg_replace('/\s+/', ' ', $label));

        foreach ($parentInfo['columns'] as $name => $c) {
            if ($c['auto_increment'] || $c['generated']) {
                continue;
            }

            if ($name === $labelCol) {
                $values[$name] = $this->fit($label, $c);
                continue;
            }

            // Values the person entered for the new record (already checked against the column by the executor).
            if (array_key_exists($name, $given) && !$c['is_secret']) {
                $values[$name] = $given[$name];
                continue;
            }

            if ($c['is_secret']) {
                if ($c['required']) {
                    $issues[] = ['level' => 'error', 'column' => $name, 'message' => "`{$table}`.`{$name}` is a protected column that automations never write, but it is required. Create this record yourself or choose an existing one."];
                }
                continue;
            }

            if ($c['kind'] === 'slug') {
                $values[$name] = $this->fit(Str::slug($label) ?: Str::lower(Str::random(8)), $c);
                continue;
            }

            if (in_array($c['kind'], ['body', 'summary'], true) && $description !== null && trim($description) !== '') {
                $values[$name] = $this->fit(trim($description), $c);
                continue;
            }

            if ($c['kind'] === 'datetime' && preg_match('/^(created|updated)(_at|_on|_date)?$/', $name)) {
                $values[$name] = $c['data_type'] === 'date' ? substr($now, 0, 10) : $now;
                continue;
            }

            if (!$c['required']) {
                continue; // nullable or has a default: let the database decide
            }

            if ($c['foreign_key']) {
                $issues[] = ['level' => 'error', 'column' => $name, 'message' => "`{$table}`.`{$name}` must reference a `{$c['foreign_key']['table']}` record, which automations will not guess. Create the record yourself or choose an existing one."];
                continue;
            }

            switch ($c['kind']) {
                case 'enum':
                    $values[$name] = $this->preferredEnum($c['enum_values']);
                    break;
                case 'boolean':
                    $values[$name] = preg_match('/(active|enabled|visible|published|public|status)/', $name) ? 1 : 0;
                    break;
                case 'number':
                    $values[$name] = 0;
                    $issues[] = ['level' => 'info', 'column' => $name, 'message' => "`{$name}` set to 0 (required, no default)."];
                    break;
                case 'datetime':
                    $values[$name] = $c['data_type'] === 'date' ? substr($now, 0, 10) : ($c['data_type'] === 'time' ? substr($now, 11) : $now);
                    break;
                case 'json':
                    $values[$name] = '{}';
                    break;
                case 'title':
                case 'meta_title':
                    $values[$name] = $this->fit($label, $c);
                    break;
                case 'body':
                case 'summary':
                case 'meta_description':
                    $values[$name] = $this->fit($description && trim($description) !== '' ? trim($description) : $label, $c);
                    break;
                default:
                    $values[$name] = '';
                    $issues[] = ['level' => 'info', 'column' => $name, 'message' => "`{$name}` set to empty text (required, no default)."];
            }
        }

        return ['values' => $values, 'issues' => $issues, 'label_column' => $labelCol];
    }

    private function preferredEnum(array $options): string
    {
        foreach (self::ACTIVE_WORDS as $word) {
            foreach ($options as $opt) {
                if (strtolower((string) $opt) === $word) {
                    return (string) $opt;
                }
            }
        }
        return (string) ($options[0] ?? '');
    }

    private function fit(string $value, array $col): string
    {
        $max = $col['max_length'] ?? null;
        if ($max !== null && mb_strlen($value) > $max) {
            return rtrim(mb_substr($value, 0, $max));
        }
        return $value;
    }
}
