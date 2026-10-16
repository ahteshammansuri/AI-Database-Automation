<?php

namespace App\Services\Data\Dialects;

use App\Models\DbConnection;
use App\Services\Data\DataException;

/**
 * Which engines exist and whether each one really works here. Engines without an adapter are
 * listed as unsupported with the reason, never faked.
 */
class DialectRegistry
{
    private const ALIASES = [
        'mysql' => 'mysql', 'mariadb' => 'mysql',
        'postgresql' => 'postgresql', 'postgres' => 'postgresql', 'pgsql' => 'postgresql',
    ];

    private const UNSUPPORTED = [
        'sqlite' => 'SQLite is not supported for user connections: a SQLite "connection" is a file path on this server, which would let one user read server files.',
        'sqlsrv' => 'SQL Server has no adapter yet.',
        'mongodb' => 'MongoDB is not a SQL database and has no adapter yet.',
    ];

    public static function normalise(?string $type): string
    {
        $t = strtolower(trim((string) $type));
        return self::ALIASES[$t] ?? $t;
    }

    public static function for(DbConnection|string|null $typeOrConnection): Dialect
    {
        $type = self::normalise($typeOrConnection instanceof DbConnection ? ($typeOrConnection->db_type ?: 'mysql') : ($typeOrConnection ?: 'mysql'));
        $dialect = match ($type) {
            'mysql' => new MySqlDialect(),
            'postgresql' => new PostgresDialect(),
            default => throw new DataException('ENGINE_UNSUPPORTED', self::UNSUPPORTED[$type] ?? "Database engine '{$type}' is not supported.", ['engine' => $type]),
        };
        if (!$dialect->driverAvailable()) {
            throw new DataException('DRIVER_MISSING', "{$dialect->label()} needs the PHP PDO driver for it, which is not installed on this server" .
                ($type === 'postgresql' ? ' (install php8.3-pgsql).' : '.'), ['engine' => $type]);
        }
        return $dialect;
    }

    public function get(DbConnection|string|null $typeOrConnection): Dialect
    {
        return self::for($typeOrConnection);
    }

    /** For the connection form and capability docs: every engine with its honest status. */
    public static function catalog(): array
    {
        $out = [];
        foreach ([new MySqlDialect(), new PostgresDialect()] as $d) {
            $out[] = [
                'key' => $d->key(),
                'label' => $d->label(),
                'default_port' => $d->defaultPort(),
                'status' => $d->driverAvailable() ? 'supported' : 'driver_missing',
                'reason' => $d->driverAvailable() ? null : 'The PHP PDO driver for this engine is not installed on the server.',
            ];
        }
        foreach (self::UNSUPPORTED as $key => $reason) {
            $out[] = ['key' => $key, 'label' => match ($key) { 'sqlite' => 'SQLite', 'sqlsrv' => 'SQL Server', default => 'MongoDB' },
                'default_port' => null, 'status' => 'unsupported', 'reason' => $reason];
        }
        return $out;
    }
}
