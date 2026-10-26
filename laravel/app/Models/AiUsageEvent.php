<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Tokens one AI service request used for one provider/model (see App\Services\AiUsage). */
class AiUsageEvent extends Model
{
    public const UPDATED_AT = null;

    /** purpose => label shown to customers and admins */
    public const PURPOSES = [
        'orbit' => 'Orbit',
        'content' => 'Automation writing',
        'preview' => 'Automation previews',
        'field_assist' => 'Writing help in forms',
        'planning' => 'Planning automations',
        'data_question' => 'Questions about data',
        'sample_data' => 'Sample data',
        'novelty' => 'Duplicate checks',
        'image' => 'Images',
        'readiness' => 'Model tests',
        'other' => 'Other',
    ];

    protected $fillable = ['user_id', 'purpose', 'provider', 'model', 'kind', 'calls', 'prompt_tokens', 'completion_tokens', 'subject_type', 'subject_id', 'created_at'];

    protected function casts(): array
    {
        return ['calls' => 'integer', 'prompt_tokens' => 'integer', 'completion_tokens' => 'integer', 'created_at' => 'datetime'];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public static function purposeLabel(?string $purpose): string
    {
        return self::PURPOSES[$purpose] ?? ucfirst(str_replace('_', ' ', (string) $purpose));
    }
}
