# Autonomous AI Agent Assistant — Implementation Plan

**Objective:** Upgrade the existing platform in-place with a genuinely action-capable, animated AI assistant that performs authorized operations on the user's behalf.

---

## Phase Breakdown

### Phase 0: Audit and Plan
- Complete audit in `docs/AUTONOMOUS_ASSISTANT_AUDIT.md`.
- Implementation plan in `docs/AUTONOMOUS_ASSISTANT_PLAN.md`.
- Record architectural decisions in `docs/DECISIONS.md`.

### Phase 1: Action Model, State Machine & Backend Tool Registry
- **Database Migrations:**
  - `agent_conversations` (`id`, `user_id`, `title`, `status`, `metadata`, `created_at`, `updated_at`)
  - `agent_messages` (`id`, `conversation_id`, `role`, `content`, `tool_calls`, `tool_results`, `secure_input_type`, `is_voice`, `created_at`)
  - `agent_tasks` (`id`, `user_id`, `conversation_id`, `task_type`, `goal`, `status`, `autonomy_level`, `active_plan`, `current_step_index`, `idempotency_key`, `target_resource_type`, `target_resource_id`, `cancelled_at`, `paused_at`, `created_at`, `updated_at`)
  - `agent_task_timeline_events` (`id`, `task_id`, `step_name`, `status`, `message`, `details`, `correlation_id`, `created_at`)
  - `user_agent_preferences` (`user_id`, `autonomy_level`, `voice_enabled`, `created_at`, `updated_at`)
- **Backend Tool Registry (`App\Services\Agent\AgentToolRegistry`):**
  - Tool definitions with strict typed argument validation, tenant isolation, and risk classification:
    - Connection tools: `list_database_connections`, `test_database_connection`, `save_database_connection`, `scan_database_schema`, `get_schema_scan_status`
    - Knowledge tools: `list_knowledge_sources`, `search_knowledge_base`
    - Automation tools: `create_automation_draft`, `get_automation_details`, `update_automation_configuration`, `enable_automation`, `pause_automation`, `resume_automation`, `run_automation_now`
    - Content/execution tools: `get_execution_status`, `get_execution_timeline`, `request_execution_interrupt`, `update_published_record`
    - Approval tools: `get_pending_approvals`, `approve_content_version`, `reject_content_version`
    - Monitoring tools: `get_dashboard_summary`, `get_provider_health`, `explain_execution_failure`
  - Strict guardrails: Zero destructive SQL tools.
- **Agent Orchestrator Service (`App\Services\Agent\AgentExecutionService`):**
  - Manages task lifecycle, executes registered tools sequentially with idempotency checks, records timeline events, emits real-time events via `LiveEventService`.
- **Laravel API Routes & Controller (`AgentController`):**
  - `GET /api/agent/conversations`: list conversations
  - `POST /api/agent/conversations`: start new conversation
  - `GET /api/agent/conversations/{id}`: get conversation with messages and active task
  - `POST /api/agent/conversations/{id}/messages`: post typed or voice message
  - `POST /api/agent/tasks/{id}/interrupt`: request immediate stop/pause
  - `POST /api/agent/tasks/{id}/correct`: submit typed/voice correction during execution
  - `POST /api/agent/tasks/{id}/confirm`: confirm pending consequential step
  - `GET /api/agent/tasks/{id}/timeline`: get task timeline events
  - `GET /api/agent/preferences` & `PUT /api/agent/preferences`: user autonomy preferences
- **Feature Tests:** PHPUnit/Pest tests verifying ToolRegistry, execution scoping, IDOR isolation, and safety guards.

### Phase 2: Natural Language Intent, Adaptive Clarification & Python AI Microservice
- **Python FastAPI Agent Router (`ai_service/app/routers/agent.py`):**
  - `POST /v1/ai/agent/plan`: parses natural language request into target tool and typed arguments; detects missing required fields.
  - `POST /v1/ai/agent/evaluate-correction`: evaluates user's mid-task feedback into `STOP`, `PAUSE`, `CHANGE_PARAMETER`, `CANCEL_UNCOMMITTED`, or `NEW_REQUEST`.
  - Deterministic rule-based fallback inside Laravel so the agent always functions even if the local LLM is temporarily offline.
- **Adaptive Clarification Engine:**
  - Detects missing parameters and generates short, single-step conversational questions.
  - Detects sensitive fields (passwords, API keys) and triggers secure masked form input cards instead of text responses.

### Phase 3: Real-Time Event Streaming & Resumable Tasks
- **Live Event Integration:**
  - Publishes `agent.timeline_event`, `agent.task_updated`, and `agent.step_completed` via `LiveEventService`.
  - Frontend `LiveEventsContext` broadcasts events to all subscribers.
  - Tasks persist in the database; users can navigate or close the drawer while background tasks continue.

### Phase 4: Distinctive Animated Character & Premium UI
- **Original "Orbital Core" Character Component (`OrbitalCoreCharacter.tsx`):**
  - Layered SVG/CSS concentric orbital rings, pulsating energy core, orbital nodes, and particle flux.
  - 14 distinct states: `IDLE`, `LISTENING`, `TRANSCRIBING`, `THINKING`, `ASKING`, `PLANNING`, `WORKING`, `WAITING_FOR_EXTERNAL`, `VALIDATING`, `INTERRUPTING`, `PAUSED`, `SUCCEEDED`, `PARTIAL_SUCCESS`, `FAILED`.
  - Smooth 60fps CSS/Framer Motion animations with `prefers-reduced-motion` compliance.
- **Floating Assistant Launcher (`AssistantLauncher.tsx`):**
  - Persistent bottom-right floating widget with state glow, active task pill, and keyboard shortcut (`Cmd/Ctrl + J`).
- **Assistant Panel & Drawer (`AssistantDrawer.tsx`):**
  - Top header with animated character, state badge, and autonomy mode selector.
  - Interactive conversation stream with rich action cards and editable field summaries.
  - Live task card with active stage, elapsed timer, live timeline, collapsible technical execution trace.
  - Secure credential input card for entering database passwords safely.
  - Global Stop, Pause, and Correct buttons always accessible during execution.
- **Voice Recognition & Audio Visualizer (`VoiceInputControl.tsx`):**
  - Push-to-talk microphone button using Web Speech API.
  - Audio waveform indicator, transcription preview, and voice interruption support.
- **Conflicting Manual Edits Guard (`ActiveTaskGuardBanner.tsx`):**
  - Warns user when the assistant is actively modifying a resource and prevents duplicate conflicting edits.

### Phase 5: Instant Interruption, Correction & Recovery
- Cancellation token pattern in `AgentExecutionService`.
- Checking cancellation boundaries before and after each atomic tool step.
- Handling `INTERRUPT_REQUESTED`:
  - If uncommitted: invalidate remaining plan steps, apply user correction, re-plan.
  - If already committed: explain committed state honestly, offer safe compensating update.
- Bounded retries and error classification (retryable vs. permanent).

### Phase 6: Hardening, Automated Verification & Documentation
- Comprehensive test runs:
  - Laravel Feature Tests (`php artisan test`)
  - AI Service Pytest Tests (`PYTHONPATH=. pytest ai_service/tests`)
  - End-to-end autonomous agent verification script (`scripts/verify_autonomous_agent.py`)
  - Frontend build verification (`npm run build`)
- Update `docs/TEST_RESULTS.md` and `docs/DECISIONS.md`.
