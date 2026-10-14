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
