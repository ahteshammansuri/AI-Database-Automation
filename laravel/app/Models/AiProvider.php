<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AiProvider extends Model
{
    use HasFactory;

    protected $table = 'ai_providers';

    protected $fillable = [
        'user_id',
        'provider_type',
        'model_name',
        'encrypted_api_key',
        'base_url',
        'is_active',
    ];

    protected $hidden = [
        'encrypted_api_key',
    ];

    protected $appends = [
        'masked_key',
    ];

    protected function casts(): array
    {
        return [
            'encrypted_api_key' => 'encrypted',
            'is_active' => 'boolean',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function getMaskedKeyAttribute(): ?string
    {
        if (empty($this->encrypted_api_key)) {
            return null;
        }
        $len = strlen($this->encrypted_api_key);
        if ($len <= 8) {
            return '********';
        }
        return substr($this->encrypted_api_key, 0, 4) . '...' . substr($this->encrypted_api_key, -4);
    }
}
