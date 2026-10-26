<?php

namespace App\Services\Agent;

use App\Models\Automation;
use App\Models\AutomationExecution;
use App\Models\ContentVersion;
use Carbon\CarbonInterface;

/**
 * When the portal is open, a backend tool that has an on-screen equivalent is carried out on screen instead: Orbit
 * goes to the page and presses the page's own button (which makes the same API call), so the user watches it happen.
 * Afterwards the real state is checked on the server; the press itself is never taken as proof.
 */
final class VisibleEquivalent
{
    /**
     * The on-screen steps for a backend tool call, or null when it has no exact equivalent.
     *
     * @return list<array{tool: string, args: array}>|null
     */
    public static function steps(string $tool, array $args): ?array
    {
        $only = fn (array $keys) => array_diff(array_keys(array_filter($args, fn ($v) => $v !== null)), $keys) === [];

        switch ($tool) {
            case 'run_automation_now':
                return $only(['automation_id']) ? self::press('/automations', 'automations.list', 'run_now', $args['automation_id'] ?? null) : null;
            case 'update_automation':
                // Only a pure pause / resume; any other change goes through the backend tool.
                if (!array_key_exists('is_active', $args) || !$only(['automation_id', 'is_active'])) {
                    return null;
                }
                return self::press('/automations', 'automations.list', $args['is_active'] ? 'resume' : 'pause', $args['automation_id'] ?? null);
            case 'remove_automation':
                return $only(['automation_id']) ? self::press('/automations', 'automations.list', 'remove', $args['automation_id'] ?? null) : null;
            case 'retry_execution':
                return self::press('/executions', 'executions.list', 'retry', $args['execution_id'] ?? null);
            case 'request_execution_interrupt':
                $action = strtolower((string) ($args['action'] ?? 'cancel'));
                return in_array($action, ['cancel', 'pause'], true) ? self::press('/executions', 'executions.list', $action, $args['execution_id'] ?? null) : null;
            case 'approve_content_version':
                return self::press('/approvals', 'approvals.list', 'approve', $args['version_id'] ?? null);
            case 'reject_content_version':
                $steps = self::press('/approvals', 'approvals.list', 'reject', $args['version_id'] ?? null);
                if ($steps === null) {
                    return null;
                }
                // Type the notes into the page's field first, then press Send back.
                array_splice($steps, 1, 0, [['tool' => 'fill_fields', 'args' => ['surface' => 'approvals.list', 'values' => ['reject_feedback' => (string) ($args['feedback'] ?? '')]]]]);
                return $steps;
        }

        return null;
    }

    private static function press(string $page, string $surface, string $action, mixed $row): ?array
    {
        if ($row === null || $row === '' || !is_numeric($row)) {
            return null;
        }
        $known = SurfaceCatalog::surface($surface);
        if ($known === null || SurfaceCatalog::action($known, $action) === null) {
            return null;
        }

        return [
            ['tool' => 'go_to_page', 'args' => ['page' => $page]],
            ['tool' => 'press', 'args' => ['surface' => $surface, 'action' => $action, 'row' => (string) (int) $row]],
        ];
    }

    /**
     * Did the on-screen action really do what the backend tool would have done? Checked on the server.
     *
     * @return array{ok: bool, message: string, refs: array<string, int>}
     */
    public static function verify(string $tool, array $args, int $userId, CarbonInterface $since): array
    {
        switch ($tool) {
            case 'run_automation_now':
                $id = (int) $args['automation_id'];
                $run = AutomationExecution::where('user_id', $userId)->where('automation_id', $id)->where('created_at', '>=', $since->copy()->subSeconds(2))->latest('id')->first();
                return $run
                    ? ['ok' => true, 'message' => "Started run #{$run->id} on screen (status: {$run->status}).", 'refs' => ['automation_id' => $id, 'execution_id' => $run->id]]
                    : ['ok' => false, 'message' => 'The page said the run was queued, but no new run was found. Nothing is confirmed.', 'refs' => []];
            case 'update_automation':
                $a = Automation::where('user_id', $userId)->find((int) $args['automation_id']);
                $want = (bool) $args['is_active'];
                return $a && (bool) $a->is_active === $want
                    ? ['ok' => true, 'message' => "“{$a->name}” is " . ($want ? 'active' : 'paused') . ' (done on screen).', 'refs' => ['automation_id' => $a->id]]
                    : ['ok' => false, 'message' => 'The automation is not ' . ($want ? 'active' : 'paused') . ' after pressing the button.', 'refs' => []];
            case 'remove_automation':
                $gone = !Automation::where('user_id', $userId)->whereKey((int) $args['automation_id'])->exists();
                return $gone
                    ? ['ok' => true, 'message' => 'The automation was deleted on screen.', 'refs' => []]
                    : ['ok' => false, 'message' => 'The automation still exists; it was not deleted.', 'refs' => []];
            case 'retry_execution':
            case 'request_execution_interrupt':
                $e = AutomationExecution::where('user_id', $userId)->find((int) $args['execution_id']);
                $expected = $tool === 'retry_execution'
                    ? fn ($s) => !in_array($s, ['FAILED', 'CANCELLED'], true)
                    : (strtolower((string) ($args['action'] ?? 'cancel')) === 'pause' ? fn ($s) => $s === 'PAUSED' : fn ($s) => $s === 'CANCELLED');
                return $e && $expected($e->status)
                    ? ['ok' => true, 'message' => "Run #{$e->id} is now {$e->status} (done on screen).", 'refs' => ['execution_id' => $e->id]]
                    : ['ok' => false, 'message' => 'The run did not reach the expected state' . ($e ? " (it is {$e->status})" : '') . '.', 'refs' => []];
            case 'approve_content_version':
            case 'reject_content_version':
                $v = ContentVersion::where('user_id', $userId)->with('execution:id,status')->find((int) $args['version_id']);
                $want = $tool === 'approve_content_version' ? 'APPROVED' : 'REJECTED';
                return $v && $v->status === $want
                    ? ['ok' => true, 'message' => 'Version ' . $v->version_number . ($want === 'APPROVED' ? ' was approved' : ' was sent back for a rewrite') . ' on screen' . ($v->execution ? " (run #{$v->execution->id}: {$v->execution->status})" : '') . '.', 'refs' => ['version_id' => $v->id, 'execution_id' => $v->execution_id]]
                    : ['ok' => false, 'message' => 'The draft is not ' . strtolower($want) . ' after pressing the button.', 'refs' => []];
        }

        return ['ok' => false, 'message' => 'Not checked.', 'refs' => []];
    }
}
