<?php

namespace App\Services\Agent;

use App\Models\DbConnection;
use App\Models\SchemaSnapshot;
use App\Models\User;

/**
 * Which of the user's databases an Orbit data tool works on. Never a guess: a connection the user owns and named, or
 * their only active one. With several and none given, the tool answers CONNECTION_REQUIRED listing the candidates
 * (and which of them have the table asked about), so the model asks the user or uses the one they named.
 */
class ConnectionResolver
{
    /**
     * @return array{connection: DbConnection}|array{success: false, error_category: string, error: string, connections?: list<array>}
     */
    public static function resolve(User $user, mixed $connectionId, ?string $table = null): array
    {
        if ($connectionId !== null && $connectionId !== '') {
            $connection = is_numeric($connectionId)
                ? DbConnection::where('user_id', $user->id)->find((int) $connectionId)
                : null;

            return $connection ? ['connection' => $connection] : [
                'success' => false,
                'error_category' => 'NOT_FOUND',
                'error' => "Connection {$connectionId} is not in this workspace.",
                'connections' => self::candidates($user, $table),
            ];
        }

        $active = DbConnection::where('user_id', $user->id)->where('is_active', true)->orderBy('id')->get();
        if ($active->count() === 1) {
            return ['connection' => $active->first()];
        }
        if ($active->isEmpty()) {
            return ['success' => false, 'error_category' => 'NO_CONNECTION', 'error' => 'No database is connected yet.'];
        }

        $candidates = self::candidates($user, $table);
        $withTable = $table ? array_values(array_filter($candidates, fn ($c) => $c['has_table'] === true)) : [];
        $list = implode('; ', array_map(
            fn ($c) => "{$c['name']} (connection_id {$c['id']}, database {$c['database']}"
                . ($table && $c['has_table'] !== null ? ($c['has_table'] ? ", has {$table}" : ", no {$table}") : '') . ')',
            $candidates,
        ));

        return [
            'success' => false,
            'error_category' => 'CONNECTION_REQUIRED',
            'error' => 'Several databases are connected and no connection_id was given, so nothing was done. '
                . ($table && count($withTable) === 1
                    ? "Only {$withTable[0]['name']} has a table {$table}. "
                    : '')
                . "Candidates: {$list}.",
            'connections' => $candidates,
        ];
    }

    /** The user's active connections, with whether the latest scan has the table (null: not scanned or not asked). */
    public static function candidates(User $user, ?string $table = null): array
    {
        return DbConnection::where('user_id', $user->id)->where('is_active', true)->orderBy('id')->limit(20)->get()
            ->map(function (DbConnection $c) use ($user, $table) {
                $hasTable = null;
                if ($table !== null && $table !== '') {
                    $snapshot = SchemaSnapshot::where('user_id', $user->id)->where('connection_id', $c->id)->latest('id')->first();
                    if ($snapshot) {
                        $names = array_map(fn ($t) => strtolower((string) ($t['name'] ?? $t['table_name'] ?? '')), $snapshot->schema_payload['tables'] ?? []);
                        $hasTable = in_array(strtolower($table), $names, true);
                    }
                }

                return ['id' => $c->id, 'name' => $c->name, 'database' => $c->database_name, 'has_table' => $hasTable];
            })->all();
    }
}
