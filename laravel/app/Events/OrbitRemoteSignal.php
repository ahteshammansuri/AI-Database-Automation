<?php

namespace App\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * Server notice on a paired phone's channel (`orbit-remote.{publicId}`): paired, command status, ended.
 * Live Orbit state between the tab and the phone travels as client events on the same channel.
 */
class OrbitRemoteSignal implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets;

    public function __construct(
        public string $publicId,
        public string $type,
        public array $data = []
    ) {}

    public function broadcastOn(): array
    {
        return [new PrivateChannel('orbit-remote.' . $this->publicId)];
    }

    public function broadcastAs(): string
    {
        return 'remote.signal';
    }

    public function broadcastWith(): array
    {
        return ['type' => $this->type] + $this->data;
    }
}
