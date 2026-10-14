# AGENTIC_ARCHITECTURE.md
## Target Agentic Control Plane & Operational Architecture

**Scope:** Canonical interaction between User, Frontend Operation Bridge, Laravel Control Plane, and Python AI Service.

---

### 1. Architectural Principles

1. **Model Reasons, Application Governs:**
   The LLM (Ollama `llama3.2:1b` / `llama3:latest` locally, or user-configured cloud provider) interprets natural language, resolves semantic slots, retrieves relevant product knowledge, and selects typed tools. The Laravel application and frontend control plane own authorization, tenant scoping, real form state, schema inspection, database transactions, and data integrity.
2. **Real Tool Loop with Observed Outcomes:**
   Every tool execution produces a typed observation (`success`, `status`, `data`, `safe_summary`, `error_category`). The observation is returned to the orchestrator and model to decide the next step or synthesize truthful speech.
3. **Visibly Operated Portal:**
   Visual mascot travel and UI animations are synchronized with real frontend component events through a typed `FrontendActionBridge`. Motion reflects actual state; it is never a substitute for backend execution.
4. **Zero Shared Secrets in Conversational History or LLM Prompts:**
   Database passwords, cloud API keys, and sensitive tokens are routed through isolated secure capture handlers and encrypted at rest using Laravel's application encryption. They are excluded from prompts, RAG indexes, logs, events, and TTS audio.

---

### 2. End-to-End Orchestration Sequence

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Frontend as React Portal (FrontendActionBridge)
    participant Mascot as Orbit Mascot Character
    participant Laravel as Laravel Control Plane (AgentExecutionService)
    participant Python as Python AI Service (AgentPlanner + RAG)
    participant Ollama as Local LLM (Ollama)
    participant DB as Target MySQL Database

    User->>Frontend: Speaks natural request (e.g. "Connect to my_blog on localhost, user root, port 3306")
    Frontend->>Frontend: Pre-process audio transcript & isolate credentials
    Frontend->>Laravel: POST /api/agent/conversations/{id}/messages
    Laravel->>Laravel: Load active task state & non-secret accumulated slots
    Laravel->>Python: POST /v1/ai/agent/plan (goal, slots, tools, RAG context)
    Python->>Python: Query FAISS RAG for relevant product documentation chunks
    Python->>Ollama: POST /api/chat with system prompt, tool schemas, RAG chunks & prompt
    Ollama-->>Python: Structured decision (Tool call / Missing slot question / Clarification)
    Python-->>Laravel: Validated AgentPlanResponse (plan steps, slots, missing fields)
    
    alt If required non-secret or secret slots are missing
        Laravel-->>Frontend: Return WAITING_FOR_INPUT + concise focused question
        Frontend->>Mascot: Animate to waiting_for_user + speak focused question
        User->>Frontend: Answers missing detail (e.g. provides password or database name)
    else If plan is ready to execute
        Laravel->>Laravel: Validate permissions, tenant ownership & idempotency
        Laravel-->>Frontend: Emit live action event (agent.action_requested)
        Frontend->>Frontend: Bridge navigates to /connections, mounts form & populates slots
        Frontend->>Mascot: Move to connection form anchor & display field typing
        Frontend->>Laravel: POST /api/connections/test (real handshake)
        Laravel->>DB: Handshake & ping (read-only verification)
        DB-->>Laravel: Handshake verified, latency 1.2ms
        Laravel->>DB: Save connection profile (AES-256 encrypted password)
        Laravel->>Laravel: Verify saved profile reloaded under current user
        Laravel->>Python: POST /v1/ai/agent/synthesize-response (tool observation)
        Python->>Ollama: Generate truthful, natural spoken summary
        Ollama-->>Python: "I've connected to your MySQL database 'my_blog' on host 127.0.0.1 and verified the connection."
        Python-->>Laravel: Spoken summary text
        Laravel-->>Frontend: Emit agent.task_updated (SUCCEEDED) + message
        Frontend->>Mascot: State -> success, speak verified outcome
    end
```

---

### 3. Layer Responsibilities

| Subsystem | Responsibilities | Forbidden Activities |
|---|---|---|
| **React Frontend** | Captures voice, manages `FrontendActionBridge`, dispatches component actions (`open_form`, `fill_fields`, `trigger_test`), animates mascot based on real SSE lifecycle events, renders masked inputs. | No direct customer DB connections, no bypassing Laravel authentication, no fake success toasts. |
| **Laravel Control Plane** | Authoritative user session, tenant isolation, DB credential encryption at rest, tool registry execution, queue worker, scheduler, audit logs, idempotency enforcement, safe parameterized SQL only. | Never execute customer `DROP`, `DELETE`, `TRUNCATE`, `ALTER`, or AI-generated SQL. |
| **Python AI Service** | RAG indexing/retrieval with FAISS, prompt assembly, Ollama client integration, structured Pydantic decision validation, response synthesis. | No direct customer database access, no storing credentials in plaintext logs or vector indexes. |
