# ORCHESTRATION_AND_TOOL_PROTOCOL.md
## Canonical Orchestration Contract & Tool Protocol Specification

**Version:** 2.0.0  
**Status:** Approved Specification  

---

### 1. Protocol Overview

The orchestration protocol defines the structured contract between:
- **Client (Frontend)** and **Control Plane (Laravel)**
- **Control Plane (Laravel)** and **AI Service (FastAPI)**
- **AI Service (FastAPI)** and **LLM Provider (Ollama / Cloud)**

Every communication carries a `correlation_id`, `plan_version`, and `idempotency_key` to guarantee safe replay, interruption recovery, and audit tracking.

---

### 2. Request & Decision Schema

#### 2.1 AI Service Plan Request (`POST /v1/ai/agent/plan`)
```json
{
  "correlation_id": "9f3a8b21-4d1e-4f3b-8c29-3a1b2c3d4e5f",
  "goal_prompt": "Connect to my local blog db on 127.0.0.1, user root, port 3306, db name my_blog",
  "accumulated_slots": {
    "host": "127.0.0.1",
    "port": 3306,
    "database": "my_blog",
    "username": "root",
    "name": "Local Blog"
  },
  "missing_slots": ["password"],
  "rag_context": [
    {
      "source_id": "PRODUCT_CONTEXT_RAG.md#sec-6",
      "text": "MySQL connection requires host, port (default 3306), database name, username, and password. Test connection before saving."
    }
  ],
  "available_tools": [
    {
      "name": "save_database_connection",
      "description": "Test and save a validated MySQL database connection profile.",
      "parameters": {
        "host": {"type": "string", "required": true},
        "port": {"type": "integer", "required": true, "default": 3306},
        "database": {"type": "string", "required": true},
        "username": {"type": "string", "required": true},
        "password": {"type": "string", "required": true, "is_secret": true},
        "name": {"type": "string", "required": false}
      }
    }
  ],
  "provider": "ollama",
  "model": "llama3.2:1b"
}
```

#### 2.2 Decision Categories (`outcome`)
The model/reasoner must classify each turn into one of seven canonical outcomes:
1. `SUPPORTED_AND_SPECIFIED`: All required slots are available. Emits ordered plan steps to execute.
2. `MISSING_INFORMATION`: Request is recognized, but one or more required slots are missing. Emits a single concise question targeting only the missing slot.
3. `AMBIGUOUS`: Multiple resources match (e.g. multiple connections exist). Requests clarification.
4. `UNSUPPORTED`: Request is outside platform capabilities. Honestly explains boundaries.
5. `DISALLOWED_BY_POLICY`: Request attempts destructive SQL or safety violation. Formally refused.
6. `CURRENTLY_UNAVAILABLE`: Capability exists in product but prerequisite is missing (e.g. creating automation before connecting database).
7. `RECOVER_FROM_ERROR`: Prior step failed; planner adapts plan or asks for revised input.

---

### 3. Tool Execution & Observation Contract

When a tool executes in Laravel via `AgentToolRegistry::executeTool()`, it produces a typed observation:
```json
{
  "call_id": "call_67a1b2c3",
  "tool": "test_database_connection",
  "success": true,
  "result_category": "SUCCESS",
  "domain_status": "CONNECTION_TEST_PASSED",
  "data": {
    "server_version": "8.0.35-MySQL",
    "latency_ms": 1.45,
    "ssl_active": false
  },
  "safe_summary": "Successfully connected to MySQL 8.0.35 on 127.0.0.1:3306 in 1.45ms.",
  "side_effect_committed": false,
  "retryable": true,
  "trace_id": "tr_89a0b1c2"
}
```

This observation is stored in `AgentTaskTimelineEvent` and broadcasted over SSE as `agent.timeline_event`.
If subsequent steps exist in the plan, the orchestrator passes the observation to the next step or queries the model for follow-up reasoning.

---

### 4. Spoken Response Synthesis (`POST /v1/ai/agent/synthesize-response`)

The LLM is invoked to generate truthful, concise speech based on actual execution results:
- **Input:** User initial goal, executed steps, real tool outputs, verified status.
- **Output:** Concise natural speech (1-2 sentences), contextually tailored to the verified outcome.
- **Guarantee:** Never speaks "Connection saved" unless `domain_status === 'SAVED'` is verified from persistent storage.
