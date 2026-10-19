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

    /** @return array{provider: string, model: string, api_key: ?string} */
    public static function for(User $user): array
    {
        $provider = config('orbit.default_provider', 'ollama');
        $model = config('orbit.default_model', 'qwen2.5:3b');

        $role = ModelRole::where('user_id', $user->id)->where('role', ModelRole::ROLE_PLANNER)->where('is_active', true)->first();
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

        return ['provider' => $provider, 'model' => $model, 'api_key' => $apiKey];
    }
}
