<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** The customer's model's reading of one table (see TableInsightService). */
class SchemaTableInsight extends Model
{
    protected $fillable = ['user_id', 'connection_id', 'table_name', 'schema_hash', 'status', 'source', 'model', 'insights', 'error', 'analyzed_at'];

    protected $casts = ['insights' => 'array', 'analyzed_at' => 'datetime'];
}
