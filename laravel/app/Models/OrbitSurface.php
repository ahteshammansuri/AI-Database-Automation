<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * An interactive form, section, or card on a portal page that Orbit operates:
 * inputs, selectors, and buttons. Managed dynamically from the Filament Admin Panel.
 */
class OrbitSurface extends Model
{
    protected $table = 'orbit_surfaces';

    protected $keyType = 'string';

    public $incrementing = false;

    protected $fillable = [
        'id',
        'route',
        'title',
        'purpose',
        'openable',
        'fields',
        'actions',
        'is_active',
        'sort',
        'updated_by',
    ];

    protected function casts(): array
    {
        return [
            'openable' => 'boolean',
            'is_active' => 'boolean',
            'fields' => 'array',
            'actions' => 'array',
            'sort' => 'integer',
        ];
    }

    public function editor(): BelongsTo
    {
        return $this->belongsTo(Admin::class, 'updated_by');
    }

    public function page(): BelongsTo
    {
        return $this->belongsTo(OrbitPage::class, 'route', 'route');
    }
}
