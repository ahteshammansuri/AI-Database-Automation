<?php

/*
 * Orbit agent runtime configuration (platform-level only; no per-user data or secrets).
 */
return [
    // Platform default model when a user has not chosen a planner model or active provider.
    'default_provider' => env('AI_PROVIDER', 'ollama'),
    'default_model' => env('AI_MODEL', 'qwen2.5:3b'),

    // Observe-act loop bounds. Defaults suit CPU-only local models, where one decision can
    // take tens of seconds, and multi-step on-screen work (e.g. all five builder steps from one
    // long request needs ~15-20 decisions). Keep: decide < turn < job timeout (RunAgentTurnJob)
    // < worker --timeout (run_all.sh: 1600) < retry_after of the "agent" queue connection (1620).
    'max_iterations' => (int) env('ORBIT_MAX_ITERATIONS', 24),
    'max_turn_seconds' => (int) env('ORBIT_MAX_TURN_SECONDS', 1500),
    'decide_timeout_seconds' => (int) env('ORBIT_DECIDE_TIMEOUT', 300),
    'max_repairs' => (int) env('ORBIT_MAX_REPAIRS', 1),

    // Visible UI choreography: how long to wait for the browser to acknowledge an action,
    // and how recent a client heartbeat must be for the browser to count as present.
    'ui_ack_timeout_seconds' => (float) env('ORBIT_UI_ACK_TIMEOUT', 6),
    'client_heartbeat_ttl_seconds' => (int) env('ORBIT_CLIENT_HEARTBEAT_TTL', 30),

    // Secure inputs (passwords/API keys) expire if not used.
    'secure_input_ttl_minutes' => (int) env('ORBIT_SECURE_INPUT_TTL', 30),
];
