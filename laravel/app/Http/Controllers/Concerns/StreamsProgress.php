<?php

namespace App\Http\Controllers\Concerns;

use Symfony\Component\HttpFoundation\Response;

/**
 * Long requests that report real progress: with ?stream=1 the response is one JSON object per line
 * ({type: "event", stage, message} as each step happens, then {type: "result"} or {type: "error", status}).
 * Without it, the same work returns one JSON response.
 */
trait StreamsProgress
{
    /**
     * @param  callable(callable(string, string): void): array{0: int, 1: array}  $work  receives $emit(stage, message), returns [status, body]
     */
    protected function respondWithProgress(bool $stream, callable $work): Response
    {
        if (!$stream) {
            [$status, $body] = $work(fn () => null);
            return response()->json($body, $status);
        }

        return response()->stream(function () use ($work) {
            $line = function (array $data) {
                echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . "\n";
                if (ob_get_level() > 0) {
                    @ob_flush();
                }
                flush();
            };
            $line(['type' => 'event', 'stage' => 'STARTED', 'message' => 'Started.', 'timestamp' => now()->toIso8601String()]);
            [$status, $body] = $work(fn (string $stage, string $message) => $line(['type' => 'event', 'stage' => $stage, 'message' => $message, 'timestamp' => now()->toIso8601String()]));
            $line($status === 200 ? ['type' => 'result'] + $body : ['type' => 'error', 'status' => $status] + $body);
        }, 200, [
            'Content-Type' => 'application/x-ndjson',
            'Cache-Control' => 'no-cache',
            'X-Accel-Buffering' => 'no',
        ]);
    }
}
