<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * An action/capability Orbit can perform (UI navigation, database operations,
 * automations, approvals, profile updates, audit queries). Managed dynamically in Admin.
 */
class OrbitTool extends Model
{
    protected $table = 'orbit_tools';

    protected $keyType = 'string';

    public $incrementing = false;

    protected $primaryKey = 'name';

    protected $fillable = [
        'name',
        'label',
        'category',
        'description',
        'outcome',
        'scope',
        'read_only',
        'side_effects',
        'risk_level',
        'requires_confirmation',
        'idempotent',
        'retryable',
        'audit_required',
        'is_ui',
        'is_active',
        'parameters',
        'output_schema',
        'sort',
        'updated_by',
        'version',
        'side_effect_class',
        'secret_params',
        'always_confirm',
        'confirm_by_button',
        'postcondition',
    ];

    protected function casts(): array
    {
        return [
            'read_only' => 'boolean',
            'requires_confirmation' => 'boolean',
            'idempotent' => 'boolean',
            'retryable' => 'boolean',
            'audit_required' => 'boolean',
            'is_ui' => 'boolean',
            'is_active' => 'boolean',
            'parameters' => 'array',
            'output_schema' => 'array',
            'sort' => 'integer',
            'version' => 'integer',
            'secret_params' => 'array',
            'always_confirm' => 'boolean',
            'confirm_by_button' => 'boolean',
        ];
    }

    public function editor(): BelongsTo
    {
        return $this->belongsTo(Admin::class, 'updated_by');
    }
}
