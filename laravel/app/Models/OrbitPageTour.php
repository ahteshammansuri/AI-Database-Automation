<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * What Orbit says and shows when it explains a page: an overview (used in the portal tour and the short page
 * explanation) and the detailed steps (point at a field or button, open a form or popup and close it again).
 * Stored in the database and edited by admins (Orbit › Page tours); the browser runs the steps in one go.
 *
 * Step: {do: point|open|press|close_popup|say, surface?, field?, action?, row?: "first", say}
 */
class OrbitPageTour extends Model
{
    public const STEP_KINDS = ['point', 'open', 'press', 'close_popup', 'say'];

    protected $fillable = ['route', 'title', 'overview', 'steps', 'is_active', 'sort', 'updated_by'];

    protected function casts(): array
    {
        return ['steps' => 'array', 'is_active' => 'boolean', 'sort' => 'integer'];
    }

    public function editor(): BelongsTo
    {
        return $this->belongsTo(Admin::class, 'updated_by');
    }
}
