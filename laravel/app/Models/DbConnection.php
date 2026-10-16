<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use PDO;

class DbConnection extends Model
{
    use HasFactory;

    protected $table = 'db_connections';

    protected $fillable = [
        'user_id',
        'name',
        'db_type',
        'host',
        'port',
        'database_name',
        'username',
        'encrypted_password',
        'ssl_mode',
        'status',
        'last_tested_at',
        'server_version',
        'latency_ms',
        'connection_timeout',
        'error_message',
        'schema_freshness_at',
        'is_active',
        'access_mode',
        'data_policy',
        'data_timezone',
    ];

    protected $hidden = [
        'encrypted_password',
    ];

    protected $appends = [
        'is_configured',
    ];

    protected function casts(): array
    {
        return [
            'encrypted_password' => 'encrypted',
            'port' => 'integer',
            'last_tested_at' => 'datetime',
            'schema_freshness_at' => 'datetime',
            'latency_ms' => 'float',
            'connection_timeout' => 'integer',
            'is_active' => 'boolean',
            'data_policy' => 'array',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function automations(): HasMany
    {
        return $this->hasMany(Automation::class, 'connection_id');
    }

    public function schemaSnapshot(): \Illuminate\Database\Eloquent\Relations\HasOne
    {
        return $this->hasOne(SchemaSnapshot::class, 'connection_id')->latestOfMany();
    }

    public function getIsConfiguredAttribute(): bool
    {
        return !empty($this->host) && !empty($this->database_name) && !empty($this->username);
    }

    public function getDriverAttribute(): string
    {
        return $this->db_type ?: 'mysql';
    }

    public function setDriverAttribute($val): void
    {
        $this->attributes['db_type'] = $val;
    }

    public function getDatabaseAttribute(): string
    {
        return $this->database_name ?: '';
    }

    public function setDatabaseAttribute($val): void
    {
        $this->attributes['database_name'] = $val;
    }

    public function setPasswordAttribute($val): void
    {
        $this->attributes['encrypted_password'] = $val;
    }

    /**
     * Create an ephemeral, non-global PDO connection to this target customer database.
     * Must be explicitly closed / nulled by caller in finally block.
     */
    public function createTargetPdo(): PDO
    {
        $dsn = "mysql:host={$this->host};port={$this->port};dbname={$this->database_name};charset=utf8mb4";
        $options = [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
            PDO::ATTR_TIMEOUT => 5,
        ];

        return new PDO($dsn, $this->username, $this->encrypted_password, $options);
    }
}
