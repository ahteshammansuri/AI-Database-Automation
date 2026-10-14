# Architecture: AI-Powered Database Automation Platform

## 1. System Overview

The system is decoupled into three distinct tiers:
1. **React 19 + TypeScript Frontend (Port 5173):** Presentation, user onboarding, public landing page, and authenticated dashboard.
2. **Laravel 11 / PHP 8.3 Control Plane (Port 8000):** Main backend owning authentication, tenancy, encrypted storage, schema discovery, safe database execution, background queue workers, scheduling, email approvals, and audit logging.
3. **Python 3.12 / FastAPI AI Service (Port 8001):** Internal AI service handling Ollama/local LLM inference, optional cloud LLM adapters, RAG document ingestion, chunking, embeddings, FAISS indexing, and structured JSON generation.

```mermaid
flowchart TB
    subgraph Client ["Frontend (React 19 + TypeScript + Vite + Tailwind)"]
        Landing["Public Landing Page"]
        AuthUI["Login / Register / Onboarding"]
        Dashboard["Dashboard & Stats"]
        ConnWizard["Connection & Schema Explorer"]
        AutoBuilder["Automation Wizard & Manual Scheduler"]
        ApprovalUI["Email Approval & Review Portal"]
        KBManager["Knowledge Base & Document Uploader"]
    end

    subgraph LaravelBackend ["Control Plane Backend (Laravel 11 / PHP 8.3)"]
        Sanctum["Laravel Sanctum Auth & Tenancy"]
        ConnManager["Scoped MySQL Connection Manager"]
        Introspector["Read-Only Schema Introspector"]
        SafeExecutor["Safe Database Executor (Parameterized INSERT/UPDATE)"]
        Guardrails["Security Guardrails & Blocked Table Policy"]
        QueueWorker["Laravel Queue Worker (Database Queue)"]
        Scheduler["Laravel Scheduler (Cron / Scheduled Jobs)"]
        EmailService["Approval Mailer & Token Verifier"]
        AuditLogger["Tenant Audit Logger"]
    end

    subgraph PlatformDB [(Platform Persistence DB - MySQL 8)]
        PlatformTables["users, db_connections, ai_providers, automations, executions, versions, tokens, audit_logs"]
    end

    subgraph PythonAIService ["AI & RAG Service (Python 3.12 / FastAPI)"]
        AIServer["FastAPI Server (Internal Port 8001)"]
        AuthMiddleware["Service Token Auth (X-Service-Token)"]
        ProviderRouter["LLM Router (Ollama / Mock / Cloud)"]
        RAGPipeline["RAG Engine (Chunking, Embeddings, FAISS)"]
        JSONGenerator["Structured JSON Content Generator"]
    end

    subgraph ExternalTargets ["External & Target Systems"]
        TargetMySQL[(Target Customer MySQL Databases)]
        OllamaEngine["Local Ollama Service (:11434)"]
        ReviewerMailbox["Reviewer Email (SMTP / Mailpit)"]
    end

    Client -->|REST API with Bearer Token| Sanctum
    Sanctum --> ConnManager
    Sanctum --> Introspector
    Sanctum --> AutoBuilder
    Sanctum --> SafeExecutor
    Sanctum --> QueueWorker
    Sanctum --> Scheduler
    
    LaravelBackend -->|Encrypted Reads / Writes| PlatformDB
    
    LaravelBackend -->|Internal REST Calls with X-Service-Token| AIServer
    AIServer --> AuthMiddleware
    AuthMiddleware --> ProviderRouter
    AuthMiddleware --> RAGPipeline
    ProviderRouter --> OllamaEngine
    
    SafeExecutor -->|Strict Allowlisted Parameterized SQL| TargetMySQL
    Introspector -->|Read-only Metadata Queries| TargetMySQL
    EmailService -->|Approval Emails| ReviewerMailbox
```

---

## 2. Component Responsibilities & Boundaries

### 2.1 React Frontend (`frontend/`)
- Pure client-side SPA.
- Uses JWT / Sanctum Bearer tokens for all authenticated API requests.
- Never stores target database passwords or raw AI provider keys.
- Renders rich form wizards, schema trees, live connection status, version comparison, and markdown preview.

### 2.2 Laravel Control Plane (`laravel/`)
- **Authentication & Tenancy:** Manages users, workspaces, and resource policies. Every database query is scoped by `user_id`.
- **Dynamic Database Connections:** Stores customer connection profiles with credentials encrypted using `Crypt::encryptString`. Connections are ephemeral and scoped to the active execution block.
- **Schema Introspection:** Queries `information_schema.tables`, `columns`, `key_column_usage`, and `statistics` safely. Automatically classifies tables matching auth/payment patterns as restricted.
- **Safe Database Executor:** Parameterized `INSERT` and scoped `UPDATE` only. Executes in database transactions with rollback on failure. Idempotency keys prevent duplicate execution. Rejects any query containing forbidden DDL/DML keywords.
- **Background Queue & Scheduler:** Leverages Laravel's native queue system (`php artisan queue:work`) and scheduler (`php artisan schedule:run`).
- **Approval Engine:** Generates HMAC-signed expiring tokens (`/approvals/{token}`). Sends notification emails. Handles approval commits and rejection feedback regeneration.
- **Audit Logging:** Logs all security-sensitive actions (connection tests, mutations, generation runs, approvals) with tenant attribution.

### 2.3 Python AI Service (`ai_service/`)
- Runs as an internal microservice on `127.0.0.1:8001`.
- Authenticates incoming requests via `X-Service-Token`.
- Connects to Ollama on `http://localhost:11434` (with fallback to high-fidelity Mock provider when Ollama is unavailable).
- Manages user-isolated FAISS vector indexes stored in `ai_service/indexes/{user_id}/`.
- Emits structured JSON payloads validating target schema constraints.
- **STRICT NON-RESPONSIBILITY:** Never executes SQL against customer databases, never manages customer credentials, never authenticates end users.

---

## 3. Communication Contract (Laravel <-> Python)

All communication between Laravel and the Python AI service occurs over internal HTTP:
- `POST /v1/ai/generate`: Laravel sends prompt, schema constraints, RAG context, and provider options. Python returns structured JSON.
- `POST /v1/ai/health`: Laravel checks Ollama / provider availability.
- `POST /v1/rag/index`: Laravel passes extracted text and document ID. Python chunks, embeds, and updates FAISS index.
- `POST /v1/rag/query`: Laravel sends search query and user ID. Python returns relevant text chunks with similarity scores.
- `DELETE /v1/rag/index/{user_id}/{doc_id}`: Laravel requests removal of a document from FAISS.
