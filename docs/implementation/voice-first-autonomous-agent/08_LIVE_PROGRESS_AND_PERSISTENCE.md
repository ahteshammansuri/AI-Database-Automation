# Live Progress and Persistence Specification

## 1. Durable Server-Side Persistence
All agent tasks and operations persist in the platform database:
- `agent_conversations`: Holds user-scoped consultation sessions.
- `agent_tasks`: Tracks `task_type`, `goal`, `status`, `autonomy_level`, `active_plan`, `current_step_index`, `idempotency_key`, `target_resource_type`, `target_resource_id`, timestamps.
- `agent_task_timeline_events`: Immutable audit log of every step executed (`step_name`, `status`, `message`, `details`, `created_at`).
- `user_agent_preferences`: Stores user-configured preferences (`autonomy_level`, `voice_responses_enabled`, `speech_rate`).

## 2. Reconnection & Page Reload Recovery
- If the user reloads the browser, navigates to a new tab, or temporarily loses internet connection:
  - On mount, `AssistantContext.tsx` calls `api.listAgentConversations()` and `api.getAgentConversation(latestId)`.
  - The latest active task and timeline events are retrieved directly from the Laravel server.
  - The UI restores the active task status, step progress, and mascot state without re-running or duplicating writes.

## 3. Realtime Live Event Streaming
- Server-Sent Events (SSE) stream on `/api/live-events/stream`.
- Events emitted:
  - `agent.task_updated`: Emitted whenever task status or step index changes.
  - `agent.step_completed`: Emitted with verified step outcome and timing.
  - `agent.interrupted`: Emitted upon user pause or stop.
- Frontend `LiveEventsContext.tsx` receives SSE payloads and triggers reactive updates in `AssistantContext.tsx`.
