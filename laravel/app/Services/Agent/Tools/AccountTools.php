<?php

namespace App\Services\Agent\Tools;

use App\Models\AuditLog;
use App\Models\Automation;
use App\Models\AutomationExecution;
use App\Models\DbConnection;
use App\Models\User;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;

class AccountTools
{
    /**
     * Get the authenticated user's account profile details.
     */
    public static function get(User $user): array
    {
        $connectionsCount = DbConnection::where('user_id', $user->id)->count();
        $automationsCount = Automation::where('user_id', $user->id)->where('schedule_type', '!=', 'NONE')->count();
        $runsCount = AutomationExecution::where('user_id', $user->id)->where('created_at', '>=', now()->startOfMonth())->count();
        $sessionsCount = $user->tokens()->count();

        $tzDisplay = $user->timezone ?: 'browser default';

        $userData = [
            'id' => $user->id,
            'name' => $user->name,
            'email' => $user->email,
            'timezone' => $user->timezone,
            'workspace' => [
                'connections' => $connectionsCount,
                'automations' => $automationsCount,
                'runs_this_month' => $runsCount,
                'sessions_count' => $sessionsCount,
            ],
        ];

        return [
            'success' => true,
            'user' => $userData,
            'data' => $userData,
            'safe_message' => "Your profile name is {$user->name}, email is {$user->email}, and timezone is set to {$tzDisplay}.",
        ];
    }

    /**
     * Update the authenticated user's profile information.
     */
    public static function update(User $user, array $args): array
    {
        $rules = [
            'name' => 'nullable|string|min:1|max:255',
            'timezone' => 'nullable|string|max:64|timezone:all',
            'email' => ['nullable', 'string', 'email', 'max:255', Rule::unique('users', 'email')->ignore($user->id)],
            'current_password' => 'nullable|string|max:255',
        ];

        $validator = Validator::make($args, $rules, [
            'timezone.timezone' => 'Invalid timezone specified.',
            'email.unique' => 'Another account already uses this email address.',
        ]);

        if ($validator->fails()) {
            return [
                'success' => false,
                'error_category' => 'INVALID_ARGS',
                'error' => $validator->errors()->first(),
                'safe_message' => $validator->errors()->first(),
            ];
        }

        $emailChanged = !empty($args['email']) && strcasecmp(trim($args['email']), $user->email) !== 0;
        if ($emailChanged) {
            if (empty($args['current_password']) || !Hash::check((string) $args['current_password'], $user->password)) {
                return [
                    'success' => false,
                    'error_category' => 'SECRET_REQUIRED',
                    'error' => 'Current password is required to change your email address.',
                    'safe_message' => 'Enter your current password in the form to change your email address.',
                ];
            }
        }

        $before = $user->only(['name', 'email', 'timezone']);
        $changed = [];

        if (isset($args['name']) && trim($args['name']) !== '') {
            $user->name = trim($args['name']);
            $changed[] = "name to '{$user->name}'";
        }

        if (array_key_exists('timezone', $args)) {
            $user->timezone = $args['timezone'] ? trim($args['timezone']) : null;
            $changed[] = 'timezone to ' . ($user->timezone ?: 'browser default');
        }

        if ($emailChanged) {
            $user->email = trim($args['email']);
            $user->email_verified_at = null;
            $changed[] = "email to '{$user->email}'";
        }

        if (empty($changed)) {
            return [
                'success' => true,
                'data' => $user->only(['id', 'name', 'email', 'timezone']),
                'safe_message' => 'No profile changes were requested.',
            ];
        }

        $user->save();

        AuditLog::log($user->id, 'PROFILE_UPDATED', 'User', (string) $user->id, [
            'changes' => AuditLog::changes($before, $user->only(['name', 'email', 'timezone'])),
        ]);

        $summary = implode(', ', $changed);

        $userData = [
            'id' => $user->id,
            'name' => $user->name,
            'email' => $user->email,
            'timezone' => $user->timezone,
        ];

        return [
            'success' => true,
            'user' => $userData,
            'data' => $userData,
            'safe_message' => "Successfully updated your {$summary}.",
        ];
    }
}
