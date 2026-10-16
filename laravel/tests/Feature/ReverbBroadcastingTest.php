<?php

namespace Tests\Feature;

use App\Events\WorkspaceLiveEvent;
use App\Models\User;
use App\Services\LiveEventService;
use Illuminate\Support\Facades\Event;
use Tests\TestCase;

class ReverbBroadcastingTest extends TestCase
{
    public function test_live_event_service_broadcasts_workspace_live_event(): void
    {
        Event::fake([WorkspaceLiveEvent::class]);

        $user = User::factory()->create();

        LiveEventService::publish($user->id, 'automation.completed', [
            'automation_id' => 12,
            'status' => 'PUBLISHED',
        ], 'Automation', '12');

        Event::assertDispatched(WorkspaceLiveEvent::class, function ($event) use ($user) {
            return $event->userId === $user->id
                && $event->eventData['event_name'] === 'automation.completed'
                && $event->eventData['payload']['status'] === 'PUBLISHED'
                && $event->broadcastOn()[0]->name === 'private-workspace.' . $user->id;
        });
    }
}
