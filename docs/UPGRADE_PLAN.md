# Upgrade Plan — Multi-User AI Database Automation Platform

**Date:** October 9, 2026  
**Objective:** Incrementally upgrade existing codebase to achieve full Master Prompt compliance without rewriting working foundations.

---

## Phase 1: Security, Table Eligibility & Intelligent Relational Engine (Backend & Executor)

### 1.1 Four-Tier Deterministic Table Eligibility Engine
- **File:** `laravel/app/Services/DatabaseSafetyService.php`, `laravel/app/Services/SchemaIntrospectionService.php`
- **Actions:**
  - Implement 4-tier classification:
    - `RECOMMENDED`: Has content attributes (e.g. `title`, `name`, `content`, `body`, `excerpt`, `description`, `slug`, `status`), not restricted, 0–2 required foreign keys.
    - `REVIEW_REQUIRED`: Valid table, but has complex non-null foreign keys, multiple dependencies, or ambiguous structure requiring user confirmation.
    - `RESTRICTED`: Matches hard-deny rules (auth, passwords, credentials, tokens, payments, transactions, audit logs, migrations, roles, permissions).
    - `READ_ONLY`: Reference / system metadata tables where writes are prohibited.
  - Return explicit `eligibility_tier`, `evidence` array, and `restriction_reason` in schema metadata.

### 1.2 Intelligent Relational Record Resolver
- **File:** `laravel/app/Services/SafeDatabaseExecutor.php`
- **Actions:**
  - Build `resolveRelationalValue()`:
    1. Read column foreign key metadata (`referenced_table`, `referenced_column`).
    2. Lookup strategy: If incoming payload provides an ID or a semantic string (e.g. `"Electric Vehicles"`):
       - If numeric, query referenced table to verify actual existence.
       - If string, query referenced table matching `slug` or `name` or `title` using parameterized SQL.
    3. If record exists: Return real primary key ID.
    4. If record is missing: Check `creation_policy`:
       - `REUSE_EXISTING_ONLY`: Stop and throw exception or fall back to safe existing.
       - `CREATE_IF_MISSING`: Check referenced table eligibility (cannot create restricted entities!). Check allowed insert columns. Dynamically create referenced row (e.g., `INSERT INTO categories (name, slug) VALUES ('Electric Vehicles', 'electric-vehicles')`) inside the current transaction, retrieve `lastInsertId`, and return it.
       - `ASK_APPROVAL`: Flag execution as pending approval for new entity creation.
    5. Handle concurrency / duplicate key collision (`SQLSTATE 23000`): Re-read existing record and reuse ID.
  - Add execution trace events into transaction execution history.

### 1.3 Schema Snapshot & Semantic Annotations
- **Migration:** `laravel/database/migrations/2026_10_09_140000_create_schema_snapshots_and_annotations.php`
  - `schema_snapshots`: `id`, `user_id`, `connection_id`, `version`, `schema_payload`, `table_count`, `column_count`, `created_at`.
  - `schema_table_annotations`: `id`, `user_id`, `connection_id`, `table_name`, `ai_purpose`, `ai_business_concept`, `user_override_notes`, `is_user_verified`, `created_at`, `updated_at`.
- **Controller/Service:** Store versioned snapshot on refresh; compute diff (added/removed tables and columns).

---

## Phase 2: AI Microservice Upgrades & Provider Hardening

### 2.1 Genuine Cloud Provider Adapters
- **File:** `ai_service/app/providers/cloud_providers.py`, `ai_service/app/providers/factory.py`
- **Actions:**
  - Implement real HTTP calls using `httpx`:
    - `OpenAIProvider`: Calls `https://api.openai.com/v1/models` for testing, `https://api.openai.com/v1/chat/completions` with JSON response format.
    - `GeminiProvider`: Calls Google Generative Language API (`/v1beta/models`) for testing and generation.
    - `ClaudeProvider`: Calls Anthropic API (`https://api.anthropic.com/v1/messages`).
  - Graceful, honest error handling: If keys are invalid or quota exhausted, return human-readable diagnostic messages; never pretend success.

### 2.2 Ollama Model Installation Verification
- **File:** `ai_service/app/providers/ollama_provider.py`
- **Actions:**
  - When `test_connection()` is called, query `/api/tags`, extract installed model tags, and verify if `self.model` is present.
  - Return `model_installed: true/false` and explicit instructions (e.g. `ollama run llama3:latest`) if missing.

### 2.3 Natural Language Automation Proposer
- **File:** `ai_service/app/routers/ai.py`, `laravel/app/Http/Controllers/Api/AutomationController.php`
- **Actions:**
  - Endpoint: `POST /api/v1/ai/propose-automation`
  - Input: Discovered schema metadata + user's natural language goal (e.g. *"Create daily articles on AI architectures under Engineering category at 9 AM"*).
  - Output: Structured configuration proposing target table, field mappings, source types (`AI_GENERATED`, `DERIVED_SLUG`, `FIXED_VALUE`, `RELATIONAL_LOOKUP`), relation creation policy (`CREATE_IF_MISSING`), schedule frequency, times, and approval policy.

---

## Phase 3: Background Worker & Scheduler Hardening

### 3.1 Catch-Up Window & Distributed Mutex Lock
- **File:** `laravel/app/Console/Commands/CheckAutomationSchedulesCommand.php`
- **Actions:**
  - Catch-up tolerance: Check if current time is within a 15-minute window of `generation_time` on due dates.
  - Concurrency lock: Use `Cache::lock("automation_exec_{$automation->id}_{$todayDate}", 30)` to prevent duplicate triggers across overlapping worker runs.
  - Check `start_date` and `end_date` bounds.

### 3.2 Structured Execution Timeline & Audit Events
- **Migration:** Add `timeline_events` (JSON) to `automation_executions`.
- **Jobs:** Append discrete lifecycle events (`TRIGGERED`, `SCHEMA_VERIFIED`, `RAG_RETRIEVED`, `AI_GENERATED`, `RELATION_RESOLVED`, `APPROVED`, `COMMITTED`).

---

## Phase 4: Frontend UI/UX Redesign & Interactive Refinements

### 4.1 Natural Language Proposer in Automation Builder
- **File:** `frontend/src/pages/AutomationBuilderPage.tsx`
- **Actions:**
  - Add "AI Natural Language Quick-Start" bar at the top of Step 1: Users type goal and click "Auto-Configure Pipeline".
  - Populates table, fields, relation rules, schedule, and review settings instantly.

### 4.2 4-Tier Schema Classification View
- **File:** `frontend/src/pages/SchemaExplorerPage.tsx`
- **Actions:**
  - Four distinct tabs: `Recommended for Automation` (Green/Indigo badge), `Review Required` (Amber badge), `Restricted / Read-Only` (Rose badge), `All Tables`.
  - Display AI Semantic Purpose explanation and allow user to edit/persist table notes.

### 4.3 Intelligent Relational Selection UI
- **File:** `frontend/src/pages/AutomationBuilderPage.tsx`
- **Actions:**
  - For foreign key fields: Provide choice of:
    1. Select existing record from database lookup.
    2. Dynamic AI Lookup with `Auto-create if missing` toggle.

### 4.4 Execution Timeline in Execution Details
- **File:** `frontend/src/pages/ExecutionsPage.tsx`
- **Actions:**
  - Render an interactive, human-readable timeline showing each step of the pipeline.

---

## Phase 5: Verification, Automated Testing & Delivery

- Run all unit tests, integration tests, PHPUnit suites, pytest suites, and end-to-end multi-user journey scripts.
- Document test outcomes in `docs/TEST_MATRIX.md`.
