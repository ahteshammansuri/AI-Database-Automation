<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class SchemaSnapshot extends Model
{
    use HasFactory;

    protected $fillable = [
        'user_id',
        'connection_id',
        'version',
        'schema_payload',
        'table_count',
        'column_count',
    ];

    protected $casts = [
        'schema_payload' => 'array',
        'version' => 'integer',
        'table_count' => 'integer',
        'column_count' => 'integer',
    ];

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function connection()
    {
        return $this->belongsTo(DbConnection::class, 'connection_id');
    }
}
