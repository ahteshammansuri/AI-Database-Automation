<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** One change made in the admin panel: who, what, which fields (never secret values). Append-only. */
class AdminActivityLog extends Model
{
    public const UPDATED_AT = null;

    protected $fillable = ['admin_id', 'admin_name', 'action', 'subject_type', 'subject_id', 'subject_label', 'changes', 'ip_address'];

    protected function casts(): array
    {
        return ['changes' => 'array', 'created_at' => 'datetime'];
    }

    public function admin(): BelongsTo
    {
        return $this->belongsTo(Admin::class);
    }
}
