<?php

namespace App\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * Real-time workspace event broadcast via Laravel Reverb WebSockets.
 * Implements ShouldBroadcastNow for zero-latency, push-based delivery to browser.
 */
class WorkspaceLiveEvent implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public int $userId,
        public array $eventData
    ) {}

    public function broadcastOn(): array
    {
        return [
            new PrivateChannel('workspace.' . $this->userId),
        ];
    }

    public function broadcastAs(): string
    {
        return 'workspace.event';
    }

    public function broadcastWith(): array
    {
        return $this->eventData;
    }
}
