<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * The owner's setting for one column of one table on a connection: link_mode auto (use what was found), link (to
 * ref_table.ref_column) or none (not a link), and names for its stored values.
 */
class ConnectionColumnSetting extends Model
{
    public const MODES = ['auto', 'link', 'none'];

    protected $fillable = ['user_id', 'connection_id', 'table_name', 'column_name', 'link_mode', 'ref_table', 'ref_column', 'value_labels'];

    protected $casts = ['value_labels' => 'array'];

    public function connection()
    {
        return $this->belongsTo(DbConnection::class, 'connection_id');
    }
}
