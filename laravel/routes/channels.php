<?php

use Illuminate\Support\Facades\Broadcast;

Broadcast::routes(['middleware' => ['auth:sanctum'], 'prefix' => 'api']);

Broadcast::channel('workspace.{userId}', function ($user, $userId) {
    return (int) $user->id === (int) $userId;
});

// Orbit Remote: the signed-in tab's side of a paired phone's channel (the phone authorises through its own endpoint).
Broadcast::channel('orbit-remote.{publicId}', function ($user, $publicId) {
    return \App\Models\OrbitRemoteSession::where('public_id', $publicId)
        ->where('user_id', $user->id)
        ->whereIn('status', ['pending', 'active'])
        ->exists();
});
