<?php

namespace App\Services\Agent;

use App\Models\AgentTask;
use App\Models\Automation;
use App\Models\AutomationExecution;
use App\Models\ContentVersion;
use App\Models\DbConnection;
use App\Models\KnowledgeDocument;
use App\Models\User;

/**
 * Deterministic checks between a model decision and a real side effect. Runs right
 * before execution, so long model calls or queue delays cannot use stale approval.
 * The model never decides identity, ownership or policy.
 */
class ToolPolicyGate
{
    /** Resource-ID arguments and the owner check for each. */
    protected const OWNED_REFS = [
        'connection_id' => DbConnection::class,
        'automation_id' => Automation::class,
        'execution_id' => AutomationExecution::class,
        'version_id' => ContentVersion::class,
        'document_id' => KnowledgeDocument::class,
    ];

    /**
     * @return array{ok: bool, args: array, def: ?array, error_category: ?string, safe_message: ?string}
     */
    public function check(User $user, AgentTask $task, string $tool, array $args, bool $confirmed = false): array
    {
        $def = AgentToolRegistry::definition($tool);
        if (!$def) {
            return $this->deny('UNKNOWN_TOOL', "There is no registered tool named '{$tool}'.");
        }

        $availability = AgentToolRegistry::getDynamicToolAvailability($user)[$tool] ?? ['available' => true];
        if (!($availability['available'] ?? true)) {
            return $this->deny('UNAVAILABLE', $availability['reason'] ?? "'{$tool}' is not available right now.", $def);
        }

        $validation = ToolArgumentValidator::validate(AgentToolRegistry::modelParameterSchema($def), $args);
        if (!$validation['valid']) {
            return $this->deny('INVALID_ARGS', 'Invalid arguments: ' . implode('; ', $validation['errors']) . '.', $def);
        }
        $clean = $validation['args'];

        foreach (self::OWNED_REFS as $key => $model) {
            if (!array_key_exists($key, $clean)) {
                continue;
            }
            $id = (int) $clean[$key];
            if ($id < 1 || !$model::where('user_id', $user->id)->whereKey($id)->exists()) {
                // Same message whether the record is missing or belongs to someone else.
                return $this->deny('NOT_FOUND', "No {$this->label($key)} with id {$id} exists in your workspace.", $def);
            }
        }

        if (($def['side_effect_class'] ?? null) === 'ui') {
            $check = SurfaceCatalog::check($tool, $clean);
            if (!$check['ok']) {
                return $this->deny('INVALID_ARGS', $check['error'], $def);
            }
            // Consequential on-screen actions (catalog flag, never the browser's) always need the user's OK.
            if ($check['consequential'] && !$confirmed) {
                return [
                    'ok' => false, 'args' => $clean, 'def' => $def, 'error_category' => 'CONFIRMATION_REQUIRED',
                    'safe_message' => 'Pressing "' . ($clean['action'] ?? '') . '" changes data. Ask the user to confirm exactly what will happen before pressing it.',
                ];
            }

            return ['ok' => true, 'args' => $clean, 'def' => $def, 'error_category' => null, 'safe_message' => null];
        }

        if (AgentToolRegistry::needsConfirmation($def, $task->autonomy_level ?: 'CONFIRM_CONSEQUENTIAL_CHANGES') && !$confirmed) {
            return [
                'ok' => false,
                'args' => $clean,
                'def' => $def,
                'error_category' => 'CONFIRMATION_REQUIRED',
                'safe_message' => "'{$tool}' needs the user's explicit confirmation before it runs. Ask the user to confirm exactly what will happen.",
            ];
        }

        return ['ok' => true, 'args' => $clean, 'def' => $def, 'error_category' => null, 'safe_message' => null];
    }

    protected function deny(string $category, string $message, ?array $def = null): array
    {
        return ['ok' => false, 'args' => [], 'def' => $def, 'error_category' => $category, 'safe_message' => $message];
    }

    protected function label(string $key): string
    {
        return str_replace('_', ' ', substr($key, 0, -3));
    }
}
