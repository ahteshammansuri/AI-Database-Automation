<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\LiveEventService;
use App\Models\User;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Laravel\Sanctum\PersonalAccessToken;

class LiveEventController extends Controller
{
    /**
     * Non-blocking Server-Sent Events (SSE) stream.
     * Delivers pending workspace events immediately and finishes to prevent
     * locking single-threaded PHP workers (e.g. php artisan serve).
     */
    public function stream(Request $request): StreamedResponse
    {
        $user = $this->resolveUser($request);

        if (!$user) {
            abort(401, 'Unauthorized access to live workspace event stream.');
        }

        $userId = $user->id;
        $lastEventId = (int) ($request->header('Last-Event-ID', $request->query('since', 0)));

        $response = new StreamedResponse(function () use ($userId, $lastEventId) {
            if (ob_get_level()) {
                ob_end_clean();
            }

            // Instruct browser to reconnect after 3.5s
            echo "retry: 3500\n";
            echo "event: connected\n";
            echo "data: " . json_encode(['status' => 'connected', 'user_id' => $userId, 'time' => now()->toIso8601String()]) . "\n\n";

            $events = LiveEventService::getEventsSince($userId, $lastEventId, 30);

            if (!empty($events)) {
                foreach ($events as $evt) {
                    echo "id: {$evt['id']}\n";
                    echo "event: {$evt['event_type']}\n";
                    echo "data: " . json_encode($evt) . "\n\n";
                }
            } else {
                echo ": keepalive\n\n";
            }

            flush();
            // Non-blocking: exit immediately so the PHP server worker is instantly freed
        });

        $response->headers->set('Content-Type', 'text/event-stream');
        $response->headers->set('Cache-Control', 'no-cache, no-store, must-revalidate');
        $response->headers->set('Connection', 'close');
        $response->headers->set('X-Accel-Buffering', 'no');

        return $response;
    }

    /**
     * Ultra-fast non-blocking HTTP endpoint for event polling and catch-up.
     */
    public function events(Request $request)
    {
        $user = $this->resolveUser($request);

        if (!$user) {
            return response()->json(['error' => 'Unauthorized'], 401);
        }

        $sinceId = (int) $request->query('since_id', $request->query('since', 0));
        $limit = min((int) $request->query('limit', 50), 100);

        $events = LiveEventService::getEventsSince($user->id, $sinceId, $limit);

        return response()->json([
            'events' => $events,
            'latest_id' => !empty($events) ? end($events)['id'] : $sinceId,
        ]);
    }

    /**
     * Resolve authenticated user from request header or query token.
     */
    protected function resolveUser(Request $request): ?User
    {
        if ($request->user()) {
            return $request->user();
        }

        $tokenStr = $request->query('token');
        if (!$tokenStr) {
            $header = $request->header('Authorization', '');
            if (str_starts_with($header, 'Bearer ')) {
                $tokenStr = substr($header, 7);
            }
        }

        if ($tokenStr) {
            $accessToken = PersonalAccessToken::findToken($tokenStr);
            if ($accessToken && (!$accessToken->expires_at || $accessToken->expires_at->isFuture())) {
                return $accessToken->tokenable;
            }
        }

        return null;
    }
}
