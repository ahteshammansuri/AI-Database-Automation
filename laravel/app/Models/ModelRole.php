<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ModelRole extends Model
{
    use HasFactory;

    public const ROLE_PLANNER = 'planner';
    public const ROLE_GENERATOR = 'generator';

    /**
     * The jobs a customer can give to a model. Only jobs the product really performs are listed (each one is read by
     * ModelSelector). Temperature is applied to these calls; data questions always run at 0 for accuracy.
     */
    public const SUPPORTED_ROLES = [
        self::ROLE_PLANNER => [
            'label' => 'Orbit and planning',
            'description' => 'Understands what you ask Orbit, decides each step, answers questions about your data and fills in new automations from a description.',
            'default_provider' => 'ollama',
            'default_model' => 'qwen2.5:3b',
            'recommended' => ['qwen2.5:3b', 'qwen2.5:7b', 'llama3.1:8b', 'gpt-4o-mini', 'gemini-3.5-flash', 'claude-sonnet-5-5'],
            'temperature_hint' => 'Keep it low (0 to 0.3) so Orbit acts the same way every time.',
        ],
        self::ROLE_GENERATOR => [
            'label' => 'Writing content',
            'description' => 'Writes what automations publish (articles, product copy, FAQs) and sample rows, when an automation does not name its own model.',
            'default_provider' => 'ollama',
            'default_model' => 'llama3.2:1b',
            'recommended' => ['llama3.2:3b', 'qwen2.5:7b', 'mistral:7b', 'gpt-4o-mini', 'gemini-3.5-flash', 'claude-sonnet-5-5'],
            'temperature_hint' => '0.6 to 0.9 gives varied, natural writing; lower is more predictable.',
        ],
    ];

    protected $table = 'model_roles';

    protected $fillable = [
        'user_id',
        'role',
        'provider',
        'model_name',
        'temperature',
        'max_tokens',
        'is_active',
    ];

    protected function casts(): array
    {
        return [
            'temperature' => 'float',
            'max_tokens' => 'integer',
            'is_active' => 'boolean',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
