<?php

namespace App\Admin;

use App\Services\AiServiceClient;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use PDO;

/**
 * Live checks for the System health page. Every check has a short timeout and never throws; results never contain
 * secrets (no passwords, keys or job payloads).
 */
final class SystemHealth
{
    /** Queues the platform dispatches to; each needs a running worker. */
    public const QUEUES = ['default' => 'Automations and indexing', 'agent' => 'Orbit'];

    private const WORKER_KEY = 'system-health:worker:';
    private const SCHEDULER_KEY = 'system-health:scheduler';

    /** Called by queue workers on every loop (see AppServiceProvider). */
    public static function workerBeat(string $queues): void
    {
        foreach (array_filter(array_map('trim', explode(',', $queues))) as $queue) {
            Cache::put(self::WORKER_KEY . $queue, now()->timestamp, 600);
        }
    }

    /** Called whenever the scheduler starts a task (automations:check-schedule runs every minute). */
    public static function schedulerBeat(): void
    {
        Cache::put(self::SCHEDULER_KEY, now()->timestamp, 3600);
    }

    /** @return array{status:string, summary:string, detail:string, latency_ms:?int} */
    public static function database(): array
    {
        try {
            $t = microtime(true);
            DB::select('select 1');
            $ms = (int) round((microtime(true) - $t) * 1000);
            $pdo = DB::connection()->getPdo();
            $version = (string) $pdo->getAttribute(PDO::ATTR_SERVER_VERSION);
            $driver = ['mysql' => 'MySQL', 'mariadb' => 'MariaDB', 'pgsql' => 'PostgreSQL', 'sqlite' => 'SQLite'][DB::connection()->getDriverName()] ?? DB::connection()->getDriverName();
            return self::row('ok', 'Connected', "{$driver} " . strtok($version, '-') . ' · ' . DB::connection()->getDatabaseName(), $ms);
        } catch (\Throwable $e) {
            return self::row('down', 'Not reachable', self::firstLine($e->getMessage()));
        }
    }

    public static function aiService(): array
    {
        $url = rtrim((string) config('services.ai.url'), '/');
        try {
            $t = microtime(true);
            $res = Http::timeout(3)->acceptJson()->get("{$url}/health");
            $ms = (int) round((microtime(true) - $t) * 1000);
            return $res->successful()
                ? self::row('ok', 'Running', "{$url} · version " . ($res->json('version') ?? '—'), $ms)
                : self::row('down', "Answered HTTP {$res->status()}", $url, $ms);
        } catch (\Throwable) {
            return self::row('down', 'Not reachable', "{$url} did not answer within 3 seconds");
        }
    }

    /** The local model server, checked through the AI service (Laravel never calls Ollama directly). */
    public static function ollama(): array
    {
        $model = (string) config('orbit.default_model');
        $res = app(AiServiceClient::class)->checkHealth('ollama', $model);
        $installed = count($res['models'] ?? []);
        if (!($res['available'] ?? false)) {
            return self::row('down', 'Not available', (string) ($res['message'] ?? 'No answer'));
        }
        $hasModel = collect($res['models'] ?? [])->contains(fn ($m) => $m === $model || str_starts_with((string) $m, $model . ':'));
        return self::row($hasModel ? 'ok' : 'warn', $hasModel ? 'Ready' : "Default model {$model} is not installed",
            "{$installed} " . str('model')->plural($installed) . ' installed · default ' . $model, (int) round((float) ($res['latency_ms'] ?? 0)));
    }

    /** Whether Orbit has the website guides indexed (they live in the database and are published to the AI service). */
    public static function orbitKnowledge(): array
    {
        $included = \App\Models\OrbitKnowledgeGuide::where('is_published', true)->count();
        $live = OrbitKnowledge::liveStatus();
        if ($live === null) {
            return self::row('down', 'Unknown', 'The AI service cannot be reached to report what Orbit knows.');
        }
        $chunks = (int) ($live['chunks'] ?? 0);
        if ($chunks === 0) {
            return self::row($included ? 'warn' : 'down', 'No guides indexed', $included
                ? "{$included} guides are included; they are sent again automatically within 10 minutes, or publish them in Orbit › Knowledge."
                : 'No guide is included. Orbit cannot answer questions about the website.');
        }
        $semantic = str_starts_with((string) ($live['embedding_backend'] ?? ''), 'ollama');
        return self::row($semantic ? 'ok' : 'warn', ((int) ($live['guides'] ?? 0)) . ' guides · ' . $chunks . ' sections',
            ($semantic ? 'Semantic search' : 'Keyword search only (embedding model not reachable)') . ' · version ' . ($live['version'] ?? '—'));
    }

    public static function reverb(): array
    {
        if (config('broadcasting.default') !== 'reverb') {
            return self::row('warn', 'Not used', 'Live updates are off (BROADCAST_CONNECTION is ' . config('broadcasting.default') . ')');
        }
        $host = (string) (config('broadcasting.connections.reverb.options.host') ?: '127.0.0.1');
        $port = (int) (config('broadcasting.connections.reverb.options.port') ?: 8080);
        $t = microtime(true);
        $socket = @fsockopen($host === '0.0.0.0' ? '127.0.0.1' : $host, $port, $errno, $errstr, 2);
        $ms = (int) round((microtime(true) - $t) * 1000);
        if ($socket) {
            fclose($socket);
            return self::row('ok', 'Running', "{$host}:{$port}", $ms);
        }
        return self::row('down', 'Not reachable', "{$host}:{$port} · live updates and Orbit's panel will not refresh by themselves");
    }

    public static function scheduler(): array
    {
        $beat = Cache::get(self::SCHEDULER_KEY);
        if (!$beat) {
            return self::row('down', 'No run seen', 'Scheduled automations do not start without it (php artisan schedule:work, or cron running schedule:run)');
        }
        $age = now()->timestamp - (int) $beat;
        return $age <= 150
            ? self::row('ok', 'Running', 'Last run ' . self::ago($age))
            : self::row('down', 'Stopped', 'Last run ' . self::ago($age) . '. Scheduled automations are not starting.');
    }

    /** Per queue: worker last seen, jobs waiting/running, oldest waiting job. */
    public static function queues(): array
    {
        $database = config('queue.default') === 'database';
        $out = [];
        foreach (self::QUEUES as $queue => $label) {
            $beat = Cache::get(self::WORKER_KEY . $queue);
            $age = $beat ? now()->timestamp - (int) $beat : null;
            $waiting = $running = 0;
            $oldest = null;
            if ($database) {
                $row = DB::table('jobs')->where('queue', $queue)
                    ->selectRaw('sum(case when reserved_at is null then 1 else 0 end) as waiting, sum(case when reserved_at is not null then 1 else 0 end) as running, min(case when reserved_at is null then available_at end) as oldest')
                    ->first();
                $waiting = (int) ($row->waiting ?? 0);
                $running = (int) ($row->running ?? 0);
                $oldest = $row->oldest ? max(0, now()->timestamp - (int) $row->oldest) : null;
            }
            $alive = ($age !== null && $age <= 120) || $running > 0;
            $status = $alive ? (($oldest ?? 0) > 600 ? 'warn' : 'ok') : 'down';
            $out[$queue] = [
                'label' => $label,
                'status' => $status,
                'summary' => $alive ? (($oldest ?? 0) > 600 ? 'Falling behind' : 'Worker running') : 'No worker',
                'worker' => $age === null ? 'Never seen' : 'Seen ' . self::ago($age),
                'waiting' => $waiting,
                'running' => $running,
                'oldest' => $oldest === null ? '—' : self::ago($oldest, false),
                'command' => "php artisan queue:work --queue={$queue}",
            ];
        }
        return $out;
    }

    public static function mail(): array
    {
        $mailer = (string) config('mail.default');
        return in_array($mailer, ['log', 'array'], true)
            ? self::row('warn', 'Not sending', "MAIL_MAILER is {$mailer}: approval emails are written to the log, not delivered")
            : self::row('ok', 'Sending', ucfirst($mailer) . ' · from ' . config('mail.from.address'));
    }

    public static function storage(): array
    {
        $free = @disk_free_space(storage_path());
        $total = @disk_total_space(storage_path());
        if (!$free || !$total) {
            return self::row('warn', 'Unknown', 'Free space could not be read');
        }
        $pct = (int) round($free / $total * 100);
        return self::row($pct < 10 ? 'down' : ($pct < 20 ? 'warn' : 'ok'), self::bytes($free) . ' free', "{$pct}% of " . self::bytes($total) . ' · uploads, logs and media');
    }

    public static function failedJobs(): array
    {
        $total = DB::table('failed_jobs')->count();
        $recent = DB::table('failed_jobs')->where('failed_at', '>=', now()->subDay())->count();
        return self::row($recent ? 'warn' : 'ok', $total ? "{$total} failed" : 'None', $recent ? "{$recent} in the last 24 hours" : 'None in the last 24 hours');
    }

    /**
     * Values that stay in the server environment, and why they cannot be changed from the panel.
     *
     * @return list<array{name:string, value:string, why:string, warn:bool}>
     */
    public static function environment(): array
    {
        $db = config('database.connections.' . config('database.default'), []);
        $set = fn ($v) => filled($v) ? 'Set (never shown)' : 'Not set';
        $boot = 'Needed before the platform database is reachable, so it cannot be stored in it.';
        $secret = 'Secret: kept only in the server environment, never in the database or the browser.';
        return [
            ['name' => 'APP_ENV', 'value' => (string) config('app.env'), 'why' => $boot, 'warn' => false],
            ['name' => 'APP_DEBUG', 'value' => config('app.debug') ? 'On' : 'Off',
                'why' => config('app.debug') && app()->isProduction() ? 'Turn this off in production: error pages show internal details.' : 'Detailed error pages. Keep off in production.',
                'warn' => config('app.debug') && app()->isProduction()],
            ['name' => 'APP_URL', 'value' => (string) config('app.url'), 'why' => 'Address of this API and the admin panel; links in emails and signed URLs depend on it.', 'warn' => false],
            ['name' => 'APP_KEY', 'value' => $set(config('app.key')), 'why' => 'Encrypts stored database passwords and provider keys. Changing it makes them unreadable.', 'warn' => blank(config('app.key'))],
            ['name' => 'DB_CONNECTION · DB_HOST · DB_DATABASE', 'value' => ($db['driver'] ?? '—') . ' · ' . ($db['host'] ?? '—') . ' · ' . ($db['database'] ?? '—'), 'why' => $boot, 'warn' => false],
            ['name' => 'DB_USERNAME · DB_PASSWORD', 'value' => ($db['username'] ?? '—') . ' · ' . $set($db['password'] ?? null), 'why' => $secret, 'warn' => false],
            ['name' => 'QUEUE_CONNECTION', 'value' => (string) config('queue.default'), 'why' => 'Workers read it when they start. Changing it needs a restart of every worker.', 'warn' => config('queue.default') === 'sync'],
            ['name' => 'CACHE_STORE · SESSION_DRIVER', 'value' => config('cache.default') . ' · ' . config('session.driver'), 'why' => 'Settings themselves are cached here, so the store is chosen before settings load.', 'warn' => false],
            ['name' => 'BROADCAST_CONNECTION · REVERB_*', 'value' => config('broadcasting.default') . ' · ' . config('broadcasting.connections.reverb.options.host') . ':' . config('broadcasting.connections.reverb.options.port'), 'why' => 'Real-time server address and keys; the browser bundle is built with them.', 'warn' => false],
            ['name' => 'MAIL_MAILER · MAIL_HOST', 'value' => config('mail.default') . ' · ' . (config('mail.mailers.' . config('mail.default') . '.host') ?: '—'), 'why' => 'Mail transport and its credentials are secrets. Sender name and address are in Settings › General.', 'warn' => in_array(config('mail.default'), ['log', 'array'], true)],
            ['name' => 'AI_SERVICE_KEY', 'value' => $set(config('services.ai.key')), 'why' => $secret . ' The AI service must be started with the same key.', 'warn' => false],
            ['name' => 'PHP · Laravel · Filament', 'value' => PHP_VERSION . ' · ' . app()->version() . ' · ' . (\Composer\InstalledVersions::getPrettyVersion('filament/filament') ?? '—'), 'why' => 'Installed on the server.', 'warn' => false],
        ];
    }

    private static function row(string $status, string $summary, string $detail, ?int $latencyMs = null): array
    {
        return ['status' => $status, 'summary' => $summary, 'detail' => $detail, 'latency_ms' => $latencyMs];
    }

    private static function firstLine(string $text): string
    {
        return mb_substr(strtok($text, "\n") ?: $text, 0, 300);
    }

    private static function ago(int $seconds, bool $suffix = true): string
    {
        $text = $seconds < 60 ? "{$seconds}s" : ($seconds < 3600 ? intdiv($seconds, 60) . ' min' : ($seconds < 86400 ? round($seconds / 3600, 1) . ' h' : round($seconds / 86400, 1) . ' days'));
        return $suffix ? "{$text} ago" : $text;
    }

    private static function bytes(float $bytes): string
    {
        foreach (['B', 'KB', 'MB', 'GB', 'TB'] as $unit) {
            if ($bytes < 1024 || $unit === 'TB') {
                return round($bytes, $unit === 'GB' || $unit === 'TB' ? 1 : 0) . " {$unit}";
            }
            $bytes /= 1024;
        }
        return '';
    }
}
