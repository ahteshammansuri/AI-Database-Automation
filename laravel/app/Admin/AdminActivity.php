<?php

namespace App\Admin;

use App\Models\Admin;
use App\Models\AdminActivityLog;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Log;

/**
 * Records what admins change in the admin panel. Values of secret fields are never stored, only that they changed.
 */
final class AdminActivity
{
    /** Fields whose values are never written to the activity log. */
    private const SECRET_FIELDS = [
        'password', 'remember_token', 'app_authentication_secret', 'app_authentication_recovery_codes',
        'encrypted_password', 'encrypted_api_key', 'device_token_hash', 'pairing_code_hash', 'token', 'secret', 'api_key',
    ];

    public static function record(string $action, Model|string|null $subject = null, array $changes = [], ?string $label = null): void
    {
        try {
            $admin = auth('admin')->user();
            AdminActivityLog::create([
                'admin_id' => $admin instanceof Admin ? $admin->id : null,
                'admin_name' => $admin instanceof Admin ? $admin->name : 'system',
                'action' => $action,
                'subject_type' => $subject instanceof Model ? class_basename($subject) : $subject,
                'subject_id' => $subject instanceof Model ? (string) $subject->getKey() : null,
                'subject_label' => $label ?? ($subject instanceof Model ? self::labelFor($subject) : null),
                'changes' => $changes ? self::scrub($changes) : null,
                'ip_address' => request()?->ip(),
            ]);
        } catch (\Throwable $e) {
            Log::warning('Admin activity was not recorded: ' . $e->getMessage());
        }
    }

    /**
     * Before/after for the fields a save changed (secret values replaced by a marker). $before is the model's
     * getAttributes() taken before saving: after a save getOriginal() already holds the new values.
     */
    public static function diff(Model $model, array $before): array
    {
        $out = [];
        foreach ($model->getChanges() as $field => $new) {
            if (in_array($field, ['updated_at', 'created_at'], true)) {
                continue;
            }
            $out[$field] = ['from' => $before[$field] ?? null, 'to' => $new];
        }
        return self::scrub($out);
    }

    private static function scrub(array $changes): array
    {
        foreach ($changes as $field => $value) {
            if (in_array(strtolower((string) $field), self::SECRET_FIELDS, true)) {
                $changes[$field] = '(changed, value not recorded)';
            } elseif (is_array($value) && isset($value['from']) && is_string($value['from']) && mb_strlen($value['from']) > 500) {
                $changes[$field]['from'] = mb_substr($value['from'], 0, 500) . '…';
            }
            if (is_array($value) && isset($value['to']) && is_string($value['to']) && mb_strlen($value['to']) > 500) {
                $changes[$field]['to'] = mb_substr($value['to'], 0, 500) . '…';
            }
        }
        return $changes;
    }

    private static function labelFor(Model $model): ?string
    {
        foreach (['name', 'title', 'email', 'key', 'goal'] as $attr) {
            if (!empty($model->{$attr}) && is_string($model->{$attr})) {
                return mb_substr($model->{$attr}, 0, 250);
            }
        }
        return null;
    }
}
