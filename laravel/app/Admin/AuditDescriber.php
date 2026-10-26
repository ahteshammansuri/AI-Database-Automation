<?php

namespace App\Admin;

use App\Models\AuditLog;

/**
 * Customer audit entries as one plain sentence (same wording as the customer's own audit page), for the admin
 * activity log and its CSV export. Unknown actions fall back to their name in plain case.
 */
final class AuditDescriber
{
    public static function describe(AuditLog $log): string
    {
        $m = (array) ($log->metadata ?? []);
        $q = fn ($v) => $v ? "“{$v}”" : '';
        $rows = fn ($n) => ((int) $n) . ' row' . ((int) $n === 1 ? '' : 's');
        $changed = isset($m['changes']) && is_array($m['changes']) ? array_keys($m['changes']) : [];
        $fields = $changed ? ': ' . implode(', ', $changed) : '';
        $id = $log->resource_id;

        return match ($log->action) {
            'USER_REGISTERED' => 'Created their account',
            'USER_LOGIN' => 'Signed in',
            'PROFILE_UPDATED' => 'Updated their profile' . $fields,
            'PASSWORD_CHANGED' => 'Changed their password' . (!empty($m['other_sessions_signed_out']) ? " and signed out {$m['other_sessions_signed_out']} other session(s)" : ''),
            'SESSIONS_SIGNED_OUT' => 'Signed out ' . ((int) ($m['count'] ?? 0)) . ' other session(s)',
            'ACCOUNT_SUSPENDED' => 'Account suspended by an admin' . (!empty($m['reason']) ? ": {$m['reason']}" : ''),
            'ACCOUNT_REACTIVATED' => 'Account reactivated by an admin',
            'AUDIT_LOG_EXPORTED' => 'Exported their audit log',
            'CONNECTION_CREATED' => 'Added the connection ' . $q($m['name'] ?? null) . (isset($m['database']) ? " ({$m['database']})" : ''),
            'CONNECTION_UPDATED' => 'Changed the connection ' . $q($m['name'] ?? null) . $fields,
            'CONNECTION_DELETED' => "Removed connection #{$id}",
            'CONNECTION_TABLE_ACCESS_CHANGED' => 'Set ' . ($m['table'] ?? 'a table') . ' to ' . (($m['after'] ?? '') === 'writable' ? 'editable' : 'view only'),
            'AUTOMATION_CREATED' => 'Created the automation ' . $q($m['name'] ?? null) . (isset($m['table']) ? " for {$m['table']}" : ''),
            'AUTOMATION_UPDATED' => 'Changed the automation ' . ($q($m['name'] ?? null) ?: "#{$id}") . $fields,
            'AUTOMATION_DELETED' => "Deleted automation #{$id}",
            'AUTOMATION_TRIGGERED' => "Started run #{$id} now",
            'AUTOMATION_SCHEDULE_COMPLETED' => 'An automation schedule reached its end date',
            'SCHEDULED_RUN_MISSED' => 'A scheduled run' . (isset($m['run_date']) ? " on {$m['run_date']}" : '') . ' was missed',
            'EXECUTION_RETRIED' => "Retried run #{$id}",
            'VERSION_GENERATED' => 'Draft version ' . ($m['version_number'] ?? '') . ' written' . (!empty($m['requires_approval']) ? ', waiting for approval' : ''),
            'APPROVAL_EMAIL_SENT' => !empty($m['error']) ? 'The approval email to ' . ($m['recipient'] ?? '') . ' could not be sent' : 'Sent the approval email to ' . ($m['recipient'] ?? ''),
            'VERSION_APPROVED' => 'Approved draft version ' . ($m['version_number'] ?? '') . (!empty($m['publish_now']) ? ' and published it right away' : ''),
            'VERSION_REJECTED' => 'Sent draft version ' . ($m['version_number'] ?? '') . ' back' . (isset($m['feedback']) ? ': “' . mb_strimwidth((string) $m['feedback'], 0, 80, '…') . '”' : ''),
            'CONTENT_AUTO_APPROVED_TIMEOUT' => 'Published automatically at the deadline (nobody decided)',
            'TARGET_RECORD_PUBLISHED' => 'Published row #' . ($m['record_id'] ?? '?') . ' to ' . ($m['target_table'] ?? 'a table'),
            'PUBLISHED_RECORD_UPDATED' => 'Edited published row #' . ($m['record_id'] ?? '?') . ' in ' . ($m['target_table'] ?? 'a table'),
            'MANUAL_PUBLISH_EXECUTED' => 'Published row #' . ($m['record_id'] ?? '?') . ' to ' . ($m['table'] ?? 'a table') . ' manually',
            'data.read_executed' => 'Ran a read-only question (' . $rows($m['row_count'] ?? 0) . ')' . (!empty($m['pii_revealed']) ? ', personal data revealed' : ''),
            'data.insert_executed' => 'Added ' . $rows($m['affected_count'] ?? 0) . ' to ' . ($m['table'] ?? 'a table'),
            'data.update_executed' => 'Updated ' . $rows($m['affected_count'] ?? 0) . ' in ' . ($m['table'] ?? 'a table'),
            'data.delete_executed' => 'Deleted ' . $rows($m['affected_count'] ?? 0) . ' from ' . ($m['table'] ?? 'a table'),
            'data.insert_undone', 'data.update_undone', 'data.delete_undone' => 'Undid a change in ' . ($m['table'] ?? 'a table'),
            'data.write_refused', 'data.delete_refused' => 'A ' . ($m['operation'] ?? ($log->action === 'data.delete_refused' ? 'delete' : 'write')) . ' on ' . ($m['table'] ?? 'a table') . ' was refused (' . str((string) ($m['reason'] ?? ''))->replace('_', ' ') . ')',
            'AI_PROVIDER_CONFIGURED' => 'Set up ' . ($m['provider_type'] ?? 'a provider') . (isset($m['model_name']) ? " ({$m['model_name']})" : '') . (!empty($m['api_key_replaced']) ? ' with a new API key' : ''),
            'MODEL_ROLE_UPDATED' => 'Chose ' . ($m['provider'] ?? '') . ' ' . ($m['model_name'] ?? '') . ' for ' . (['planner' => 'Orbit and planning', 'generator' => 'Writing content'][$m['role'] ?? ''] ?? ($m['role'] ?? 'a role')),
            'KNOWLEDGE_DOC_INDEXED' => 'Added ' . $q($m['title'] ?? null) . ' to the knowledge base',
            'MEDIA_UPLOADED' => 'Uploaded an image',
            'ORBIT_REMOTE_PAIRING_CREATED' => 'Started pairing a phone with Orbit',
            'ORBIT_REMOTE_PAIRED' => 'Paired a phone with Orbit',
            'ORBIT_REMOTE_ENDED' => 'Ended the phone session',
            'ORBIT_REMOTE_COMMAND' => 'Sent a ' . ($m['kind'] ?? '') . ' command to Orbit from the phone',
            'AGENT_CONNECTION_SAVED' => 'Orbit added the connection ' . $q($m['name'] ?? null),
            'AGENT_AUTOMATION_CREATED' => 'Orbit created the automation ' . $q($m['name'] ?? null),
            default => (string) str($log->action)->replace(['_', '.'], ' ')->lower()->ucfirst(),
        };
    }

    /**
     * "field: from → to" lines from the entry's recorded changes.
     *
     * @return list<string>
     */
    public static function changes(AuditLog $log): array
    {
        $changes = $log->metadata['changes'] ?? null;
        if (!is_array($changes)) {
            return [];
        }
        $show = fn ($v) => $v === null || $v === '' ? 'empty' : (is_scalar($v) ? (string) $v : json_encode($v));

        return array_map(
            fn ($field, $d) => "{$field}: " . $show($d['from'] ?? null) . ' → ' . $show($d['to'] ?? null),
            array_keys($changes),
            $changes,
        );
    }

    /** A spreadsheet must not run a cell that starts with = + - @ as a formula. */
    public static function csvCell(mixed $v): mixed
    {
        return is_string($v) && preg_match('/^[=+\-@\t\r]/', $v) ? "'" . $v : $v;
    }
}
