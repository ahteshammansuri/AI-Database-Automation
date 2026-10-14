# Current State Audit: Baseline & Anti-Pattern Analysis

## 1. Existing Assistant Codebase Audit
An inspection of the workspace revealed the following existing assistant components and services:

| Component / File | Current Role | Identified Deficiency & Anti-Pattern |
|---|---|---|
| `frontend/src/components/agent/AssistantDrawer.tsx` | Slide-over drawer (460-500px wide) | **Critical Anti-Pattern**: Conventional text chatbot sidebar with text textarea (`inputRef`), Enter to send, `<Send>` button, message bubbles list (`role: user / assistant`), and canned preset suggestion chips (`handleSendPreset`). Violates Part A and Part B rules. |
| `frontend/src/components/agent/AssistantLauncher.tsx` | Fixed floating button bottom-right (bottom-6 right-6) | Opens the conventional `AssistantDrawer` sidebar instead of hosting a compact operational HUD and floating mascot companion. |
| `frontend/src/components/agent/OrbitalCoreCharacter.tsx` | SVG concentric orbit component | Implements 14 states (IDLE, LISTENING, TRANSCRIBING, THINKING, ASKING, PLANNING, WORKING, WAITING_FOR_EXTERNAL, VALIDATING, INTERRUPTING, PAUSED, SUCCEEDED, PARTIAL_SUCCESS, FAILED). Lacks the full 17 required states (e.g. `activation`, `moving`, `interacting`, `needs_confirmation`, `cancelled`, `offline`), and lacks expressive facial gestures and travel capability. |
| `frontend/src/components/agent/VoiceInputControl.tsx` | Voice recording button | Implements basic Web Speech recognition, but is tied into the drawer input row next to the text composer rather than living on the floating mascot. |
| `frontend/src/components/agent/ActiveTaskTimelineCard.tsx` | Multi-step progress timeline | Shows steps and events; can be condensed and integrated into the compact HUD. |
| `frontend/src/components/agent/SecureCredentialCard.tsx` | Masked credential entry form | High quality; allows entering database host, port, db name, user, password without speaking plaintext secrets. Will be retained for secure in-context entry. |
| `frontend/src/context/AssistantContext.tsx` | Global agent state provider | Manages conversation ID, messages, active task, timeline events. Currently exposes `sendMessage(content, isVoice)` tailored for chat strings. Needs refactoring to support voice-first workflows and travel anchors. |
| `laravel/app/Http/Controllers/Api/AgentController.php` | Backend REST API for Agent | Endpoints: `/conversations`, `/messages`, `/tasks/{id}/interrupt`, `/tasks/{id}/correct`, `/tasks/{id}/confirm`, `/preferences`, `/tools`. Well-structured and operational. |
| `laravel/app/Services/Agent/AgentToolRegistry.php` | Dynamic Capability Registry | 2,219 lines containing full schemas, read-only flags, outcomes, and risk levels for 25+ tools. Verified 100% zero destructive SQL tools. |
| `laravel/app/Services/Agent/AgentExecutionService.php` | Orchestration & Fencing Service | Handles multi-step execution, status transitions, cancellation fencing, and live SSE event broadcasting. |
| `ai_service/app/services/agent_planner.py` | Python AI Semantic Planner | Analyzes user goals and maps to registered tools; identifies missing parameters and policy violations. |

## 2. Baseline Test Results
- **Laravel PHPUnit Test Suite**: 45 passed (579 assertions), duration ~62s.
- **Python PyTest Suite**: 28 passed in 2.98s.
- **Verification Scripts**:
  - `scripts/verify_autonomous_agent.py`: 10/10 phases passed.
  - `scripts/verify_end_to_end.py`: 12/12 steps passed (target MySQL port 3308 writes confirmed).
- **Frontend Build**: `tsc -b && vite build` succeeded in 8.12s.

## 3. Necessary Upgrades
1. **Eliminate Chatbot UI**: Remove `AssistantDrawer.tsx` with its text composer, send button, suggestion chips, and message bubble history.
2. **Implement Aura Core Mascot**: 56-68px floating character at bottom-right with 17 states, expressive eye gestures, and orbital physics.
3. **Travelling Mascot Engine**: Enable the mascot to dynamically compute target coordinates of UI anchors and smoothly glide across the portal during execution.
4. **Compact Operational HUD**: Replace the drawer with a floating, non-chat HUD displaying transient captions, active step progress, stop/pause controls, and focused secure cards.
5. **Voice Input/Output Lifecycle**: Implement push-and-hold + tap toggle voice input, browser TTS audio feedback with mute toggle, and clear permission states.
