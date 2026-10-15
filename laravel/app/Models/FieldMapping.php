<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class FieldMapping extends Model
{
    use HasFactory;

    protected $table = 'field_mappings';

    protected $fillable = [
        'automation_id',
        'column_name',
        'role',
        'confidence',
        'confirmed',
        'override_instructions',
    ];

    protected $casts = [
        'confidence' => 'float',
        'confirmed' => 'boolean',
    ];

    public function automation(): BelongsTo
    {
        return $this->belongsTo(Automation::class);
    }
}
