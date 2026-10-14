# Feature Gap Analysis — Multi-User AI Database Automation Platform

**Date:** October 9, 2026  
**Scope:** Master Prompt Requirements vs. Existing Baseline  

---

## 1. Feature Analysis Matrix

| Feature | Existing State | Gap | Planned Change | Acceptance Test | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Multi-User Authentication & Isolation** | Sanctum bearer tokens, user registration, login, logout, tenant-scoped DB queries. | Working well; needs strict audit coverage for all newly added endpoints. | Add cross-tenant test assertions for new schema snapshots, semantic descriptions, and relation lookup endpoints. | Cross-user query test returns 404 or 403 on another user's connection ID. | **Partial / Solid Base** |
| **2. Dynamic Database Connections & Secrets** | MySQL host/port/db/user/pass stored encrypted with Laravel `Crypt`. Scoped PDO factory. SSRF blocked on metadata IPs. | Only basic SSRF check; lacks port safety validation on dangerous system ports. | Enhance `validateConnectionTarget` to check against unsafe ports (SSH, Telnet, SMTP, Consul, Redis) and localhost dev flags. | Test attempting connection to port 22 or 169.254.169.254 fails with explicit error. | **Partial** |
| **3. Schema Introspection & Discovery** | Reads `information_schema` live on request. Returns tables, columns, data types, keys, enums, FKs. | No persistent schema snapshot, no versioning, no drift detection (added/modified columns). | Create `schema_snapshots` table with JSON schema payload, scan timestamp, and table diff computation engine. | Calling refresh reports added/removed tables and columns accurately. | **Partial** |
| **4. Table Eligibility & Policy Engine** | Binary classification (`RESTRICTED` vs `ALLOWLISTED`) based on table name tokens. | Master prompt requires 4-tier categorization: `RECOMMENDED`, `REVIEW_REQUIRED`, `RESTRICTED`, `READ_ONLY` with explicit policy reasons. | Build deterministic rule engine evaluating column types (title, text, status), foreign key counts, nullability, and hard deny keywords. | Unit tests classify `posts` as `RECOMMENDED`, `post_tags` as `REVIEW_REQUIRED`, `users`/`payments` as `RESTRICTED`. | **Gap** |
| **5. AI Semantic Schema Suggestions** | None. Schema explorer only shows raw MySQL column names and types. | AI does not interpret schema semantics, propose table purpose, or allow user workspace overrides. | Add AI endpoint to generate table purpose & column meanings; persist workspace notes in `schema_table_annotations`. | API returns AI suggestions with confidence score and evidence; persists user edits. | **Missing** |
| **6. Relational Record Resolution** | Queries `SELECT id FROM table LIMIT 1` or inserts static `'General'` baseline. | Does not resolve semantic category names (e.g., "Cars"), cannot auto-create missing categories with custom attributes, ignores unique collisions. | Implement `IntelligentRelationResolver`: lookup by name/slug, check `CREATE_IF_MISSING` policy, insert taxonomy record transactionally, catch unique races. | Automated test inserts post with category "Artificial Intelligence"; category created with slug "artificial-intelligence" and linked by ID. | **Critical Gap** |
| **7. Natural Language Automation Proposer** | 5-step manual wizard only. | User cannot type a natural language prompt to generate an automation plan. | Build AI Intent Parser in AI service + controller that converts natural prompt into complete pipeline config. | User inputs "Daily articles on Kubernetes at 9 AM" -> AI generates validated JSON with table, fields, mappings, and schedule. | **Missing** |
| **8. Background Scheduling & Catch-Up** | Minute-by-minute exact match (`$currentTime === $genTime`). | If worker/scheduler restarts or lags by 60 seconds, run is skipped for the day. No distributed locks. | Add catch-up tolerance window (15 mins), atomic execution locks via cache mutex, and date bounds (`start_date`, `end_date`). | Test simulates worker delayed by 3 minutes; scheduled run executes safely with single execution record. | **Partial** |
| **9. Real Cloud AI Provider Adapters** | Stub in `cloud_stubs.py` delegating to mock with fake 45ms latency. | OpenAI, Gemini, and Claude do not make real HTTP calls or validate live API credentials. | Implement genuine `OpenAIProvider`, `GeminiProvider`, and `ClaudeProvider` with real key verification and fallback error handling. | Test verifies real API key format, model enumeration, and structured prompt dispatch. | **Gap** |
| **10. Local Ollama Model Verification** | Connects to `/api/tags` and reports online if server responds. | Does not verify if the *requested* model (e.g. `llama3`) is installed and ready. | Update `OllamaProvider.test_connection()` to check model existence; report model missing vs daemon offline. | Calling test with non-existent model returns `available: false` with pull guidance. | **Gap** |
| **11. Execution Trace & Timeline Observability** | Execution status and simple error message stored in `automation_executions`. | No structured event timeline showing trigger, schema check, RAG context, relation resolution, and write. | Add `execution_events` timeline JSON column tracking discrete lifecycle events with timestamps and details. | Execution detail endpoint returns structured chronological timeline for UI display. | **Gap** |
| **12. UI/UX Cohesion & Refinement** | Functional React pages with Tailwind and Framer Motion. | Some screens lack empty state CTAs, natural language prompt inputs, relation resolution controls, and detailed audit timelines. | Upgrade UI components: add NL automation bar, relation policy selectors, 4-tier schema tabs, and execution timelines. | Browser inspection verifies responsive layout, no layout shifts, and accessible controls. | **Partial** |

---

## 2. Priority Classification

- **P0 (Critical Architecture & Execution Safety):**
  1. Intelligent Relational Record Resolution (`SafeDatabaseExecutor` & relation creation policies).
  2. 4-Tier Table Eligibility Policy Engine.
  3. Real AI Provider Adapters (OpenAI, Gemini, Anthropic, Ollama model installation validation).
  4. Scheduler catch-up window & execution locks.

- **P1 (Core Product Experience & Automation):**
  1. Natural Language Automation Proposer (Prompt to Pipeline).
  2. Versioned Schema Snapshots & Semantic AI Suggestions.
  3. Structured Execution Timeline & Explainability.
  4. Searchable Relational Combobox with Auto-Create Policy in UI.

- **P2 (Design Polish & SaaS Hardening):**
  1. Refined Design System tokens, status indicators, and empty states.
  2. Security settings and audit log export/filtering.
  3. Comprehensive regression and feature test matrix.
