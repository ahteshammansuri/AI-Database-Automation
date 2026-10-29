<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A portal page (route + title) that Orbit knows about and can navigate to.
 * Fully managed dynamically by administrators from the Filament Admin Panel.
 */
class OrbitPage extends Model
{
    protected $table = 'orbit_pages';

    protected $fillable = [
        'route',
        'title',
        'description',
        'is_active',
        'sort',
        'updated_by',
    ];

    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
            'sort' => 'integer',
        ];
    }

    public function editor(): BelongsTo
    {
        return $this->belongsTo(Admin::class, 'updated_by');
    }

    public function surfaces(): HasMany
    {
        return $this->hasMany(OrbitSurface::class, 'route', 'route');
    }
}
