<?php

namespace App\Services\Agent\Tools;

use App\Jobs\GenerateAutomationContentJob;
use App\Jobs\PublishAutomationContentJob;
use App\Models\AuditLog;
use App\Models\Automation;
use App\Models\AutomationExecution;
use App\Models\ContentVersion;
use App\Models\DbConnection;
use App\Models\User;
use App\Services\Automation\AutomationConfigService;
use App\Services\Automation\ContentPipeline;
use App\Services\Automation\FieldPlanBuilder;
use App\Services\Automation\ScheduleCalculator;
use App\Services\Data\ColumnClassifier;
use App\Services\SafeDatabaseExecutor;
use Carbon\CarbonImmutable;
use Illuminate\Support\Str;

/**
 * Orbit's automation, execution and approval tools. They use the same jobs, status transitions
 * and validation as the portal's own endpoints, so anything Orbit does is exactly what a user
 * click would do. Ownership of every id has already been checked by ToolPolicyGate.
 */
class AutomationTools
{
    // ------------------------------------------------------------------
    // Automations
    // ------------------------------------------------------------------

    public static function list(User $user): array
    {
        $rows = Automation::where('user_id', $user->id)
            ->with('connection:id,name,database_name')
            ->withCount('executions')
            ->latest('id')
            ->get()
            ->map(function (Automation $a) {
                $s = $a->scheduleSummary();
                return [
                    'id' => $a->id,
                    'name' => $a->name,
                    'target_table' => $a->target_table,
                    'connection' => $a->connection?->name,
                    'mode' => $a->operation_mode,
                    'state' => $s['state'],
                    'schedule' => $s['description'],
                    'next_run_local' => $s['next_run']['generation_local'] ?? null,
                    'runs_finished' => $s['finished_runs'],
                    'total_runs' => $s['total_runs'],
                    'requires_approval' => (bool) $a->requires_approval,
                ];
            });

        return [
            'success' => true,
            'automations' => $rows,
            'total' => $rows->count(),
            'message' => $rows->isEmpty() ? 'There are no automations yet.' : "Found {$rows->count()} automation(s).",
        ];
    }

    public static function details(User $user, array $args): array
    {
        $a = Automation::where('user_id', $user->id)->with('connection:id,name,database_name')->find($args['automation_id'] ?? 0);
        if (!$a) {
            return ['success' => false, 'error' => 'Automation not found.'];
        }
        $mappings = array_map(fn($m) => [
            'column' => $m['field_name'] ?? null,
            'how' => $m['mapping_type'] ?? null,
            'value' => $m['fixed_value'] ?? null,
            'parent_policy' => $m['relation_config']['creation_policy'] ?? null,
        ], is_array($a->field_mappings) ? array_values($a->field_mappings) : []);

        return [
            'success' => true,
            'automation' => [
                'id' => $a->id,
                'name' => $a->name,
                'target_table' => $a->target_table,
                'connection' => $a->connection?->name,
                'mode' => $a->operation_mode,
                'topic' => $a->prompt_context,
                'model' => trim(($a->ai_provider ?? '') . ' ' . ($a->ai_model ?? '')),
                'generation_options' => $a->generation_options,
                'requires_approval' => (bool) $a->requires_approval,
                'reviewer_email' => $a->reviewer_email,
                'no_response_policy' => $a->timeout_policy,
                'is_active' => (bool) $a->is_active,
                'field_mappings' => $mappings,
            ],
            'schedule' => $a->scheduleSummary(),
            'message' => "Automation '{$a->name}' writes into {$a->target_table}.",
        ];
    }

    /** Create an automation from conversation details; unspecified columns get the builder's safe defaults. */
    public static function create(User $user, array $args): array
    {
        $config = app(AutomationConfigService::class);
        $conn = DbConnection::where('user_id', $user->id)->find((int) ($args['connection_id'] ?? 0));
        if (!$conn) {
            return ['success' => false, 'error' => 'That connection does not exist in your workspace.'];
        }
        $table = trim((string) ($args['target_table'] ?? ''));
        $name = trim((string) ($args['name'] ?? ''));
        if ($name === '' || $table === '') {
            return ['success' => false, 'error' => 'A name and a target table are required.'];
        }
        if ($problem = $config->tableProblem($conn, $table)) {
            return ['success' => false, 'error' => $problem];
        }

        $tz = $args['timezone'] ?? null;
        $check = $config->validateSchedule([
            'schedule_type' => $args['schedule_type'] ?? 'DAILY',
            'start_date' => $args['start_date'] ?? null,
            'end_date' => $args['end_date'] ?? null,
            'weekly_days' => $args['weekly_days'] ?? [],
            'generation_time' => $args['generation_time'] ?? '08:30',
            'publication_time' => $args['publication_time'] ?? '09:00',
            'timezone' => $tz ?: 'UTC',
        ]);
        if (!empty($check['errors'])) {
            return ['success' => false, 'error' => 'Schedule problem: ' . implode(' ', $check['errors']), 'fields' => $check['errors']];
        }

        try {
            $mappings = !empty($args['field_mappings']) && is_array($args['field_mappings'])
                ? $args['field_mappings']
                : $config->suggestedMappings($conn, $table);
        } catch (\Throwable $e) {
            return ['success' => false, 'error' => 'Could not read the table: ' . Str::limit($e->getMessage(), 160)];
        }

        $manual = ($args['operation_mode'] ?? 'AI_CREATE') === 'MANUAL_SCHEDULE';
        $topic = trim((string) ($args['topic_prompt'] ?? ''));
        if (!empty($args['category_name'])) {
            // Steer the AI-chosen parent toward the named category; it is matched or created at run time.
            foreach ($mappings as &$m) {
                if (($m['mapping_type'] ?? '') === 'AI_GENERATED' && str_contains((string) ($m['field_name'] ?? ''), 'categor')) {
                    $m['instructions'] = "Use the category named \"{$args['category_name']}\".";
                }
            }
            unset($m);
        }

        $draft = new Automation([
            'user_id' => $user->id,
            'connection_id' => $conn->id,
            'name' => mb_substr($name, 0, 255),
            'target_table' => $table,
            'operation_mode' => $manual ? 'MANUAL_SCHEDULE' : 'AI_CREATE',
            'field_mappings' => $mappings,
            'ai_provider' => $manual ? 'none' : ($args['ai_provider'] ?? 'ollama'),
            'ai_model' => $manual ? null : ($args['ai_model'] ?? null),
            'prompt_context' => $topic !== '' ? $topic : null,
            'generation_options' => array_filter([
                'tone' => $args['tone'] ?? null,
                'length' => in_array($args['length'] ?? null, ['short', 'medium', 'long'], true) ? $args['length'] : null,
                'content_format' => in_array($args['content_format'] ?? null, ['markdown', 'html'], true) ? $args['content_format'] : null,
                'image_provider' => in_array($args['image_provider'] ?? null, ['auto', 'openai', 'gemini', 'local'], true) ? $args['image_provider'] : null,
            ]) ?: null,
            'schedule_type' => $check['values']['schedule_type'],
            'start_date' => $check['values']['start_date'],
            'end_date' => $check['values']['end_date'],
            'weekly_days' => $check['values']['weekly_days'],
            'generation_time' => $check['values']['generation_time'],
            'publication_time' => $check['values']['publication_time'],
            'timezone' => $check['values']['timezone'],
            'requires_approval' => (bool) ($args['requires_approval'] ?? true),
            'reviewer_email' => !empty($args['reviewer_email']) && filter_var($args['reviewer_email'], FILTER_VALIDATE_EMAIL) ? $args['reviewer_email'] : $user->email,
            'timeout_policy' => in_array($args['timeout_policy'] ?? null, ['AUTO_PUBLISH_LATEST', 'KEEP_DRAFT', 'CANCEL'], true) ? $args['timeout_policy'] : 'KEEP_DRAFT',
            'is_active' => (bool) ($args['is_active'] ?? true),
        ]);
        $draft->setRelation('connection', $conn);

        if ($errors = $config->schemaErrors($draft)) {
            return ['success' => false, 'error' => implode(' ', array_merge(...array_values($errors)))];
        }

        $draft->schedule_anchor_at = now();
        $draft->save();
        AuditLog::log($user->id, 'AGENT_AUTOMATION_CREATED', 'Automation', (string) $draft->id, [
            'name' => $draft->name, 'target_table' => $draft->target_table, 'schedule' => $draft->schedule_type,
        ]);

        $summary = $draft->scheduleSummary();
        return [
            'success' => true,
            'automation_id' => $draft->id,
            'name' => $draft->name,
            'target_table' => $draft->target_table,
            'schedule' => $summary['description'],
            'next_run_local' => $summary['next_run']['generation_local'] ?? null,
            'message' => "Created '{$draft->name}'. {$summary['description']}",
        ];
    }

    public static function update(User $user, array $args): array
    {
        $a = Automation::where('user_id', $user->id)->with('connection')->find($args['automation_id'] ?? 0);
        if (!$a) {
            return ['success' => false, 'error' => 'Automation not found.'];
        }
        $config = app(AutomationConfigService::class);
        $wasActive = (bool) $a->is_active;

        foreach (['name', 'reviewer_email', 'timeout_policy'] as $k) {
            if (isset($args[$k]) && $args[$k] !== '') {
                $a->{$k} = $args[$k];
            }
        }
        if (isset($args['topic_prompt'])) {
            $a->prompt_context = trim((string) $args['topic_prompt']) ?: null;
        }
        if (isset($args['is_active'])) {
            $a->is_active = (bool) $args['is_active'];
        }
        if (isset($args['requires_approval'])) {
            $a->requires_approval = (bool) $args['requires_approval'];
        }
        $opts = is_array($a->generation_options) ? $a->generation_options : [];
        foreach (['tone', 'length', 'content_format', 'image_provider'] as $k) {
            if (isset($args[$k]) && $args[$k] !== '') {
                $opts[$k] = $args[$k];
            }
        }
        $a->generation_options = $opts ?: null;

        $scheduleKeys = array_intersect(array_keys($args), Automation::SCHEDULE_FIELDS);
        if ($scheduleKeys) {
            $input = [];
            foreach (Automation::SCHEDULE_FIELDS as $k) {
                $input[$k] = array_key_exists($k, $args) ? $args[$k] : $a->{$k};
            }
            $check = $config->validateSchedule($input);
            if (!empty($check['errors'])) {
                return ['success' => false, 'error' => 'Schedule problem: ' . implode(' ', $check['errors'])];
            }
            foreach ($check['values'] as $k => $v) {
                $a->{$k} = $v;
            }
        }

        $scheduleChanged = $a->isDirty(Automation::SCHEDULE_FIELDS);
        if ($scheduleChanged || (!$wasActive && $a->is_active)) {
            $a->schedule_anchor_at = now();
            if ($scheduleChanged) {
                $a->completed_at = null;
            }
        }
        $changed = array_keys($a->getDirty());
        if (empty($changed)) {
            return ['success' => true, 'automation_id' => $a->id, 'message' => 'Nothing to change.'];
        }
        $a->save();
        AuditLog::log($user->id, 'AGENT_AUTOMATION_UPDATED', 'Automation', (string) $a->id, ['fields' => $changed]);

        return [
            'success' => true,
            'automation_id' => $a->id,
            'changed' => $changed,
            'schedule' => $a->scheduleSummary()['description'],
            'message' => "Updated '{$a->name}' (" . implode(', ', $changed) . ').',
        ];
    }

    public static function delete(User $user, array $args): array
    {
        $a = Automation::where('user_id', $user->id)->find($args['automation_id'] ?? 0);
        if (!$a) {
            return ['success' => false, 'error' => 'Automation not found.'];
        }
        $name = $a->name;
        $id = $a->id;
        $a->delete();
        AuditLog::log($user->id, 'AGENT_AUTOMATION_DELETED', 'Automation', (string) $id, ['name' => $name]);
        return ['success' => true, 'automation_id' => $id, 'message' => "Deleted the automation '{$name}'. Rows it already published stay in your database."];
    }

    /** Same as the "Run now" button: generate now, publish after the usual gap. */
    public static function runNow(User $user, array $args): array
    {
        $a = Automation::where('user_id', $user->id)->find($args['automation_id'] ?? 0);
        if (!$a) {
            return ['success' => false, 'error' => 'Automation not found.'];
        }
        if ($a->schedule_type === ScheduleCalculator::TYPE_NONE) {
            return ['success' => false, 'error' => 'This is the manual-publishing container; use Manual Publishing to post a record.'];
        }
        $gap = max(ScheduleCalculator::minGapMinutes(), (int) (ScheduleCalculator::gapMinutes($a->generation_time, $a->publication_time) ?? 30));
        $execution = AutomationExecution::create([
            'user_id' => $user->id,
            'automation_id' => $a->id,
            'status' => 'PENDING_GENERATION',
            'trigger_type' => 'MANUAL',
            'idempotency_key' => "agent_run_{$a->id}_" . now()->format('Ymd_His') . '_' . Str::random(6),
            'publication_time' => now()->addMinutes($gap),
            'lease_expires_at' => now()->addMinutes(15),
        ]);
        $tz = ScheduleCalculator::normalizeTimezone($a->timezone);
        $at = CarbonImmutable::instance($execution->publication_time)->setTimezone($tz)->format('H:i');
        $execution->addTimelineEvent('MANUAL_TRIGGER', "Run started by Orbit for you. It publishes at {$at} ({$tz})" . ($a->requires_approval ? ' after approval.' : '.'));
        GenerateAutomationContentJob::dispatch($execution->id);
        AuditLog::log($user->id, 'AGENT_AUTOMATION_TRIGGERED', 'AutomationExecution', (string) $execution->id, ['automation_id' => $a->id]);

        return [
            'success' => true,
            'execution_id' => $execution->id,
            'status' => 'PENDING_GENERATION',
            'publishes_at_local' => "{$at} {$tz}",
            'message' => "Started run #{$execution->id} of '{$a->name}' in the background. It will publish at {$at} ({$tz})" . ($a->requires_approval ? ' once approved.' : '.'),
        ];
    }

    /** Real pipeline dry run for a saved automation (no database writes). */
    public static function preview(User $user, array $args): array
    {
        $a = Automation::where('user_id', $user->id)->with('connection')->find($args['automation_id'] ?? 0);
        if (!$a) {
            return ['success' => false, 'error' => 'Name the automation to preview (automation_id).'];
        }
        try {
            $res = app(ContentPipeline::class)->run($a, ['include_images' => (bool) ($args['include_images'] ?? false)]);
        } catch (\Throwable $e) {
            return ['success' => false, 'error' => 'The preview could not be generated: ' . Str::limit($e->getMessage(), 240)];
        }
        $plan = $res['meta']['write_plan'];
        $title = null;
        foreach ($res['meta']['fields'] as $f) {
            if ($f['kind'] === 'title' && isset($res['payload'][$f['column']])) {
                $title = $res['payload'][$f['column']];
                break;
            }
        }
        return [
            'success' => true,
            'title' => $title,
            'values' => array_map(fn($v) => is_string($v) ? Str::limit($v, 160) : $v, $res['payload']),
            'relations' => $res['meta']['relations'],
            'write_steps' => array_map(fn($s) => "{$s['action']} {$s['table']}", $plan['steps']),
            'can_publish' => $plan['can_publish'],
            'issues' => array_map(fn($i) => $i['message'], $res['meta']['issues']),
            'message' => $plan['can_publish'] ? 'Preview generated; nothing was written.' : 'Preview generated, but it could not be published as is; see issues.',
        ];
    }

    // ------------------------------------------------------------------
    // Executions
    // ------------------------------------------------------------------

    public static function listExecutions(User $user, array $args): array
    {
        $q = AutomationExecution::where('user_id', $user->id)->with(['automation:id,name,target_table,timezone', 'versions'])->latest('id');
        if (!empty($args['status'])) {
            $q->where('status', strtoupper((string) $args['status']));
        }
        if (!empty($args['automation_id'])) {
            $q->where('automation_id', (int) $args['automation_id']);
        }
        if (!empty($args['automation_name'])) {
            $q->whereHas('automation', fn($w) => $w->where('name', 'like', '%' . $args['automation_name'] . '%'));
        }
        $limit = max(1, min((int) ($args['limit'] ?? 10), 50));
        $rows = $q->limit($limit)->get()->map(fn(AutomationExecution $e) => self::executionRow($e));

        return [
            'success' => true,
            'executions' => $rows,
            'total' => $rows->count(),
            'message' => $rows->isEmpty() ? 'No runs match.' : "Found {$rows->count()} run(s).",
        ];
    }

    public static function executionStatus(User $user, array $args): array
    {
        $e = AutomationExecution::where('user_id', $user->id)->with(['automation:id,name,target_table,timezone', 'versions'])->find($args['execution_id'] ?? 0);
        if (!$e) {
            return ['success' => false, 'error' => 'Run not found.'];
        }
        $versions = $e->versions->sortBy('version_number')->map(function (ContentVersion $v) {
            $meta = is_array($v->meta) ? $v->meta : [];
            return [
                'version_id' => $v->id,
                'version' => $v->version_number,
                'status' => $v->status,
                'title' => self::titleOf($v),
                'feedback' => $v->rejection_feedback,
                'write_steps' => array_map(fn($s) => "{$s['action']} {$s['table']}", $meta['write_plan']['steps'] ?? []),
                'relations' => $meta['relations'] ?? [],
                'images' => count($meta['media'] ?? []),
                'issues' => array_map(fn($i) => $i['message'], array_slice($meta['issues'] ?? [], 0, 5)),
            ];
        })->values();

        return [
            'success' => true,
            'run' => self::executionRow($e),
            'error' => $e->error_message,
            'failure_category' => $e->failure_category,
            'versions' => $versions,
            'recent_events' => array_map(fn($t) => ['stage' => $t['stage'] ?? '', 'message' => Str::limit((string) ($t['message'] ?? ''), 200), 'at' => $t['timestamp'] ?? null],
                array_slice($e->timeline_events ?? [], -8)),
            'message' => "Run #{$e->id} is {$e->status}.",
        ];
    }

    public static function retry(User $user, array $args): array
    {
        $e = AutomationExecution::where('user_id', $user->id)->with('automation')->find($args['execution_id'] ?? 0);
        if (!$e) {
            return ['success' => false, 'error' => 'Run not found.'];
        }
        if ($e->status === 'PUBLISHED') {
            return ['success' => false, 'error' => 'That run is already published; start a new run instead.'];
        }
        if (in_array($e->status, AutomationExecution::IN_FLIGHT_STATUSES, true)) {
            return ['success' => false, 'error' => "Run #{$e->id} is already {$e->status}."];
        }
        $updates = ['status' => 'QUEUED', 'retry_count' => ($e->retry_count ?? 0) + 1, 'error_message' => null, 'failure_category' => null, 'lease_expires_at' => now()->addMinutes(15)];
        if (!$e->publication_time || $e->publication_time->isPast()) {
            $updates['publication_time'] = now()->addMinutes($e->automation?->requires_approval ? 30 : 15);
        }
        $e->update($updates);
        $e->addTimelineEvent('USER_RETRY_TRIGGERED', 'Retry requested through Orbit.');
        GenerateAutomationContentJob::dispatch($e->id);
        AuditLog::log($user->id, 'EXECUTION_RETRIED', 'AutomationExecution', (string) $e->id, ['via' => 'orbit']);
        return ['success' => true, 'execution_id' => $e->id, 'status' => 'QUEUED', 'message' => "Run #{$e->id} is generating again in the background."];
    }

    /** Facts about a failed run; the model explains them in plain words. */
    public static function explainFailure(User $user, array $args): array
    {
        $q = AutomationExecution::where('user_id', $user->id)->whereIn('status', ['FAILED', 'MISSED', 'SKIPPED', 'CANCELLED'])->latest('id');
        if (!empty($args['execution_id'])) {
            $q->where('id', (int) $args['execution_id']);
        }
        $e = $q->with(['automation:id,name,target_table', 'versions'])->first();
        if (!$e) {
            return ['success' => true, 'message' => 'There are no failed, missed or skipped runs.'];
        }
        $latest = $e->versions->sortByDesc('version_number')->first();
        $issues = $latest && is_array($latest->meta) ? array_map(fn($i) => $i['message'], array_filter($latest->meta['issues'] ?? [], fn($i) => ($i['level'] ?? '') === 'error')) : [];
        return [
            'success' => true,
            'execution_id' => $e->id,
            'automation' => $e->automation?->name,
            'status' => $e->status,
            'failure_category' => $e->failure_category,
            'error_message' => $e->error_message,
            'validation_errors' => array_values($issues),
            'last_events' => array_map(fn($t) => ($t['stage'] ?? '') . ': ' . Str::limit((string) ($t['message'] ?? ''), 200), array_slice($e->timeline_events ?? [], -4)),
            'can_retry' => !in_array($e->status, ['PUBLISHED'], true),
            'message' => "Run #{$e->id} ended as {$e->status}" . ($e->failure_category ? " ({$e->failure_category})" : '') . '.',
        ];
    }

    public static function updatePublishedRecord(User $user, array $args): array
    {
        $e = AutomationExecution::where('user_id', $user->id)->with('automation.connection')->find($args['execution_id'] ?? 0);
        if (!$e || $e->status !== 'PUBLISHED' || empty($e->target_record_id)) {
            return ['success' => false, 'error' => 'Only a published run with a known record id can be edited.'];
        }
        $fields = array_filter((array) ($args['fields'] ?? []), fn($k) => is_string($k) && !in_array($k, ['id', 'created_at'], true) && !ColumnClassifier::isSecret($k), ARRAY_FILTER_USE_KEY);
        if (empty($fields)) {
            return ['success' => false, 'error' => 'Say which fields to change.'];
        }
        $a = $e->automation;
        try {
            $res = app(SafeDatabaseExecutor::class)->executeScopedUpdate($a->connection, $a->target_table, 'id', $e->target_record_id, $fields);
        } catch (\Throwable $ex) {
            return ['success' => false, 'error' => Str::limit($ex->getMessage(), 240)];
        }
        AuditLog::log($user->id, 'PUBLISHED_RECORD_UPDATED', 'AutomationExecution', (string) $e->id, ['fields' => array_keys($fields), 'via' => 'orbit']);
        return ['success' => true, 'rows_affected' => $res['rows_affected'] ?? null, 'message' => "Updated {$a->target_table} #{$e->target_record_id}: " . implode(', ', array_keys($fields)) . '.'];
    }

    // ------------------------------------------------------------------
    // Approvals
    // ------------------------------------------------------------------

    public static function pendingApprovals(User $user): array
    {
        $rows = ContentVersion::where('user_id', $user->id)
            ->awaitingDecision()
            ->with('execution.automation:id,name,target_table,timezone')
            ->latest('id')
            ->get()
            ->map(function (ContentVersion $v) {
                $e = $v->execution;
                $tz = ScheduleCalculator::normalizeTimezone($e?->automation?->timezone);
                return [
                    'version_id' => $v->id,
                    'version' => $v->version_number,
                    'execution_id' => $e?->id,
                    'automation' => $e?->automation?->name,
                    'target_table' => $e?->automation?->target_table,
                    'title' => self::titleOf($v),
                    'publishes_at_local' => $e?->publication_time ? CarbonImmutable::instance($e->publication_time)->setTimezone($tz)->format('D j M H:i') . " {$tz}" : null,
                    'can_publish' => (bool) (($v->meta['can_publish'] ?? true)),
                ];
            });

        return ['success' => true, 'pending' => $rows, 'count' => $rows->count(),
            'message' => $rows->isEmpty() ? 'Nothing is waiting for approval.' : "{$rows->count()} draft(s) are waiting for approval."];
    }

    public static function approve(User $user, array $args): array
    {
        $v = ContentVersion::where('user_id', $user->id)->with('execution.automation')->find($args['version_id'] ?? 0);
        if (!$v) {
            return ['success' => false, 'error' => 'Draft not found.'];
        }
        $e = $v->execution;
        if ($why = self::notReviewable($v)) {
            return ['success' => false, 'error' => $why];
        }
        if (is_array($v->meta) && array_key_exists('can_publish', $v->meta) && !$v->meta['can_publish']) {
            return ['success' => false, 'error' => 'This draft has validation errors and cannot be published.'];
        }
        $v->update(['status' => 'APPROVED']);
        $publishNow = $e->publication_time && $e->publication_time->isPast();
        $e->update(['status' => $publishNow ? 'PUBLISHING' : 'APPROVED', 'lease_expires_at' => $publishNow ? now()->addMinutes(10) : null]);
        $e->addTimelineEvent('APPROVED_VIA_ORBIT', "Version #{$v->version_number} approved through Orbit.");
        AuditLog::log($user->id, 'VERSION_APPROVED', 'ContentVersion', (string) $v->id, ['execution_id' => $e->id, 'via' => 'orbit']);
        if ($publishNow) {
            PublishAutomationContentJob::dispatch($e->id);
        }
        $tz = ScheduleCalculator::normalizeTimezone($e->automation?->timezone);
        return [
            'success' => true,
            'version_id' => $v->id,
            'execution_id' => $e->id,
            'message' => $publishNow
                ? "Approved version {$v->version_number}; it is being published now."
                : "Approved version {$v->version_number}; it will publish on " . CarbonImmutable::instance($e->publication_time)->setTimezone($tz)->format('D j M \a\t H:i') . " ({$tz}).",
        ];
    }

    public static function reject(User $user, array $args): array
    {
        $v = ContentVersion::where('user_id', $user->id)->with('execution')->find($args['version_id'] ?? 0);
        if (!$v) {
            return ['success' => false, 'error' => 'Draft not found.'];
        }
        if ($why = self::notReviewable($v)) {
            return ['success' => false, 'error' => $why];
        }
        $e = $v->execution;
        $feedback = trim((string) ($args['feedback'] ?? '')) ?: 'Please revise the draft.';
        $v->update(['status' => 'REJECTED', 'rejection_feedback' => $feedback]);
        AuditLog::log($user->id, 'VERSION_REJECTED', 'ContentVersion', (string) $v->id, ['execution_id' => $e->id, 'feedback' => $feedback, 'via' => 'orbit']);

        if (ContentVersion::where('execution_id', $e->id)->where('status', 'REJECTED')->count() >= 3) {
            $e->update(['status' => 'FAILED', 'failure_category' => 'MAX_REJECTIONS_EXCEEDED', 'error_message' => 'Rejected three times; stopped. Edit the automation or start a new run.']);
            return ['success' => true, 'message' => 'Rejected. This was the third rejection, so the run stopped instead of rewriting again.'];
        }
        $e->update(['status' => 'REGENERATING']);
        $e->addTimelineEvent('REGENERATION_REQUESTED', "Rejected through Orbit with feedback: \"{$feedback}\".");
        GenerateAutomationContentJob::dispatch($e->id, $feedback);
        return ['success' => true, 'version_id' => $v->id, 'message' => "Rejected version {$v->version_number}. A new version is being written with your feedback."];
    }

    // ------------------------------------------------------------------

    private static function notReviewable(ContentVersion $v): ?string
    {
        $e = $v->execution;
        if ($v->status !== 'PENDING_APPROVAL') {
            return "This draft is no longer waiting for review (it is {$v->status}).";
        }
        if (!$e || in_array($e->status, array_merge(AutomationExecution::TERMINAL_STATUSES, ['PUBLISHING', 'GENERATING', 'REGENERATING']), true)) {
            return 'The run is ' . strtolower((string) $e?->status) . ', so it can no longer be approved or rejected.';
        }
        return null;
    }

    private static function titleOf(ContentVersion $v): ?string
    {
        $payload = is_array($v->payload) ? $v->payload : [];
        foreach ((is_array($v->meta) ? ($v->meta['fields'] ?? []) : []) as $f) {
            if (($f['kind'] ?? '') === 'title' && !empty($payload[$f['column']])) {
                return Str::limit((string) $payload[$f['column']], 120);
            }
        }
        foreach (['title', 'name', 'headline', 'question'] as $k) {
            if (!empty($payload[$k]) && is_string($payload[$k])) {
                return Str::limit($payload[$k], 120);
            }
        }
        return null;
    }

    private static function executionRow(AutomationExecution $e): array
    {
        $tz = ScheduleCalculator::normalizeTimezone($e->automation?->timezone);
        $local = fn($t) => $t ? CarbonImmutable::instance($t)->setTimezone($tz)->format('D j M H:i') . " {$tz}" : null;
        $latest = $e->versions->sortByDesc('version_number')->first();
        return [
            'id' => $e->id,
            'automation_id' => $e->automation_id,
            'automation' => $e->automation?->name,
            'target_table' => $e->automation?->target_table,
            'status' => $e->status,
            'trigger' => $e->trigger_type ?? 'SCHEDULE',
            'title' => $latest ? self::titleOf($latest) : null,
            'versions' => $e->versions->count(),
            'publishes_at' => $local($e->publication_time),
            'published_at' => $local($e->published_at),
            'record_id' => $e->target_record_id,
            'error' => $e->error_message ? Str::limit($e->error_message, 200) : null,
            'created_at' => $local($e->created_at),
        ];
    }
}
