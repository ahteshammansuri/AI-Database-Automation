<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class DataQueryResult extends Model
{
    use HasFactory, HasUuids;

    protected $keyType = 'string';
    public $incrementing = false;

    protected $fillable = [
        'id',
        'user_id',
        'connection_id',
        'query_hash',
        'user_question',
        'compiled_sql',
        'bindings',
        'row_count',
        'masked_rows',
        'columns',
        'assumptions',
        'how_i_got_this',
        'expires_at',
    ];

    protected $casts = [
        'bindings' => 'array',
        'masked_rows' => 'array',
        'columns' => 'array',
        'assumptions' => 'array',
        'how_i_got_this' => 'array',
        'expires_at' => 'datetime',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function connection(): BelongsTo
    {
        return $this->belongsTo(DbConnection::class, 'connection_id');
    }
}
