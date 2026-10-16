<?php

namespace App\Services\Data\Dialects;

use App\Models\DbConnection;
use PDO;

/**
 * One SQL engine. Everything engine-specific lives behind this interface: connection strings,
 * session safety settings, identifier quoting, catalog introspection, EXPLAIN parsing.
 * Business rules (policy, validation, compilation) are written once against it.
 */
interface Dialect
{
    /** Stable key stored in db_connections.db_type ('mysql', 'postgresql'). */
    public function key(): string;

    public function label(): string;

    public function defaultPort(): int;

    /** True when the PHP PDO driver for this engine is loaded. */
    public function driverAvailable(): bool;

    /** Dialect name understood by the AI service's SQL parser (sqlglot). */
    public function parserDialect(): string;

    public function dsn(DbConnection $connection): string;

    /** PDO constructor options. */
    public function pdoOptions(): array;

    /**
     * Session setup on every new connection: UTC session time zone, statement timeout, and when
     * $readOnly, a read-only session so even a statement that slips through cannot write.
     */
    public function initSession(PDO $pdo, bool $readOnly, int $statementTimeoutMs): void;

    /** Start / end an explicit read-only transaction (reads always run inside one). */
    public function beginReadOnly(PDO $pdo): void;

    public function endReadOnly(PDO $pdo): void;

    public function quote(string $identifier): string;

    public function quoteIdentifier(string $identifier): string;

    /** Case-insensitive pattern operator ('LIKE' on MySQL's default collations, 'ILIKE' on PostgreSQL). */
    public function ciLike(): string;

    /** Value to bind for a boolean column. */
    public function bindBool(bool $value): int|bool;

    /** Raw catalog: tables, columns, keys, foreign keys with delete rules. Normalised by LiveSchemaService. */
    public function readCatalog(PDO $pdo, DbConnection $connection): array;

    /** ['version' => ..., 'engine' => 'MySQL'|'MariaDB'|'PostgreSQL', 'current_user' => ...] */
    public function serverInfo(PDO $pdo): array;

    /**
     * Estimate a SELECT without running it: ['rows' => estimated rows examined, 'cost' => planner cost, 'raw' => plan].
     */
    public function explain(PDO $pdo, string $sql, array $bindings): array;

    /** Map a raw column type to a portable family: integer, decimal, boolean, string, text, enum, date, time, timestamp_tz, timestamp_naive, json, uuid, binary, other. */
    public function typeFamily(array $rawColumn): string;
}
