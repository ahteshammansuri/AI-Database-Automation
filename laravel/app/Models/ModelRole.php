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
    public const ROLE_CLASSIFIER = 'classifier';
    public const ROLE_SUMMARIZER = 'summarizer';

    public const SUPPORTED_ROLES = [
        self::ROLE_PLANNER => [
            'label' => 'Agent Planner & Reasoning',
            'description' => 'Breaks complex database goals into step-by-step tool actions and resolves slot dependencies.',
            'default_provider' => 'ollama',
            'default_model' => 'llama3.2:1b',
            'recommended' => ['llama3.2:1b', 'qwen2.5:7b', 'gpt-4o', 'gemini-1.5-pro'],
        ],
        self::ROLE_GENERATOR => [
            'label' => 'Editorial Content Generator',
            'description' => 'Generates schema-validated structured content (articles, products, FAQs) from context packages.',
            'default_provider' => 'ollama',
            'default_model' => 'llama3.2:1b',
            'recommended' => ['llama3.2:1b', 'mistral:7b', 'gpt-4o-mini', 'gemini-1.5-flash'],
        ],
        self::ROLE_CLASSIFIER => [
            'label' => 'Schema & Column Classifier',
            'description' => 'Infers semantic roles (title, slug, status, FK lookup) for discovered database columns.',
            'default_provider' => 'ollama',
            'default_model' => 'llama3.2:1b',
            'recommended' => ['llama3.2:1b', 'nomic-embed-text', 'mock-llama3-synthetic'],
        ],
        self::ROLE_SUMMARIZER => [
            'label' => 'Execution & Voice Summarizer',
            'description' => 'Synthesizes concise, voice-friendly execution summaries for the Orbit mascot to speak.',
            'default_provider' => 'ollama',
            'default_model' => 'llama3.2:1b',
            'recommended' => ['llama3.2:1b', 'gpt-4o-mini', 'gemini-1.5-flash'],
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
