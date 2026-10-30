<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class SchemaTableAnnotation extends Model
{
    use HasFactory;

    protected $fillable = [
        'user_id',
        'connection_id',
        'table_name',
        'display_column',
        'ai_purpose',
        'ai_business_concept',
        'user_override_notes',
        'is_user_verified',
    ];

    protected $casts = [
        'is_user_verified' => 'boolean',
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
