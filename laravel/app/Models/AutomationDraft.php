<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** An automation (or manual publication) the customer is still building; see AutomationDraftController. */
class AutomationDraft extends Model
{
    public const KINDS = ['automation', 'manual_publish'];

    protected $fillable = ['user_id', 'kind', 'payload', 'step'];

    protected function casts(): array
    {
        return ['payload' => 'array', 'step' => 'integer'];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
