<?php

namespace App\Services\Data;

class AnswerComposer
{
    /**
     * Synthesize grounded plain-English answer and "How I got this" diagnostic panel.
     */
    public static function compose(
        string $utterance,
        array $queryPlan,
        array $readResult,
        array $assumptions = []
    ): array {
        $intent = $queryPlan['intent'] ?? 'list';
        $table = $queryPlan['tables'][0] ?? 'records';
        $rowCount = $readResult['row_count'] ?? 0;
        $timeMs = $readResult['execution_time_ms'] ?? 0;
        $rows = $readResult['rows'] ?? [];

        $headline = "";
        if ($intent === 'count') {
            $countVal = $rowCount;
            if (!empty($rows) && isset($rows[0]['total_count'])) {
                $countVal = $rows[0]['total_count'];
            } elseif (!empty($rows) && count($rows) === 1) {
                $firstVal = reset($rows[0]);
                if (is_numeric($firstVal)) {
                    $countVal = (int) $firstVal;
                }
            }
            $headline = "Found a total of {$countVal} {$table}.";
        } elseif ($intent === 'find_dummy_data') {
            $headline = "Analyzed {$table}: detected {$rowCount} likely dummy/test records.";
        } elseif ($rowCount === 0) {
            $headline = "No matching records found in {$table}.";
        } elseif ($rowCount === 1) {
            $headline = "Found 1 matching record in {$table}.";
        } else {
            $headline = "Found {$rowCount} records in {$table}.";
        }

        // Add filter summary to headline
        if (!empty($queryPlan['time_window']['label'])) {
            $headline .= " (for {$queryPlan['time_window']['label']})";
        }

        // Diagnostic "How I got this" details
        $diagnostics = [
            'sql' => $readResult['sql'] ?? '',
            'bindings' => $readResult['bindings'] ?? [],
            'execution_time_ms' => $timeMs,
            'assumptions' => array_merge($assumptions, $queryPlan['assumptions'] ?? []),
            'table' => $table,
        ];

        return [
            'headline' => $headline,
            'row_count' => $rowCount,
            'columns' => $readResult['columns'] ?? [],
            'rows' => array_slice($rows, 0, 50), // Send up to 50 for table display
            'diagnostics' => $diagnostics,
            'assumptions' => $diagnostics['assumptions'],
        ];
    }
}
