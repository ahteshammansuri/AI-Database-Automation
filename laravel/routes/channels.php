<?php

use Illuminate\Support\Facades\Broadcast;

Broadcast::routes(['middleware' => ['auth:sanctum'], 'prefix' => 'api']);

Broadcast::channel('workspace.{userId}', function ($user, $userId) {
    return (int) $user->id === (int) $userId;
});

