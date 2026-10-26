<?php

namespace App\Services\Agent;

use App\Models\AiProvider;
use App\Models\ModelRole;
use App\Models\User;

/**
 * Which model acts for a user (Orbit's decisions and the data assistant's SQL): the user's planner
 * role, else their active provider, else the platform default. Never silently swapped for another provider.
 */
class ModelSelector
{
    public const CLOUD_PROVIDERS = ['openai', 'gemini', 'anthropic', 'claude'];

    /**
     * @param  string  $roleName  ModelRole::ROLE_* (planner for Orbit and planning, generator for writing content)
     * @return array{provider: string, model: string, api_key: ?string, temperature: ?float}
     */
    public static function for(User $user, string $roleName = ModelRole::ROLE_PLANNER): array
    {
        $provider = config('orbit.default_provider', 'ollama');
        $model = $roleName === ModelRole::ROLE_PLANNER
            ? config('orbit.default_model', 'qwen2.5:3b')
            : (ModelRole::SUPPORTED_ROLES[$roleName]['default_model'] ?? config('orbit.default_model', 'qwen2.5:3b'));

        $role = ModelRole::where('user_id', $user->id)->where('role', $roleName)->where('is_active', true)->first();
        $active = AiProvider::where('user_id', $user->id)->where('is_active', true)->first();
        if ($role) {
            $provider = $role->provider;
            $model = $role->model_name;
        } elseif ($active) {
            $provider = $active->provider_type;
            $model = $active->model_name ?: $model;
        }

        $apiKey = null;
        if (in_array(strtolower($provider), self::CLOUD_PROVIDERS, true)) {
            $types = in_array(strtolower($provider), ['anthropic', 'claude'], true) ? ['anthropic', 'claude'] : [strtolower($provider)];
            $apiKey = AiProvider::where('user_id', $user->id)->whereIn('provider_type', $types)->first()?->encrypted_api_key;
        }

        return ['provider' => $provider, 'model' => $model, 'api_key' => $apiKey, 'temperature' => self::temperature($user, $roleName)];
    }

    /** The temperature the customer chose for a role, or null for the provider's default. */
    public static function temperature(User $user, string $roleName): ?float
    {
        $t = ModelRole::where('user_id', $user->id)->where('role', $roleName)->where('is_active', true)->value('temperature');
        return $t === null ? null : max(0.0, min($roleName === ModelRole::ROLE_PLANNER ? 1.0 : 1.5, (float) $t));
    }
}
