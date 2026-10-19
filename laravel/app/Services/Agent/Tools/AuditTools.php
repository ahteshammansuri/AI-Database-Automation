<?php

namespace App\Services\Agent\Tools;

use App\Models\AuditLog;
use App\Models\User;
use App\Services\Data\ColumnClassifier;
use Carbon\CarbonImmutable;
use Illuminate\Support\Str;

/**
 * Audit-trail search for Orbit, so questions like "did I ever add a connection?" or "what did I
 * change yesterday?" are answered from real rows with real counts. Only the user's own entries.
 */
class AuditTools
{
    public static function search(User $user, array $args): array
    {
        $q = AuditLog::where('user_id', $user->id);

        if (!empty($args['action'])) {
            $q->where('action', 'like', '%' . str_replace(['%', '_'], ['\\%', '\\_'], (string) $args['action']) . '%');
        }
        if (!empty($args['resource_type'])) {
            $q->where('resource_type', 'like', '%' . (string) $args['resource_type'] . '%');
        }
        if (!empty($args['query'])) {
            $terms = array_filter(preg_split('/\s+/', mb_strtolower((string) $args['query'])), fn($t) => mb_strlen($t) >= 3);
            foreach (array_slice($terms, 0, 5) as $term) {
                $like = '%' . str_replace(['%', '_'], ['\\%', '\\_'], $term) . '%';
                $q->where(fn($w) => $w->whereRaw('LOWER(action) LIKE ?', [$like])
                    ->orWhereRaw('LOWER(resource_type) LIKE ?', [$like])
                    ->orWhereRaw('LOWER(CAST(metadata AS CHAR)) LIKE ?', [$like]));
            }
        }
        try {
            if (!empty($args['since'])) {
                $q->where('created_at', '>=', CarbonImmutable::parse((string) $args['since'])->utc());
            }
            if (!empty($args['until'])) {
                $until = CarbonImmutable::parse((string) $args['until']);
                $q->where('created_at', '<=', (strlen((string) $args['until']) <= 10 ? $until->endOfDay() : $until)->utc());
            }
        } catch (\Throwable) {
            return ['success' => false, 'error' => 'Dates must look like 2026-10-16 or an ISO date-time.'];
        }

        $total = (clone $q)->count();
        $first = (clone $q)->oldest('id')->first();
        $last = (clone $q)->latest('id')->first();
        $byAction = (clone $q)->selectRaw('action, COUNT(*) AS n')->groupBy('action')->orderByDesc('n')->limit(12)->pluck('n', 'action');
        $limit = max(1, min((int) ($args['limit'] ?? 15), 50));
        $rows = (clone $q)->latest('id')->limit($limit)->get()->map(fn(AuditLog $l) => self::row($l, false));

        $out = [
            'success' => true,
            'total_matching' => $total,
            'first_at' => $first?->created_at?->toIso8601String(),
            'last_at' => $last?->created_at?->toIso8601String(),
            'counts_by_action' => $byAction,
            'entries' => $rows,
            'message' => $total === 0 ? 'No audit entries match.' : "{$total} audit entr" . ($total === 1 ? 'y matches' : 'ies match') . ($total > $limit ? "; showing the latest {$limit}." : '.'),
        ];
        if ($total === 0) {
            // Real action names this user has, so the next search can use the right one.
            $out['your_action_types'] = AuditLog::where('user_id', $user->id)->distinct()->orderBy('action')->limit(60)->pluck('action');
        }
        return $out;
    }

    public static function inspect(User $user, array $args): array
    {
        $l = AuditLog::where('user_id', $user->id)->find((int) ($args['log_id'] ?? 0));
        if (!$l) {
            return ['success' => false, 'error' => 'No audit entry with that id in your workspace.'];
        }
        return ['success' => true, 'entry' => self::row($l, true), 'message' => "Audit entry #{$l->id}: {$l->action}."];
    }

    private static function row(AuditLog $l, bool $full): array
    {
        $meta = is_array($l->metadata) ? $l->metadata : [];
        $meta = self::scrub($meta);
        return [
            'id' => $l->id,
            'action' => $l->action,
            'what' => Str::headline(strtolower($l->action)),
            'resource_type' => $l->resource_type,
            'resource_id' => $l->resource_id,
            'at' => $l->created_at?->toIso8601String(),
            'details' => $full ? $meta : array_slice($meta, 0, 6, true),
        ];
    }

    /** Secrets and signed links never leave the server, even if a log entry contains them. */
    private static function scrub(array $meta, int $depth = 0): array
    {
        $out = [];
        foreach ($meta as $k => $v) {
            if (is_string($k) && (ColumnClassifier::isSecret($k) || str_contains(strtolower($k), 'url') && is_string($v) && str_contains($v, '/approvals/'))) {
                $out[$k] = '[hidden]';
                continue;
            }
            $out[$k] = is_array($v) ? ($depth < 3 ? self::scrub($v, $depth + 1) : '[…]') : (is_string($v) ? Str::limit($v, 300) : $v);
        }
        return $out;
    }
}
