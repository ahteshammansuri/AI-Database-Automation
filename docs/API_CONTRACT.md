# API Contract: AI-Powered Database Automation Platform

## 1. Authentication Endpoints (`/api/auth`)

### 1.1 Register
- `POST /api/auth/register`
- Request:
  ```json
  {
    "name": "Jane Doe",
    "email": "jane@example.com",
    "password": "SecurePassword123!",
    "password_confirmation": "SecurePassword123!"
  }
  ```
- Response (201 Created):
  ```json
  {
    "user": { "id": 1, "name": "Jane Doe", "email": "jane@example.com" },
    "token": "1|sanctum_token_string..."
  }
  ```

### 1.2 Login
- `POST /api/auth/login`
- Request:
  ```json
  {
    "email": "jane@example.com",
    "password": "SecurePassword123!"
  }
  ```
- Response (200 OK):
  ```json
  {
    "user": { "id": 1, "name": "Jane Doe", "email": "jane@example.com" },
    "token": "2|sanctum_token_string..."
  }
  ```

### 1.3 Current User & Logout
- `GET /api/auth/me` -> `{ "user": { "id": 1, "name": "Jane Doe", "email": "jane@example.com" } }`
- `POST /api/auth/logout` -> `{ "message": "Logged out successfully" }`

---

## 2. Database Connection Endpoints (`/api/connections`)

### 2.1 List Connections
- `GET /api/connections`
- Response:
  ```json
  [
    {
      "id": 1,
      "name": "Production Blog DB",
      "db_type": "mysql",
      "host": "127.0.0.1",
      "port": 3308,
      "database_name": "demo_blog_cms",
      "username": "root",
      "ssl_mode": "preferred",
      "status": "connected",
      "created_at": "2026-10-09T12:00:00Z"
    }
  ]
  ```

### 2.2 Test Connection (Pre-flight or Stored)
- `POST /api/connections/test`
- Request:
  ```json
  {
    "db_type": "mysql",
    "host": "127.0.0.1",
    "port": 3308,
    "database_name": "demo_blog_cms",
    "username": "root",
    "password": "ipo_root_password",
    "ssl_mode": "preferred"
  }
  ```
- Response:
  ```json
  {
    "success": true,
    "message": "Connection established successfully (MySQL 8.0.46)",
    "latency_ms": 12.4
  }
  ```

### 2.3 Create & Manage Connections
- `POST /api/connections` (Create & save with encrypted password)
- `GET /api/connections/{id}` (Get details, password masked)
- `PUT /api/connections/{id}` (Update connection details)
- `DELETE /api/connections/{id}` (Remove saved profile from platform)

---

## 3. Schema Discovery Endpoints (`/api/schema`)

### 3.1 Introspect Connection Schema
- `GET /api/connections/{id}/schema`
- Response:
  ```json
  {
    "connection_id": 1,
    "database": "demo_blog_cms",
    "tables": [
      {
        "table_name": "posts",
        "is_sensitive": false,
        "eligible_for_automation": true,
        "row_count_approx": 12,
        "columns": [
          { "name": "id", "type": "bigint unsigned", "is_primary_key": true, "is_nullable": false },
          { "name": "title", "type": "varchar(255)", "is_nullable": false, "max_length": 255 },
          { "name": "slug", "type": "varchar(255)", "is_unique": true, "is_nullable": false },
          { "name": "content", "type": "longtext", "is_nullable": false },
          { "name": "status", "type": "enum('draft','published')", "enum_values": ["draft", "published"], "default": "draft" }
        ],
        "relationships": [
          { "foreign_key": "category_id", "referenced_table": "categories", "referenced_column": "id" }
        ]
      },
      {
        "table_name": "users",
        "is_sensitive": true,
        "eligible_for_automation": false,
        "restriction_reason": "Contains authentication / user credentials"
      }
    ]
  }
  ```

---

## 4. Automation Endpoints (`/api/automations`)

### 4.1 Create Automation
- `POST /api/automations`
- Request:
  ```json
  {
    "name": "Weekly Tech Insights Publisher",
    "connection_id": 1,
    "target_table": "posts",
    "operation_mode": "AI_CREATE",
    "field_mappings": [
      { "field_name": "title", "mapping_type": "AI_GENERATED", "prompt_directive": "Engaging technical title" },
      { "field_name": "slug", "mapping_type": "DERIVED_SLUG", "source_field": "title" },
      { "field_name": "content", "mapping_type": "AI_GENERATED", "prompt_directive": "In-depth 800-word markdown post" },
      { "field_name": "status", "mapping_type": "FIXED_VALUE", "fixed_value": "published" },
      { "field_name": "created_at", "mapping_type": "RUNTIME_NOW" }
    ],
    "ai_provider": "ollama",
    "ai_model": "llama3.2:latest",
    "prompt_context": "Deep dives into cloud database scalability and reliability patterns",
    "knowledge_document_ids": [1],
    "schedule_type": "DAILY",
    "generation_time": "08:00",
    "publication_time": "09:00",
    "timezone": "Asia/Kolkata",
    "requires_approval": true,
    "reviewer_email": "editor@syntheticsite.com",
    "timeout_policy": "AUTO_PUBLISH_LATEST"
  }
  ```

### 4.2 Run / Trigger Immediately
- `POST /api/automations/{id}/trigger`
- Manually dispatches immediate generation execution job.

---

## 5. Approvals & Content Versions (`/api/approvals`)

### 5.1 Review Content Version by Token
- `GET /api/approvals/{token}`
- Response:
  ```json
  {
    "valid": true,
    "automation_name": "Weekly Tech Insights Publisher",
    "version_number": 1,
    "publication_time": "2026-10-10T09:00:00Z",
    "status": "PENDING_APPROVAL",
    "content_payload": {
      "title": "Scaling MySQL for High-Throughput Workloads",
      "slug": "scaling-mysql-for-high-throughput-workloads",
      "content": "# Scaling MySQL...\n\nFull post here..."
    }
  }
  ```

### 5.2 Approve Version
- `POST /api/approvals/{token}/approve` -> `{ "success": true, "status": "APPROVED" }`

### 5.3 Reject Version with Feedback
- `POST /api/approvals/{token}/reject`
- Request: `{ "feedback": "Make the introduction more practical and include code examples" }`
- Response: `{ "success": true, "status": "REGENERATING", "retry_count": 1 }`

---

## 6. Internal Python AI Service Contract (Port 8001)

### 6.1 Generate Structured Content
- `POST http://127.0.0.1:8001/v1/ai/generate`
- Header: `X-Service-Token: platform_secret_internal_key_2026`
- Request:
  ```json
  {
    "provider": "ollama",
    "model": "llama3.2:latest",
    "prompt": "Write an article on database scalability",
    "system_instructions": "Format as valid JSON conforming to the schema",
    "context_passages": ["Passage 1 from RAG...", "Passage 2..."],
    "target_fields": ["title", "slug", "content", "excerpt"],
    "feedback_history": []
  }
  ```
- Response:
  ```json
  {
    "data": {
      "title": "Scaling MySQL for High-Throughput Workloads",
      "slug": "scaling-mysql-for-high-throughput-workloads",
      "content": "...",
      "excerpt": "..."
    },
    "provider_used": "ollama",
    "latency_seconds": 1.45
  }
  ```

---

## Orbit agent API (observe-act loop)

All routes require `Authorization: Bearer <token>` and are scoped to the signed-in user. A resource that belongs to someone else returns 404.

| Method & path | Body | Response |
|---|---|---|
| `POST /api/agent/conversations/{id}/messages` | `content` (≤4000, secrets are redacted server-side too), `is_voice`, `secure_input_data` (e.g. `{password}`; encrypted into the task vault, never stored in messages), `page_context` (non-secret page snapshot) | **202** `{conversation, task, message, turn_id}`. The turn runs on the `agent` queue; progress arrives as live events. |
| `POST /api/agent/tasks/{id}/interrupt` | `action`: `STOP` \| `PAUSE` \| `RESUME` | `{task, message}`. A running task stops or pauses at the next safe step. |
| `POST /api/agent/tasks/{id}/confirm` | — | **202** and runs the exact pending tool call; **409** if nothing is pending. |
| `POST /api/agent/tasks/{id}/correct` | `correction` | Same as posting a message (the model interprets it). |
| `POST /api/agent/ui-actions/{correlationId}/ack` | `status`: `ok` \| `validation_error` \| `not_mounted` \| `error` \| `timeout`; `result`: `{errors?, values?, message?}` | `{correlation_id, status}` |
| `POST /api/agent/heartbeat` | — | `{ok, server_time}`. Marks this browser as able to show UI actions (30 s TTL). |
| `GET /api/agent/tasks/{id}` / `.../timeline` | — | Task with `status`, `stage`, `plan_version`, `pending_tool_call`, `last_decision`, and timeline. |
| `GET /api/agent/tools` | — | `tools` (definitions), `model_visible` (what the model sees), `availability`. |
| `GET /api/live/events?since_id=N` / `?baseline=1` | — | Ordered persisted events; `baseline=1` returns only `latest_id` (no replay). |

### Internal AI service

`POST /v1/ai/agent/decide` (requires `X-Service-Token`). It receives the utterance, runtime context, tool schemas, observations, slots, provider/model, and a server-derived `user_id`. It returns `{success, decision (orbit.v1), error_category, rag {attempted, used, source_ids, index_version, embedding_backend, chunks}, model_used, duration_ms, repairs}`.

Error categories: `MODEL_UNAVAILABLE`, `MODEL_OUTPUT_INVALID`, `PROVIDER_ERROR`, `PROVIDER_UNSUPPORTED`.

The old `/v1/ai/agent/plan`, `/evaluate-correction` and `/synthesize-response` endpoints have been removed.

### Orbit on-screen operation

| Method & path | Body | Response |
|---|---|---|
| `GET /api/agent/surfaces` | — | The server-owned surface catalog `{version, pages[], surfaces[]}` (fields, actions, `consequential`, `verifies`). |
| `POST /api/agent/tasks/{id}/continue` | `surface`, `field` (a `secret` field of that surface), optional `page_context`. **Secret values are rejected (422).** | **202**: queues the next turn with the note "I typed the … myself". |

UI actions requested by the agent loop arrive as `agent.ui_action` events: `surface.go_to_page`, `surface.open_form`, `surface.read_screen`, `surface.fill_fields`, `surface.choose_option`, `surface.press`, `surface.ask_secret_in_form`, `surface.show_me`. The browser acknowledges each one via `POST /api/agent/ui-actions/{correlationId}/ack` with `{status, result}`, where `result` may contain `success`, `message`, `resource{type,id}`, `missing_required`, `fields`, `candidates` and `data`. The server sanitises it (secret-like keys dropped, size capped).
