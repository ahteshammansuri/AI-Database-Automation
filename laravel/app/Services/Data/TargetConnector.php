<?php

namespace App\Services\Data;

use App\Models\DbConnection;
use App\Services\Data\Dialects\Dialect;
use App\Services\Data\Dialects\DialectRegistry;
use App\Services\DatabaseSafetyService;
use PDO;
use PDOException;

/**
 * Opens short-lived PDO connections to a user's target database. Every connection gets a UTC
 * session and a statement timeout; read connections are read-only at the session level, and
 * reads additionally run inside an explicit read-only transaction (see run()).
 * Connections are never shared between users or requests.
 */
class TargetConnector
{
    public function __construct(private DatabaseSafetyService $safety)
    {
    }

    public function dialect(DbConnection $connection): Dialect
    {
        return DialectRegistry::for($connection);
    }

    public function open(DbConnection $connection, bool $readOnly = true, ?int $timeoutMs = null): PDO
    {
        $dialect = $this->dialect($connection);
        try {
            $this->safety->validateConnectionTarget((string) $connection->host, (int) $connection->port);
        } catch (\Throwable $e) {
            throw new DataException('TARGET_BLOCKED', $e->getMessage());
        }
        try {
            $pdo = new PDO($dialect->dsn($connection), (string) $connection->username, (string) $connection->encrypted_password, $dialect->pdoOptions());
            $dialect->initSession($pdo, $readOnly, $timeoutMs ?? (int) config('data_agent.statement_timeout_ms', 8000));
            return $pdo;
        } catch (PDOException $e) {
            throw new DataException('CONNECTION_FAILED', 'Could not connect to "' . $connection->name . '": ' . self::safeMessage($e), retryable: true);
        }
    }

    public function getReadOnlyPdo(DbConnection $connection, ?int $timeoutMs = null): PDO
    {
        return $this->open($connection, true, $timeoutMs);
    }

    public function getReadWritePdo(DbConnection $connection, ?int $timeoutMs = null): PDO
    {
        return $this->open($connection, false, $timeoutMs);
    }

    /**
     * Run $fn inside a read-only transaction on a read-only session. The connection is closed afterwards.
     */
    public function read(DbConnection $connection, callable $fn, ?int $timeoutMs = null): mixed
    {
        $pdo = $this->open($connection, true, $timeoutMs);
        $dialect = $this->dialect($connection);
        try {
            $dialect->beginReadOnly($pdo);
            try {
                return $fn($pdo, $dialect);
            } finally {
                try {
                    $dialect->endReadOnly($pdo);
                } catch (\Throwable) {
                    // connection is discarded below either way
                }
            }
        } catch (PDOException $e) {
            throw self::translate($e);
        } finally {
            $pdo = null;
        }
    }

    /** Map driver errors to stable codes without leaking credentials or full SQL. */
    public static function translate(PDOException $e): DataException
    {
        $msg = $e->getMessage();
        $state = (string) $e->getCode();
        return match (true) {
            str_contains($msg, 'max_execution_time') || str_contains($msg, 'statement timeout') || str_contains($msg, 'canceling statement due to statement timeout') || $state === '57014' || str_contains($msg, '3024')
                => new DataException('QUERY_TIMEOUT', 'The query took too long and was stopped. Try narrowing it (a shorter time range or a filter).', retryable: true),
            str_contains($msg, 'read-only') || str_contains($msg, 'READ ONLY') || $state === '25006' || str_contains($msg, '1792')
                => new DataException('READ_ONLY_VIOLATION', 'The database refused a write inside a read-only transaction.'),
            str_contains($msg, 'Lock wait timeout') || str_contains($msg, 'lock timeout') || $state === '55P03'
                => new DataException('LOCK_TIMEOUT', 'The rows are locked by another transaction right now. Nothing was changed; try again shortly.', retryable: true),
            default => new DataException('DB_ERROR', 'The database returned an error: ' . self::safeMessage($e)),
        };
    }

    public static function safeMessage(\Throwable $e): string
    {
        // PDO messages can echo the DSN or user name; keep only the server's sentence.
        $m = preg_replace('/\b(?:password|pwd)=\S+/i', 'password=***', $e->getMessage()) ?? '';
        $m = preg_replace('/^SQLSTATE\[[^\]]+\]:?\s*(\[[^\]]+\]\s*)?/', '', $m) ?? $m;
        return mb_substr(trim($m), 0, 300);
    }
}
