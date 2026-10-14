# Project Specification: Dynamic Multi-User AI Database Automation Platform

## 1. Executive Summary & Objective
The **AI-Powered Database Automation Platform** is a multi-user, self-service web application enabling individual users to register, log in, connect their own relational databases (starting with MySQL), inspect discovered schema, configure their own AI provider credentials or local model connection (Ollama), and execute AI-generated or manual data automations with durable background processing and human-in-the-loop approval workflows.

The primary showcase is automated blog content generation and scheduled publishing, but the workflow engine is generic and reusable for any allowlisted relational tables (such as product descriptions, FAQs, changelogs, and knowledge bases).

---

## 2. Architecture & Technology Stack
The platform follows a three-tier decoupled architecture:
1. **Control Plane / Backend (Laravel 11, PHP 8.3):**
   - User authentication, registration, session/token security (Laravel Sanctum).
   - Multi-tenant resource ownership and authorization policies (preventing IDOR).
   - Dynamic customer database connection management, credential encryption at rest (`Crypt::encryptString`).
   - Connection validation, SSRF defense, and read-only MySQL schema discovery.
   - Automation configuration, field mapping compiler, and business rule enforcement.
   - Safe target database execution layer: strictly allowlisted, parameterized `INSERT` and scoped `UPDATE` queries. Zero arbitrary SQL, no `DELETE`, `DROP`, `TRUNCATE`, or DDL.
   - Sensitive table protection (auth, passwords, payments, tokens, audits blocked by default).
   - Background processing via Laravel database queues and scheduler.
   - Human-in-the-loop email approval engine with signed single-use tokens and versioned regeneration feedback loops.
   - Comprehensive audit logging for all operations.
2. **AI & RAG Service (Python 3.12, FastAPI):**
   - Internal microservice authenticated via service token (`X-Service-Token`).
   - Adapters for Ollama (default local LLM), Mock provider (for offline tests/demos), and optional user-configured cloud providers (OpenAI, Gemini, Anthropic).
   - Document ingestion and parsing: Markdown (`.md`), text (`.txt`), and PDF (`.pdf` via PyMuPDF).
   - Chunking, local embeddings, and FAISS vector indexing partitioned by tenant/user.
   - Semantic RAG retrieval and structured JSON content generation.
   - STRICT BOUNDARY: The AI service has NO direct access to customer databases and does not handle user authentication or write SQL.
3. **Frontend (React 19, TypeScript, Vite, Tailwind CSS):**
   - Public landing/service page explaining product value, security boundaries, and local vs cloud AI choices.
   - User registration and login flows.
   - First-run empty dashboard with database connection onboarding wizard.
   - Interactive database connection manager, schema explorer, AI provider settings, knowledge base manager, automation wizard, version history viewer, approval portal, and audit logs.
   - 100% dynamic data driven by REST API—zero hardcoded mock metrics.

---

## 3. Core Functional Requirements

### 3.1 Authentication & Tenancy
- Public landing page with register and login actions.
- Real user registration, login, logout, password hashing (Bcrypt), and token-based API authentication.
- Resource ownership scoping: all database connections, AI keys, knowledge documents, automations, content versions, approval tokens, and logs are strictly scoped to the authenticated user.
- IDOR prevention on every read and mutation endpoint.

### 3.2 Dynamic Database Connections & Safety
- Users enter connection details: Name, Host, Port, Database, Username, Password, SSL mode.
- SSRF prevention: blocks cloud metadata IPs (169.254.169.254), link-local IPs, and arbitrary ports. Local network allowed only in local development mode.
- Credentials stored encrypted at rest; secrets masked in API responses (`********`).
- Read-only schema discovery introspecting tables, columns, types, primary keys, foreign keys, unique constraints, nullability, and enums.
- Default-deny policy: automatically marks tables containing authentication, passwords, tokens, payments, orders, or audits as restricted.

### 3.3 AI Providers & Local RAG Pipeline
- Local Ollama (`http://localhost:11434`) as the primary zero-cost path.
- Mock provider for deterministic automated testing and offline fallback.
- Optional user-configured cloud provider keys (OpenAI, Gemini, Claude) stored encrypted in the platform DB.
- File uploads: Markdown, TXT, and PDF. Text extraction, overlapping chunking, local vector embeddings, and FAISS indexing.
- Context-augmented structured generation returning schema-validated JSON.

### 3.4 Automation & Safe Execution Engine
- Wizard: Connection -> Eligible Table -> Mode (AI Create, AI Enrich, Manual Schedule) -> Field Mappings -> Context / Prompt -> Schedule & Approval Policy.
- Safe execution: Parameterized query builder exclusively. Transactions with automatic rollback. Idempotency keys prevent duplicate runs.
- Absolute prohibition of destructive queries: strictly no `DELETE`, `DROP`, `TRUNCATE`, `ALTER`, `CREATE TABLE`, `RENAME`, `GRANT`, `REVOKE`, or arbitrary raw SQL console.

### 3.5 Approval & Scheduled Publishing
- Configurable generation time (e.g. 08:00) ahead of publication time (e.g. 09:00) with IANA timezone support.
- Immutable `ContentVersion` creation with `PENDING_APPROVAL` status.
- Notification email with rich preview and signed single-use action tokens.
- Reviewer actions:
  - **Approve:** Marks version approved, commits to target database at scheduled publication time.
  - **Reject with Feedback:** Preserves rejected record, feeds reviewer feedback to AI service, generates new version (up to 3 retries).
  - **Timeout:** Configurable policy (auto-publish latest pending version or cancel/keep draft).
- Manual content scheduling supported with zero AI invocation.
