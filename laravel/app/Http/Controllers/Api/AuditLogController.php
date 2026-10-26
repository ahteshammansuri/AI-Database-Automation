<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AgentToolCall;
use App\Models\AuditLog;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * The customer's own audit trail: filtered list, what Orbit did on their behalf (each tool call with the request it
 * served, its outcome and whether it changed anything), and a CSV export. Always scoped to the signed-in user.
 */
class AuditLogController extends Controller
{
    /** Action patterns per category (SQL LIKE; "_" escaped so it matches only an underscore). */
    public const CATEGORIES = [
        'connections' => ['CONNECTION\_%', 'AGENT\_CONNECTION\_%', 'SCHEMA\_%'],
        'automations' => ['AUTOMATION\_%', 'SCHEDULED\_RUN\_%', 'EXECUTION\_%', 'VERSION\_GENERATED', 'TARGET\_RECORD\_%', 'MANUAL\_PUBLISH%', 'PUBLISHED\_RECORD\_%', 'AGENT\_AUTOMATION\_%'],
        'approvals' => ['VERSION\_APPROVED', 'VERSION\_REJECTED', 'APPROVAL\_%', 'CONTENT\_AUTO\_APPROVED%'],
        'data' => ['data.%'],
        'ai' => ['AI\_PROVIDER\_%', 'MODEL\_ROLE\_%', 'KNOWLEDGE\_%', 'MEDIA\_%'],
        'account' => ['USER\_%', 'ACCOUNT\_%', 'PASSWORD\_%', 'PROFILE\_%', 'AUDIT\_LOG\_%'],
        'orbit' => ['ORBIT\_%', 'AGENT\_%'],
    ];

    private const EXPORT_LIMIT = 10000;

    private function filtered(Request $request): Builder
    {
        $v = $request->validate([
            'category' => 'nullable|string|in:' . implode(',', array_keys(self::CATEGORIES)),
            'search' => 'nullable|string|max:100',
            'from' => 'nullable|date',
            'to' => 'nullable|date',
        ]);

        return AuditLog::where('user_id', $request->user()->id)
            ->when($v['category'] ?? null, function (Builder $q, string $cat) {
                $q->where(function (Builder $w) use ($cat) {
                    foreach (self::CATEGORIES[$cat] as $pattern) {
                        $w->orWhere('action', 'like', $pattern);
                    }
                });
            })
            ->when($v['search'] ?? null, function (Builder $q, string $term) {
                $like = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $term) . '%';
                $q->where(fn (Builder $w) => $w->where('action', 'like', $like)->orWhere('resource_type', 'like', $like)->orWhere('resource_id', 'like', $like));
            })
            ->when($v['from'] ?? null, fn (Builder $q, string $d) => $q->where('created_at', '>=', \Carbon\Carbon::parse($d)->startOfDay()))
            ->when($v['to'] ?? null, fn (Builder $q, string $d) => $q->where('created_at', '<=', \Carbon\Carbon::parse($d)->endOfDay()));
    }

    public function index(Request $request)
    {
        $logs = $this->filtered($request)->orderByDesc('id')->paginate(30);

        return response()->json($logs);
    }

    /** What Orbit did for this customer: one row per tool call, with the request it served and the outcome. */
    public function orbit(Request $request)
    {
        $request->validate(['search' => 'nullable|string|max:100']);
        $calls = AgentToolCall::where('user_id', $request->user()->id)
            ->with('task:id,goal,status,created_at')
            ->when($request->query('search'), function (Builder $q, string $term) {
                $like = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $term) . '%';
                $q->where(fn (Builder $w) => $w->where('tool', 'like', $like)->orWhereHas('task', fn ($t) => $t->where('goal', 'like', $like)));
            })
            ->orderByDesc('id')
            ->paginate(30);

        $calls->getCollection()->transform(fn (AgentToolCall $c) => [
            'id' => $c->id,
            'at' => $c->created_at?->toIso8601String(),
            'request' => $c->task?->goal ? mb_substr((string) $c->task->goal, 0, 400) : null,
            'task_id' => $c->task_id,
            'tool' => $c->tool,
            'args' => $c->args_redacted,
            'status' => $c->status,
            'outcome' => is_array($c->result_sanitized) ? ($c->result_sanitized['safe_message'] ?? $c->result_sanitized['message'] ?? null) : null,
            'resource_refs' => is_array($c->result_sanitized) ? ($c->result_sanitized['resource_refs'] ?? null) : null,
            'changed_something' => (bool) $c->side_effect_committed,
            'verified' => (bool) $c->verified,
            'error_category' => $c->error_category,
            'duration_ms' => $c->started_at && $c->finished_at ? $c->started_at->diffInMilliseconds($c->finished_at) : null,
        ]);

        return response()->json($calls);
    }

    /** CSV of the filtered audit trail (newest first, up to EXPORT_LIMIT rows). */
    public function export(Request $request): StreamedResponse
    {
        $query = $this->filtered($request)->orderByDesc('id')->limit(self::EXPORT_LIMIT);
        AuditLog::log($request->user()->id, 'AUDIT_LOG_EXPORTED', 'AuditLog', null, array_filter($request->only(['category', 'search', 'from', 'to'])));

        return response()->streamDownload(function () use ($query) {
            $out = fopen('php://output', 'w');
            fputcsv($out, ['time_utc', 'action', 'resource_type', 'resource_id', 'ip_address', 'details']);
            // A cell starting with = + - @ would run as a formula in a spreadsheet; prefix it so it stays text.
            $cell = fn ($v) => is_string($v) && preg_match('/^[=+\-@\t\r]/', $v) ? "'" . $v : $v;
            foreach ($query->cursor() as $log) {
                fputcsv($out, array_map($cell, [
                    $log->created_at?->utc()->toIso8601String(),
                    $log->action,
                    $log->resource_type,
                    $log->resource_id,
                    $log->ip_address,
                    $log->metadata ? json_encode($log->metadata, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : '',
                ]));
            }
            fclose($out);
        }, 'audit-log-' . now()->format('Y-m-d') . '.csv', ['Content-Type' => 'text/csv; charset=UTF-8']);
    }
}
