<?php

namespace App\Services\Automation;

use App\Models\Automation;
use App\Models\DbConnection;
use App\Services\Data\DataAccessPolicy;
use App\Services\DatabaseSafetyService;
use Illuminate\Support\Str;

/**
 * Validation shared by the automations API and Orbit's automation tools, so both paths
 * enforce exactly the same rules: table eligibility, the schedule model and mappings that
 * match the live schema.
 */
class AutomationConfigService
{
    public function __construct(
        protected DatabaseSafetyService $safety,
        protected DataAccessPolicy $accessPolicy,
        protected FieldPlanBuilder $planBuilder,
        protected ScheduleCalculator $schedule,
    ) {}

    /** Null when the table may be automated, otherwise a user-facing reason. */
    public function tableProblem(DbConnection $connection, string $table): ?string
    {
        if (!preg_match('/^[A-Za-z0-9_]+$/', $table)) {
            return "'{$table}' is not a valid table name.";
        }
        if (!in_array(strtolower((string) ($connection->db_type ?: 'mysql')), ['mysql', 'mariadb'], true)) {
            return "Automations can write to MySQL connections only; '{$connection->name}' is {$connection->db_type}.";
        }
        if ($this->safety->isTableSensitive($table)) {
            return "Table '{$table}' is restricted (accounts, credentials, payments and similar) and cannot be automated.";
        }
        $class = $this->accessPolicy->getTableClass($connection, $table);
        if ($class !== 'writable') {
            return "Table '{$table}' is {$class} for this connection and cannot be automated.";
        }
        return null;
    }

    /** Field => [messages] for mappings that do not fit the live schema (empty when valid). */
    public function schemaErrors(Automation $draft): array
    {
        $connection = $draft->connection;
        try {
            $pdo = $connection->createTargetPdo();
        } catch (\Throwable $e) {
            return ['field_mappings' => ["Could not reach '{$connection->name}' to check the table: " . Str::limit($e->getMessage(), 160)]];
        }
        try {
            $plan = $this->planBuilder->build($draft, $connection, $pdo);
        } catch (\Throwable $e) {
            return ['target_table' => [$e->getMessage()]];
        } finally {
            $pdo = null;
        }
        $errors = array_values(array_filter($plan['issues'], fn($i) => $i['level'] === 'error'));
        return empty($errors) ? [] : ['field_mappings' => array_map(fn($i) => $i['message'], $errors)];
    }

    /** Suggested mapping for every writable, non-secret column (what the builder pre-selects). */
    public function suggestedMappings(DbConnection $connection, string $table): array
    {
        $pdo = $connection->createTargetPdo();
        try {
            $plan = $this->planBuilder->suggest($connection, $pdo, $table);
        } finally {
            $pdo = null;
        }
        $out = [];
        foreach ($plan['columns'] as $c) {
            if (!$c['is_secret']) {
                $m = $c['suggested'];
                unset($m['reason']);
                $out[] = $m;
            }
        }
        return $out;
    }

    /** Validate schedule input (see ScheduleCalculator::validate). */
    public function validateSchedule(array $input): array
    {
        return $this->schedule->validate($input);
    }
}
