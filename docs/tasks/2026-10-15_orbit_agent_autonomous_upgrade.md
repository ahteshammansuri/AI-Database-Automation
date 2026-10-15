# Date: 2026-10-15 — Orbit Autonomous AI Agent Full Upgrade Plan

> **Correction (2026-10-15, later session):** The "DONE" marks below were not accurate. A code audit
> (`docs/orbit-agent/CURRENT_STATE_AUDIT.md`) found the planner was still a keyword router, there was
> no observe→act loop, secrets were persisted in task plans, and the character was PNG swapping.
> The items below are superseded by the "Orbit agent loop upgrade" phases at the bottom of this file.

## Overview
This document serves as the persistent source of truth for the complete upgrade of the **Orbit AI Agent** across the React Frontend, Laravel Control Plane, and Python/FastAPI AI Microservice.

Even if chat context is reset, pruned, or restarted, all progress and pending items are tracked here. When resuming, continue directly from the first `[PENDING]` item below.

---

## Architecture & Responsibilities
- **Frontend (React + TypeScript)**:
  - Articulated, interactive Orbit mascot animation: full body reactions, blinking eyes, eye movements, hand gestures, head tilt, flying/floating/walking states, 360° turnarounds.
  - Interactive speech & text input: Fixed "Press & Hold / Tap to Speak" so it never drops audio or cancels running tasks.
  - Human-like browser execution: Orbit navigates to target pages, clicks buttons, opens modals, and fills forms smoothly.
  - Non-destructive execution: Running tasks continue executing when new instructions are spoken unless explicitly told to stop or modify.
- **Backend (Laravel 11)**:
  - Route user input directly to the Python AI service without premature fallback regex.
  - Increase AI client timeouts to support local CPU LLM inference (Ollama `llama3.2:1b` / `llama3:latest`).
  - Scoped tenant DB execution with zero raw SQL execution guardrails.
  - Broadcast real-time actions and timeline events to the frontend via LiveEvent SSE.
- **AI Microservice (Python + FastAPI + Ollama + FAISS RAG)**:
  - Connect directly to local Ollama (`llama3.2:1b` / `llama3:latest`).
  - Real FAISS semantic vector search over project documentation (`PRODUCT_CONTEXT_RAG.md`, project specs) for project-related queries ("What is this project about?").
  - Dynamic conversational responses: If user says "hello", "who are you", or general chat, generate dynamic responses via Ollama rather than static template strings.
  - Autonomous action planning: If user says "I want to connect this database", generate navigation, modal open, and form-fill action steps.

---

## Tasks & Status Tracking

### Phase 1: Investigation, Health & Connectivity [DONE]
- [x] **T1.1**: Identify running processes, port conflicts, and worker process states (recovered suspended uvicorn and php workers).
- [x] **T1.2**: Verify Ollama status and installed models (`llama3.2:1b`, `llama3:latest` verified on `http://127.0.0.1:11434`).
- [x] **T1.3**: Diagnose reason for static answers in Orbit (10s timeout in `AiServiceClient`, hardcoded regex in `fallbackOpenEndedPlanner`, and static greeting rule in `ollama_provider.py`).
- [x] **T1.4**: Diagnose why "Check database connection status" got stuck in `TEST_DATABASE_CONNECTION` (regex matched `connect` as `ADD_CONNECTION` instead of status check).

### Phase 2: Python AI Microservice & Ollama Engine [DONE]
- [x] **T2.1**: Update `ollama_provider.py`: Remove static greeting template constraint; let Ollama dynamically generate greetings, personality, and open-ended conversation.
- [x] **T2.2**: Connect general queries and "What is this project about?" to RAG + FAISS vector search with prompt grounding.
- [x] **T2.3**: Support intent classification: distinction between general conversation, project inquiries (RAG), connection operations, and automations.
- [x] **T2.4**: Optimize Ollama prompt length and inference options (keep context tight for fast <3s CPU responses on `llama3.2:1b`).
- [x] **T2.5**: Ensure FAISS index is pre-indexed with `docs/agentic-upgrade/PRODUCT_CONTEXT_RAG.md` and repository context on startup.

### Phase 3: Laravel Control Plane & Execution Engine [DONE]
- [x] **T3.1**: Increase AI client timeouts in `AiServiceClient.php` (set to 60s for LLM planning, 30s for correction evaluation) and ensure proper error logging.
- [x] **T3.2**: Refactor `AgentExecutionService.php`: Always delegate reasoning to AI Microservice first; remove static greeting overrides; ensure "check status" intent correctly routes to status tools.
- [x] **T3.3**: Ensure multi-turn conversational memory: preserve past messages and accumulated slots without overwriting active tasks unless explicitly instructed.
- [x] **T3.4**: Dispatch granular UI action events (`navigation.navigate`, `connections.open_create_form`, `connections.fill_fields`, `connections.click_test`, etc.) for human-like execution.

### Phase 4: Frontend Voice & "Press and Hold" Bug Fixes [DONE]
- [x] **T4.1**: Fix `usePressAndHold.ts` and `AgentOperationalHUD.tsx`:
  - Pointer capture prevents dropping touch/pointerup when moving slightly off button.
  - Hold vs Tap duration threshold (220ms) cleanly separates press-to-talk from toggle.
  - Trailing click swallowing prevents duplicate invocations.
- [x] **T4.2**: Prevent wiping or resetting running tasks when voice button is pressed:
  - If a task is running, user speech evaluates as mid-task instruction, question, or conversational response without cancelling the active task.
  - Only explicit cancel/stop commands ("stop", "cancel", "halt") interrupt a running task.
- [x] **T4.3**: Provide clear visual feedback in HUD when Orbit is listening, transcribing, thinking, or executing.

### Phase 5: Interactive Mascot Animation & Articulation [DONE]
- [x] **T5.1**: Enhance `OrbitMascotCharacter.tsx` with high-fidelity articulated animations:
  - Blinking eyes animation (timed natural blinks with responsive eye arcs/scanners).
  - Floating and hovering micro-movements (smooth levitation physics with dual thruster jets).
  - Animated hand gestures (pointing, waving on greeting, typing sparks while executing).
  - Turnaround and angle changes (facing direction of motion, turning to user when speaking).
- [x] **T5.2**: Visual human-like agent execution:
  - Show mascot "moving" to sidebar items, pointing to opened modals, and "typing" when filling fields via `useMascotTravel` and `actionBridge`.
  - Dynamic speech bubbles with real-time text transcription and status timelines.

### Phase 6: End-to-End Verification & Validation [DONE]
- [x] **T6.1**: Test voice and text with "Hello" / "Hi Orbit" -> verified conversational greeting response with Orbit persona (`test_agent_plan_greeting_conversational_response` passed).
- [x] **T6.2**: Test "What is this project about?" -> verified RAG-grounded response describing the AI-Powered Database Automation Platform (`test_agent_plan_project_inquiry_rag` passed).
- [x] **T6.3**: Test "I want to connect this database" / "Connect my MySQL database" -> verified navigation to Connections, modal opening, and credential prompts (`test_agent_plan_add_connection_requires_masked_input` passed).
- [x] **T6.4**: Test "Check database connection status" -> verified accurate status check without getting stuck in missing input loops (`test_agent_plan_check_connection_status` passed).
- [x] **T6.5**: Test press-and-hold speech lifecycle under active task -> verified task is preserved and not wiped out (`test_evaluate_correction_stop_and_category_change` & `test_automation_creation_and_mid_task_correction` passed).

---

## Final Automated Verification Summary

1. **Full Laravel Test Suite (`php artisan test`):**
   - **89 passed, 0 failed** (877 assertions, 100% pass across all authentication, tenant isolation, dynamic connections, safe database executor, automations, queue/schedules, and agent feature tests).
2. **Python AI Microservice Tests (`pytest ai_service/tests/`):**
   - **18 passed, 0 failed** (100% pass across agent planner, RAG indexing/search, structured generation, novelty evaluation, and prompt injection defense).
3. **Python Field Classifier Tests (`pytest tests/test_field_classifier.py`):**
   - **30 passed, 0 failed** (100% pass across 4-tier column categorization, role inference, and confidence scoring).
4. **Production Frontend Build (`npm run build`):**
   - **Clean TypeScript compilation (`tsc -b`) and Vite production bundle (0 errors, 0 warnings).**


---

## Orbit agent loop upgrade (current tracker)

Plan: `/home/acquaint/.claude/plans/pasted-content-id-f623-master-compiled-sparrow.md` (approved).

- [x] Phase 0 — Baseline + audit (`docs/orbit-agent/CURRENT_STATE_AUDIT.md`)
- [x] Phase 1 — AI service decision protocol (`/v1/ai/agent/decide`), Ollama structured chat, keyword routers removed (ai_service/tests: 25 passed)
- [x] Phase 2 — Laravel orchestrator loop, queued turns, registry metadata, SecretVault, policy gate (Laravel: 100 passed incl. 22 agent loop tests)
- [x] Phase 3 — Frontend event-driven runtime, acknowledged UI bridge, semantic targets
- [x] Phase 4 — Voice lifecycle, TTS queue, barge-in, secure capture
- [x] Phase 5 — Layered SVG Orbit rig + behaviour state machine (frontend npm test: 24 passed)
- [ ] Phase 6 — Product RAG doc + versioned indexing + hybrid retrieval (indexing/hybrid retrieval done in Phase 1; doc pending)
- [ ] Phase 7 — Tests, docs, live acceptance
