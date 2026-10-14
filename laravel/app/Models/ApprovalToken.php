<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

class ApprovalToken extends Model
{
    use HasFactory;

    protected $table = 'approval_tokens';

    protected $fillable = [
        'user_id',
        'version_id',
        'token',
        'expires_at',
        'used_at',
    ];

    protected function casts(): array
    {
        return [
            'expires_at' => 'datetime',
            'used_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function version(): BelongsTo
    {
        return $this->belongsTo(ContentVersion::class, 'version_id');
    }

    public function isValid(): bool
    {
        return is_null($this->used_at) && $this->expires_at->isFuture();
    }

    public static function generateForVersion(ContentVersion $version): self
    {
        return self::create([
            'user_id' => $version->user_id,
            'version_id' => $version->id,
            'token' => Str::random(48),
            'expires_at' => now()->addHours(24),
        ]);
    }
}
