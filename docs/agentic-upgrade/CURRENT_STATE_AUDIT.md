# CURRENT_STATE_AUDIT.md
## Baseline Audit & Root Cause Analysis — Agentic Voice-First Operator

**Date:** 2026-10-14  
**Auditor:** Antigravity AI Engineering Team  
**Scope:** Frontend (React + TypeScript), Control Plane (Laravel 11), AI Microservice (FastAPI + Python), Database Connectivity, and Voice/Mascot System.

---

### 1. Executive Summary & Core Defect

The current application provides an extensive foundation with Laravel 11 as the multi-tenant control plane, FastAPI as the AI microservice, and React 19 for the frontend portal. It has 45 passing Laravel feature tests and 28 passing Python tests.

However, the autonomous voice-first agent exhibits critical gaps that prevent it from being a true agentic operator:
1. **Keyword/Regex Phrase Matching Instead of Genuine LLM Reasoning:**
   In `ai_service/app/services/agent_planner.py` (829 lines), `AgentPlanner.plan()` relies entirely on string matching (`lower = goal.lower()`, `destructive_patterns`, `unsupported_keywords`, `is_conn_intent = any(...)`). It **never** invokes the configured Ollama or cloud provider model during task planning!
2. **Missing Product RAG in Planning:**
   Although `docs/agentic-upgrade/PRODUCT_CONTEXT_RAG.md` exists, it is not indexed in the FAISS vector database. The agent planner does not perform RAG retrieval, so no product knowledge reaches the planner.
3. **Slot Erasure and Premature Modal Abandonment:**
   When a user speaks a natural connection request such as `"Connect to MySQL database named my_blog on host 127.0.0.1, user root, port 3306"`, `AgentPlanner` ignores all supplied values, defaults to hardcoded strings (`MySQL Target`, `127.0.0.1`, `3306`), declares `MISSING_INFORMATION`, and displays a generic modal asking the user to manually type in all details. It does not extract or preserve valid non-secret slots.
4. **Lack of Real Frontend Operation Bridge:**
   `AssistantContext.tsx` contains `mapIntentToNavigation()`, which only triggers route navigation (`setActiveRoute('/connections')`) and sets an anchor. It does not open the actual modal, does not populate component form fields, does not trigger client-side validation, does not invoke the actual `testConnection` button on the form, and does not observe real driver responses.
5. **No Observe-Act Loop with Real Tool Feedback:**
   The assistant does not feed tool execution results back to the LLM to synthesize truthful contextual speech. Spoken responses are either raw prompt questions or static text.
6. **No Dynamic Compensation or Plan Versioning:**
   Corrections do not cleanly supersede stale plan versions; idempotency keys are not systematically threaded through multi-step executions.

---

### 2. End-to-End Tracing of User Utterance

#### Step 1: Voice Input & Speech-to-Text
- **File:** `frontend/src/hooks/useVoiceLifecycle.ts` & `frontend/src/components/agent/VoiceInputControl.tsx`
- **Current Behavior:** Captures Web Speech API transcript and passes it to `handleVoiceTranscript(t)` in `AssistantContext.tsx`.
- **Finding:** Clean transcript is emitted, but interruption logic only does exact string match for `"stop"`, `"cancel"`, `"pause"`.

#### Step 2: Frontend Message Dispatch
- **File:** `frontend/src/context/AssistantContext.tsx`
- **Current Behavior:** Calls `api.postAgentMessage(convId, content, isVoice, secureInputData)`.
- **Finding:** Sends raw content without pre-filtering sensitive credentials from voice transcripts.

#### Step 3: Laravel Control Plane Handler
- **File:** `laravel/app/Http/Controllers/Api/AgentController.php` & `laravel/app/Services/Agent/AgentExecutionService.php`
- **Current Behavior:** Records `AgentMessage`, gathers workspace context (connections, automations, executions), and calls `AiServiceClient::planAgentTask()`.
- **Finding:** If Python returns a plan, Laravel accepts it. If Python fails or returns empty, Laravel falls back to `fallbackOpenEndedPlanner()`, which is another hardcoded string-matching function (`str_contains($lower, 'connect')`).

#### Step 4: Python AI Service Planner
- **File:** `ai_service/app/services/agent_planner.py`
- **Current Behavior:** `AgentPlanner.plan(req)` receives `AgentPlanRequest`.
- **Confirmed Defect:** Despite accepting `req.provider` and `req.model`, it **never calls `OllamaProvider` or any LLM**. It evaluates regexes against `req.goal_prompt.lower()`, returns fixed `AgentPlanStep` arrays, and marks connection requests as `MISSING_INFORMATION`.

#### Step 5: Frontend UI Interaction
- **File:** `frontend/src/context/AssistantContext.tsx` & `frontend/src/pages/ConnectionsPage.tsx`
- **Current Behavior:** `mapIntentToNavigation()` changes route to `/connections`.
- **Confirmed Defect:** The actual `ConnectionsPage` has its own internal state (`showModal`, `form`, `handleSave`, `handleTest`). The agent does not interact with this component state. The user is presented with an open or closed page and must click and fill fields manually.

---

### 3. Confirmed Evidence vs. Hypotheses

| Category | Observation | Status | Evidence in Code |
|---|---|---|---|
| **LLM Call** | Model is never called for planning | **CONFIRMED** | `ai_service/app/services/agent_planner.py:25-320`: zero imports of `OllamaProvider`, zero calls to `httpx` or model client. |
| **RAG** | Product context is not retrieved | **CONFIRMED** | `agent_planner.py` has no reference to `rag_service`. `PRODUCT_CONTEXT_RAG.md` is unindexed in FAISS. |
| **Slot Extraction** | Non-secret parameters are erased | **CONFIRMED** | `agent_planner.py:218-232` hardcodes `{"name": "MySQL Target", "host": "127.0.0.1", "port": 3306}` irrespective of user utterance. |
| **Frontend Bridge** | Agent does not operate form components | **CONFIRMED** | `AssistantContext.tsx:264-336` only sets route string. `ConnectionsPage.tsx` has no listener for agent bridge events. |
| **Tool Execution** | Backend tools execute, but lack model feedback loop | **CONFIRMED** | `AgentExecutionService.php:246` executes `AgentToolRegistry::executeTool()`, but the result is formatted into a fixed message rather than sent to the model for next-step reasoning. |
| **Voice & Speech** | Speech uses raw prompt/canned text | **CONFIRMED** | `AssistantContext.tsx:359` sets `lastSpokenSpeech` directly from message content without contextual synthesis. |

---

### 4. Baseline Test Results

- **Python Tests (`pytest tests/`):** 28 passed.
  - Tests verify unit logic for AI providers, automations, connectors, health, RAG, and safety guardrails.
  - Note: Tests pass because they test individual isolated methods, not end-to-end agent autonomous execution.
- **Laravel Tests (`php artisan test`):** 45 passed (579 assertions).
  - Feature tests pass because existing mocks and unit tests assert the old regex-based behavior.
- **Frontend Build (`npm run build`):** Built successfully in 3.54s without TypeScript errors.

---

### 5. Architectural Remediation Plan

To transform this into a genuine agentic operator:
1. **Canonical LLM Reasoner:** Replace keyword-matching in `agent_planner.py` with structured LLM calls via `OllamaProvider` (and cloud providers when configured), passing RAG product context, live capabilities, conversation memory, and slot state.
2. **Product RAG Indexing:** Ingest `PRODUCT_CONTEXT_RAG.md` into the FAISS vector index with namespace isolation.
3. **Multi-Turn Slot Collector:** Extract all spoken non-secret slots (`host`, `port`, `database`, `username`, `name`) into structured task state. Only prompt for genuinely missing required fields.
4. **Secure Secret Isolation:** Strip passwords and sensitive tokens before sending transcripts to the LLM or saving to chat history. Route secrets through a dedicated secure channel.
5. **Real Frontend Operation Bridge:** Implement an event-driven `FrontendActionBridge` in `frontend/src/services/actionBridge.ts` registered to `ConnectionsPage` and other pages. Support typed UI actions: `open_create_form`, `fill_fields`, `trigger_test_connection`, `submit_form`.
6. **Observe-Act Feedback Loop:** Pass tool execution results back to the LLM to decide whether to proceed, recover, or conclude with a verified spoken summary.
