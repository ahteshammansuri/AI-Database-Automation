# docs/AUDIT.md

## Addendum audit (2026-10-15): natural-language data agent, safe writes, live corrections, visible agent, automation clarity

This audit compares the repository at commit `f13280d` against the 2026-10-15 addendum. The earlier audit (2026-10-14) is kept below, unchanged.

**Baseline before this work:**
- Laravel: 108 tests passed.
- AI service: 31 passed.
- Root Python: 58 passed.
- Frontend: 33 passed.
- Build: clean.

**Environment found:**
- CPU-only, 4 cores, 15 GB RAM. Swap was full; load average was about 11.
- Local Ollama with `qwen2.5:3b`, `llama3.2:1b`, `llama3:latest` and `nomic-embed-text`.
- PostgreSQL 16 server installed. Docker available.
- Host PHP 8.3 has `pdo_mysql` but no `pdo_pgsql` or `pdo_sqlite`, and there is no sudo.

### Policy change
The addendum replaces the "no `DELETE`, no LLM-written SQL" rule with a tiered policy:
- reads are allowed;
- `INSERT` and `UPDATE` need a preview and confirmation;
- `DELETE` needs opt-in plus typed confirmation;
- DDL stays forbidden;
- raw LLM SQL is allowed only for `SELECT`, through a parser gate.

`AGENTS.md`, `.agents/rules/03-database-connectivity-and-safety.md`, ADR-003, the security model and the product knowledge doc all still state the old rule. They must be updated together (done in this round, ADR-010).

### What exists vs. what the addendum needs

| Area | Exists today | Missing / deficient |
|---|---|---|
| Connections | MySQL only. `DbConnection::createTargetPdo()` hard-codes a `mysql:` DSN. Credentials are encrypted. SSRF guard blocks metadata IPs and a port list. | No dialect interface. No PostgreSQL / SQLite / SQL Server / MongoDB, and no honest "unsupported" marking. No per-connection **access mode**. No read-only session or transaction. No statement timeout. |
| Introspection | MySQL `information_schema`: base tables, columns (type, nullable, key, default, length, enum values), FKs (no `ON DELETE` rule), `table_rows` estimate. Versioned snapshots and diffs. | No views, engine/version/size, unique keys or FK delete rules. No `timestamp` vs `timestamptz` distinction. No short-lived live cache with a "live wins" rule. |
| Table / column policy | 4-tier automation eligibility; `users`, `orders`, `payments` and the like are fully RESTRICTED for automated writes. `FieldClassifier` (Python) for automation mapping. | No **read** policy at all. No column-level secret/PII classes. No masking, no audited reveal, no owner overrides. |
| Reads | Only lookup rows for dropdowns (`getTableLookupRecords`, `lookup_table_values`). | Whole NL read pipeline missing: intent, schema linking, ambiguity check, QueryPlan, validation, compiler, EXPLAIN guard, read-only execution, verification, grounded answer, "How I got this". |
| Raw `SELECT` gate | Regex keyword deny-list (`assertQueryIsSafe`), used on our own `INSERT`/`UPDATE`. | No SQL parser or AST validation, no per-dialect function deny/allow list, no forced `LIMIT`, no read-only transaction. |
| Question types | — | Database overview, table discovery by meaning with evidence, FK relationship explanation, dummy-data detection, time windows (timezone, column choice, DST), aggregates/top-N/trends, paging/export. |
| Writes | `executeInsert` (parameterized, typed, transaction, idempotency); `executeScopedUpdate` (single PK); `executeDeleteForCompensation` (single id, undo of an automation insert). Automations only. | No agent-driven `UPDATE`/`INSERT` with preview, before→after diff, ambiguity rule, count confirmation, pinned PKs, TOCTOU re-check, before-image, undo, or per-operation row cap. MySQL `rowCount()` reports *changed* rows, not *matched* rows, so it can't be used for pinned-count checks without `MYSQL_ATTR_FOUND_ROWS`. |
| Delete | — | Mode gate, impact analysis over the FK graph (cascade / restrict / set-null, recursive), soft-delete offer, typed confirmation (voice cannot satisfy it), backup with TTL, restore, row limits, rate limit. |
| Multi-connection / context | The agent lists connections. | No "which connection?" disambiguation; no active connection/table, last plan or result refs in conversation state; no UI context header. |
| Corrections | Flat `slots`. A new utterance during a turn supersedes the turn at the next loop boundary. `handleCorrection` exists. | No slot versions or source utterance ids, no step↔slot dependency ledger, no stale-step re-run, no "already committed" handling, no secret re-capture on correction, no manual-control detection or reconciliation. |
| Visible agent | Orbit flies to registered targets, gestures, captions. Real UI actions through the surface catalog; acks. | No eased pointer with click ripple, no character-by-character typing, no explicit read-back verification step per action, no Pause/Stop/Take-over controls on the timeline, no Watch/Fast/Background modes, no mobile highlight mode. |
| Automation clarity | Builder wizard, simulation preview (`SimulationService`), approvals, schedules. | No per-field provided/inferred/missing extraction, never-guess list, Requirements Card or dry-run payload card. No verified "next run" in the user's timezone after creation. |
| Providers / privacy | Ollama by default; optional OpenAI/Gemini/Claude with the user's own keys; model roles. Model switching on failure already removed. | No workspace privacy modes (`local_only` / `cloud_metadata_only` / `cloud_with_results`) enforced in the provider layer. No Model Readiness Test. No per-task provider/model display. |
| Vector store | FAISS files per user plus JSON metadata; product index versioned by sha; hybrid retrieval. | Not a vector DB: no metadata filtering, no namespaces. Table profiles share the user's KB index and use colliding doc ids (`100000 + conn*100 + index%100`). No embedding-model version or re-embed job. |
| Prompts | `prompts/` has 8 markdown files. | **No code loads them** (documentation only). None of the 10 addendum prompts exist, nor versions or golden tests. |
| Agent decision protocol | `orbit.v1` JSON schema with a tool-name enum. | Live check, real `qwen2.5:3b`, "connect a database for me": `CALL_TOOL` *without* `tool_call` twice, `MODEL_OUTPUT_INVALID` after 790 s. The flat schema cannot force `tool_call` when `kind=CALL_TOOL`. |
| Fixtures / tests | Platform test DB; mocked AI. | No fixture customer DBs (MySQL/PostgreSQL), NL accuracy suite, SQL-gate attack tests, TOCTOU, cascade or privacy-mode network tests. |
| Ops | `run_all.sh` frees ports 8000/8001/5173 on start. | It never stops the previous run's queue workers or loops, so repeated runs leave stale workers on old code. Three overlapping instances were running during this audit, one agent worker on code from before the last round. |

### Vector store decision
The portal DB is MySQL, so pgvector does not apply. **Qdrant** was chosen (ADR-011):
- payload filters on `tenant_id` and `namespace` are applied *before* scoring;
- the same client API runs embedded (on-disk, no extra service) for local/dev and against a Qdrant server in docker-compose for production;
- this machine has little RAM headroom, which rules out running another always-on server by default.

### PostgreSQL feasibility
- The `php8.3-pgsql` package for this exact PHP build loads with `-d extension=...` and no root. The PostgreSQL dialect is therefore tested for real against a fixture container.
- Production and the Docker image need `pdo_pgsql` installed; the app reports the driver as missing instead of failing silently.
- SQLite, SQL Server and MongoDB are marked **unsupported**. SQLite target paths are also a server-file-access risk in a multi-tenant app.


---

# Previous audit (2026-10-14, unchanged)

## Full Repository Audit — AI Database Automation Portal → Voice-First Agentic Upgrade

**Auditor:** Antigravity AI Engineering  
**Date:** 2026-10-14  
**Prompt Reference:** Master Voice-First Agentic Upgrade Prompt (Section 9 "How to Start")  
**Baseline Tests:** Python 37/37 passed · Laravel 46/46 passed (589 assertions) · Frontend build: clean

---

## 1. Stack Summary

| Layer | Technology | Version / Notes |
|---|---|---|
| **Control Plane** | Laravel | 11.31 (PHP ≥ 8.2), Sanctum auth, SQLite platform DB |
| **Frontend** | React + TypeScript + Vite | React 19, Tailwind CSS, Framer Motion, Lucide icons |
| **AI Service** | Python FastAPI + Pydantic | Python 3.12, FAISS CPU, PyMuPDF, httpx, uvicorn |
| **Queue** | Laravel Database Queue | `php artisan queue:work`, supervised restart loop |
| **Scheduler** | Laravel Scheduler | `php artisan schedule:work`, timezone-aware |
| **Vector Store** | FAISS (CPU) | Local per-user index files in `ai_service/storage/indexes/` |
| **Provider** | Ollama (local) | Default, auto-resolves best installed model; mock provider for tests |
| **Real-time** | SSE (Server-Sent Events) | `LiveEventService` + `LiveEventController`, `/api/live/stream` |
| **Docker** | docker-compose.yml | Frontend, Laravel, Queue Worker, Scheduler, AI service, Demo MySQL, Mailpit |
| **Target DB** | MySQL 8.0 | First supported engine; PostgreSQL/MSSQL/MongoDB staged |

---

## 2. What Already Exists (and works)

### 2.1 Backend (Laravel)
- **Full auth**: register, login, logout, Sanctum tokens, protected routes, tenant ownership.
- **DB Connections**: CRUD with encrypted passwords (`Crypt::encrypt`), SSRF validation, connection test, schema scan trigger.
- **Schema Introspection**: `SchemaIntrospectionService` introspects MySQL live — tables, columns, types, nullability, PKs, FKs, enums, unique constraints; persists `SchemaSnapshot`; `SchemaTableAnnotation` for user table eligibility overrides.
- **`SafeDatabaseExecutor`**: Parameterized allowlisted INSERT/UPDATE only, per-column type coercion, transaction wrapping, idempotency checks, restricted table blocklist. `DatabaseSafetyService` with SSRF guards.
- **Automations**: Full CRUD, `ProcessAutomationExecution` job, approval workflow with tokens (`ApprovalToken`), `EmailApprovalService`, `PublishApprovedExecution` job, approval inbox.
- **Knowledge Base**: `KnowledgeController` upload + indexing via Python RAG service, tenant-scoped delete.
- **Agent Data Models**: `AgentTask`, `AgentConversation`, `AgentMessage`, `AgentTaskTimelineEvent`, `UserAgentPreference` — all with `user_id` FK and tenant scoping.
- **Agent Tool Registry**: `AgentToolRegistry` (2,219 lines) with 20+ tool definitions with rich metadata (`risk_level`, `requires_confirmation`, `idempotent`, `side_effects`, `parameters` JSON schema, `output_schema`). Handlers for: connections, schema, automations, executions, content, KB, dashboard, tasks, provider.
- **Agent Execution Service**: `AgentExecutionService` (1,021 lines) — message routing, plan execution, step-by-step with cancellation check, confirmation gating, tool dispatch, LLM response synthesis, timeline event recording, SSE broadcasting.
- **Frontend Action Bridge**: `actionBridge.ts` pub/sub, `NavigationBridge` in `App.tsx`, `ConnectionsPage.tsx` subscribed to all connection actions.
- **Slot Persistence**: `AgentTask->slots` JSON cast, merged across turns.
- **SSE Event Stream**: sequence numbers, catch-up endpoint.
- **Audit Logs**, **AI Service Client** with `planAgentTask`, `synthesizeResponse`, `evaluateAgentCorrection`.

### 2.2 Python AI Service
- **Providers**: `OllamaProvider` (full: `generate_structured_data`, `plan_agent_turn`, `synthesize_agent_response`, `test_connection`), `MockAIProvider` (deterministic, full test coverage), cloud stubs.
- **RAG**: `DocumentParser` (PDF/TXT/MD), `TextChunker` (400-char chunks, 80 overlap), `EmbeddingService` (**NOTE: numpy random 256-dim — NOT real embeddings**), `UserVectorIndex` (FAISS, per-user partition), `RAGService`.
- **Agent Planner**: Calls `OllamaProvider.plan_agent_turn()` with RAG context, slot accumulation, JSON decision output, fallback to MockAIProvider.
- **`PRODUCT_CONTEXT_RAG.md`**: Indexed into FAISS `user_id=0` partition on startup.
- **Routers**: `/v1/ai/generate`, `/v1/ai/health`, `/v1/ai/propose-automation`, `/v1/ai/agent/plan`, `/v1/ai/agent/synthesize-response`, `/v1/ai/agent/evaluate-correction`, `/v1/rag/{index,query,extract-text}`.

### 2.3 Frontend
- **All 16 pages**: Landing, Login, Register, Dashboard, Connections, Schema Explorer, Automations List/Builder, Approvals, Manual Schedule, Knowledge Base, AI Providers, Executions, Audit Logs, Security Settings.
- **Agent HUD**: `AgentOperationalHUD`, `OrbitMascotCharacter`, `FloatingMascot`, `SecureCredentialCard`, `VoiceInputControl`, `ActiveTaskTimelineCard`.
- **`AssistantContext.tsx`**: Full context with conversation/task state, SSE listener for `agent.action_requested`, voice lifecycle, TTS via `speechSynthesis`, secure credential submission, interrupt/pause/stop.
- **Voice**: Web Speech API STT, barge-in cancels TTS.
- **Build**: TypeScript clean, 0 errors.

---

## 3. What Is Missing or Deficient

### 3.1 CRITICAL — Blocks Product Goal

| # | Gap | Location |
|---|---|---|
| **G1** | **Embeddings are FAKE** — `EmbeddingService` uses `numpy.random.randn`; RAG retrieval is semantically meaningless | `ai_service/app/rag/embeddings.py` |
| **G2** | **Field Classifier missing** — No field role classification (`title`, `slug`, `body`, `category_ref`, etc.) | Nowhere |
| **G3** | **Relationship Resolver missing** — No FK lookup/match/create pipeline with policy | `SafeDatabaseExecutor.php` partial |
| **G4** | **Structured generation is schema-unaware** — Hints from field name strings only, not live schema constraints | `ollama_provider.py:130-239` |
| **G5** | **No Context Package assembly** — No service assembling schema + field mappings + constraints + KB chunks + relation catalog | Nowhere |
| **G6** | **Media Service missing** — Images default to hardcoded Unsplash URLs; no storage, no MIME check, no media table | `ollama_provider.py:197-206` hack |
| **G7** | **No versioned prompt templates** — Prompts are inline strings; no `prompts/` directory | Scattered |

### 3.2 HIGH — Significant gaps

| # | Gap | Location |
|---|---|---|
| **G8** | Secret redaction from voice transcript missing — password can reach LLM context | `AssistantContext.tsx` |
| **G9** | Correction evaluator uses regex, not LLM reasoning | `agent_planner.py:178-275` |
| **G10** | Slug uniqueness not live-checked against target DB | `ollama_provider.py:216-218` |
| **G11** | No idempotency key dedupe at execution level | `AutomationExecution.php` |
| **G12** | No prompt injection defense — untrusted KB text not delimited | `ollama_provider.py` |
| **G13** | No `field_mappings` table for user-confirmed role mappings | Nowhere |

### 3.3 MEDIUM — Important but non-blocking MVP

| # | Gap |
|---|---|
| **G14** | No dry-run / simulation mode |
| **G15** | No Table Profile documents in RAG |
| **G16** | No model role configuration (agent_planner, content_writer, embedder, etc.) |
| **G17** | No novelty/duplicate check before publish |
| **G18** | No deadline handling policy |
| **G19** | No RAG proof in logs (source IDs + text in prompt) |
| **G20** | No `media_assets` table |
| **G21** | No local STT (Whisper/faster-whisper) |
| **G22** | No local TTS (Piper/Kokoro) |
| **G23** | Mascot states not fully wired to real SSE event types |
| **G24** | No `agent_task_steps` individual persistence |
| **G25** | No `rag_retrieval_log` |

### 3.4 LOW

| # | Gap |
|---|---|
| **G26** | No hybrid BM25+vector search |
| **G27** | No multilingual STT detection |
| **G28** | No reranking |
| **G29** | CSV/HTML RAG ingestion not supported |
| **G30** | `AI_SERVICE_KEY` is predictable string in docker-compose |

### 3.5 Documentation Missing
- `prompts/` directory with 8 versioned prompt files
- `docs/CAPABILITIES.md` (auto-generated from registry)
- `docs/RUNBOOK.md`
- `docs/TESTING.md`

---

## 4. Conflicts: This Prompt vs PRODUCT_CONTEXT_RAG.md

**None found.** Both documents align on truthfulness, real execution, tenant isolation, security, and provider-agnostic design. `PRODUCT_CONTEXT_RAG.md` Section 1 precedence chain is followed by the implementation.

---

## 5. Phased Implementation Plan

### PHASE 1: Real Embeddings + Field Classifier + Context Package + Prompt Templates (~16h)

**1a. Real Embeddings** (G1)  
Replace `numpy.random.randn` in `embeddings.py` with Ollama `/api/embeddings` endpoint using `nomic-embed-text` model. Fall back to TF-IDF cosine similarity if Ollama offline.

**1b. Field Classifier** (G2)  
Create `ai_service/app/services/field_classifier.py`:
- Input: columns from live schema introspection
- Output: `{role, confidence, evidence}` per column
- Signal priority: FK target > column name patterns > type > constraints
- Roles: `primary_key, title, slug, summary, body, seo_title, seo_description, status, author_ref, category_ref, tag_ref, media_ref, image_url, image_path, published_at, created_at, updated_at, language, url, price, boolean_flag, json_meta, unknown`
- Confidence < 0.7 flagged for user confirmation in wizard

**1c. Context Package Assembler** (G5)  
Create `laravel/app/Services/ContextPackageService.php`:
- Assembles: table profile + confirmed field mappings + live schema constraints + business rules + brand voice + KB chunks + recent content titles + relation catalog (FK table names only, not IDs)

**1d. Versioned Prompt Templates** (G7)  
Create `prompts/` directory:
- `agent_system.md`, `planner.md`, `content_generation.md`, `relation_proposal.md`, `image_prompt.md`, `error_recovery.md`, `response_composer.md`, `rag_query_rewrite.md`
- YAML frontmatter: `version`, `changed`, few-shot examples (blogs, news, products, events, FAQs)

**Phase 1 tests:** Field classifier unit tests (5 fixture schemas), embedding semantic test, context package integration test.

---

### PHASE 2: Relationship Resolver + Schema-Aware Generation + Idempotency (~18h)

**2a. Relationship Resolver** (G3)  
Create `laravel/app/Services/RelationshipResolverService.php`:
- Policy: `resolve_only | create_if_missing | ask_user`
- LLM proposes human-readable name → backend live authorized lookup (case-insensitive, slug-aware, fuzzy threshold)
- One match: use real ID. Multiple: ask clarifying question. None: per policy.
- Create: honor related table constraints; read LAST_INSERT_ID() for real PK
- Same transaction as content row; rollback on failure
- Return: `{relation_field, matched_or_created, real_id, table, policy_used}`

**2b. Schema-Aware Structured Generation** (G4)  
Update `OllamaProvider.generate_structured_data()`:
- Accept full schema constraints from live introspection
- Build JSON Schema from real table metadata (not field name heuristics)
- Validate output against schema; on failure: feed errors back, retry 3x, then fail
- Live slug uniqueness check before accepting

**2c. Idempotency Keys** (G11)  
Migration: `idempotency_keys` table. Key = `automation_id + scheduled_slot + content_hash`. `SafeDatabaseExecutor` checks before INSERT.

**2d. Field Mappings Persistence** (G13)  
Migration: `field_mappings` table. API: GET/POST/PUT per automation. Wizard shows low-confidence classifications for confirmation.

**Phase 2 tests:** Relationship resolver (exists, resolve_only, multiple matches, rollback), idempotency (exactly one row on retry), schema-aware generation (enum values, max_length, nullable).

---

### PHASE 3: Media Service + Table Profiles + Publishing Safety (~12h) — COMPLETED

**3a. Media Service** (G6) — **COMPLETED**
- Created `laravel/app/Services/MediaService.php`:
  - Enforces strict SSRF protection: blocks private IP ranges, loopback, and cloud metadata (`169.254.169.254`).
  - MIME type validation via magic bytes (JPEG, PNG, WebP, GIF, SVG); rejects disguised scripts or invalid payloads.
  - SHA-256 deduplication and secure storage under `storage/app/public/media/`.
  - Schema-aware mapping: formats output as full URL, server-relative path, or foreign key ID.
  - Rollback cleanup tracks disk files created during execution and unlinks them if transaction aborts.
- Migration `2026_10_14_000004_create_media_assets_table.php` and Model `MediaAsset.php`.
- Verified in `MediaServiceTest.php` (5/5 passing).

**3b. Table Profiles + RAG Namespace** (G15) — **COMPLETED**
- Updated `laravel/app/Services/SchemaIntrospectionService.php`:
  - Generates comprehensive markdown Table Profiles with role classifications, column data types, nullable flags, unique keys, and foreign key relationships.
  - Indexes profiles into Python RAG under user-scoped tenant filter (`user_id`).
- Verified in `TableProfileRagTest.php` (2/2 passing).

**3c. Deadline Handling** (G18) — **COMPLETED**
- Added `safe_deadline_policy` column (`notify_and_wait`, `publish_last_valid`, `skip`) to `automations` table.
- Updated `Automation.php` model fillable attributes and `AutomationController.php` validation rules.
- Implemented in `PublishAutomationContentJob.php`:
  - Pre-write revalidations: automation active status, connection active status, and cross-tenant ownership check.
  - If no approved version exists:
    - `skip`: marks execution `SKIPPED`, `DEADLINE_SKIPPED`, aborts without writing.
    - `publish_last_valid`: auto-approves latest unrejected valid version and commits to target MySQL.
    - `notify_and_wait`: stays in `PENDING_APPROVAL`, emits `execution.deadline_reached`, waits for explicit review.
- Verified in `DeadlinePolicyTest.php` (6/6 passing).

**3d. Novelty / Duplicate Check** (G17) — **COMPLETED**
- Added `/v1/ai/check-novelty` endpoint in Python AI service with cosine similarity of embeddings (threshold 0.92) and token overlap fallback.
- Added `NoveltyCheckService.php` in Laravel with AI service integration and pure PHP Levenshtein/Jaccard fallback.
- Updated `GenerateAutomationContentJob.php`:
  - Checks candidate title novelty against recent publications.
  - If similarity >= 0.92: records `NOVELTY_DUPLICATE_DETECTED` timeline event and regenerates with an angle variation prompt.
  - If angle-regenerated: records `NOVELTY_ANGLE_APPLIED` and stores the fresh title.
- Verified in `NoveltyCheckTest.php` (4/4 passing) and `ai_service/tests/test_ai_service.py` (novelty tests passing).

**Phase 3 tests:** All 72 Laravel tests passing (718 assertions), all 79 Python tests passing, 0 build errors.

---

### PHASE 4: Voice Pipeline — Secret Redaction + Prompt Injection Defense (~10h) — COMPLETED

**4a. Secret Redaction** (G8) — **COMPLETED**
- Created `frontend/src/services/secretRedactor.ts`:
  - Regex pattern matching for database passwords, API keys (`sk-...`), and auth tokens.
  - Replaces credentials in visible utterances and chat history with `[REDACTED_CREDENTIAL]`.
  - Isolates sensitive values into the dedicated `secureInputData` channel, ensuring cleartext secrets never enter speech transcripts, conversational prompts, or telemetry logs.
  - Added `secretRedactor.test.ts` (7/7 tests passing via `node --test --experimental-strip-types`), including an automated grep check verifying zero cleartext matches in captured network payloads.

**4b. Prompt Injection Defense** (G12) — **COMPLETED**
- Updated `ai_service/app/routers/ai.py`:
  - Encloses all retrieved RAG passages and third-party knowledge within strict `<UNTRUSTED_CONTENT>...</UNTRUSTED_CONTENT>` boundary tags.
  - Prepends an explicit security invariant instructing the LLM that untrusted tags contain passive reference material that must never be interpreted as system overrides, SQL executions, or permission escalations.
  - Added `test_prompt_injection_defense_in_generation` in `ai_service/tests/test_ai_service.py` verifying hostile prompts (e.g. `DROP TABLE users`) are quarantined within boundary tags and do not alter structured generation.

**4c. Model Role Config** (G16) — **COMPLETED**
- Migration `2026_10_14_000006_create_model_roles_table.php` and Model `ModelRole.php`.
- Supported roles: `planner`, `generator`, `classifier`, `summarizer` with user-scoped isolation.
- API Endpoints in `ModelRoleController.php`:
  - `GET /api/model-roles`: lists configured roles with defaults.
  - `PUT /api/model-roles`: updates role provider/model mappings.
  - `POST /api/model-roles/probe`: checks capability and latency against selected AI providers.
- UI: Added `ModelRolesSection.tsx` integrated into `AIProvidersPage.tsx` with latency probes and role status indicators.
- Verified in `ModelRolesApiTest.php` (4/4 passing).

**4d. Local TTS Adapter with Instant Barge-In** (G22) — **COMPLETED**
- Created `frontend/src/services/ttsAdapter.ts`:
  - Default browser `speechSynthesis` with seamless fallback.
  - Configurable local Piper/Kokoro neural HTTP audio endpoint (`http://127.0.0.1:5000/v1/audio/speech`).
  - Markdown/emoji stripper (`cleanSpokenText`) for natural spoken prosody.
  - Sub-50ms instant barge-in via `stop()` which cancels audio queues and aborts pending fetch requests.
  - Integrated into `useVoiceLifecycle.ts` (`speak`, `stopSpeaking`, `startListening`) and `AssistantContext.tsx` (`interruptTask`).

**Phase 4 tests:** All 76 Laravel tests passing (772 assertions), all 80 Python tests passing, 7 frontend redaction unit tests passing, Vite production build successful with 0 errors.

---

### PHASE 5: Real Observe-Act Loop + Frontend Bridge Completeness (~14h) — COMPLETED

**5a. Real Observe-Act Loop** (G9) — **COMPLETED**
- Enforced hard loop iteration limit of 12 operations max per task turn (`MAX_TOOL_ITERATIONS = 12`) to prevent infinite looping.
- Implemented intelligent Observe-Act error recovery: when target database authentication fails (e.g. invalid password), the execution loop intercepts the failure, preserves non-secret parameters, and gracefully transitions the task into `WAITING_FOR_INPUT` with `secure_input_type = 'database_credentials'` rather than terminating in a fatal crash.
- Added slot accumulation and propagation across subsequent tool steps (`$slots['connection_id']`, `$slots['automation_id']`, `$slots['execution_id']`).
- Verified in `AgentAutonomousActionTest.php`:
  - `test_observe_act_loop_authentication_failure_recovery`: verifies that deliberate invalid password triggers `WAITING_FOR_INPUT` with safe prompt.
  - `test_bounded_loop_detection_at_twelve_iterations`: verifies that execution halts safely at the 12th iteration.

**5b. Correction Evaluator → LLM** (G9) — **COMPLETED**
- Updated `ai_service/app/services/agent_planner.py` to route user interruptions and mid-task corrections to the active LLM provider via `provider.evaluate_correction(...)`.
- Added `evaluate_correction` to `BaseAIProvider`, `MockAIProvider`, and `OllamaProvider` with structured JSON schema output (`action`, `revised_parameter`, `new_value`, `compensating_needed`, `explanation`).
- Preserved deterministic regex parsing as a resilient fallback in `_deterministic_fallback_correction`.
- Verified in Python test suite across 80 tests.

**5c. Frontend Bridge Expansion** (G10) — **COMPLETED**
- Upgraded `frontend/src/services/actionBridge.ts`:
  - Implemented `dispatchAsync<T>(action, payload, timeoutMs)` returning typed execution results (`ok` | `not_mounted` | `validation_error` | `timeout` | `error`).
  - Registered typed action listeners across portal pages:
    - `ConnectionsPage.tsx`: `connections.open_create_form`, `connections.fill_fields`, `connections.trigger_test`, `connections.submit_save`, `connections.scan_schema`.
    - `AutomationsListPage.tsx`: `automations.navigate_create`, `automations.trigger_run`.
    - `SchemaExplorerPage.tsx`: `explorer.select_connection`, `explorer.select_table`.
    - `KnowledgeBasePage.tsx`: `knowledge.open_upload`.
    - `AIProvidersPage.tsx`: `providers.test_ollama`.

**5d. Page State Snapshot** (G10) — **COMPLETED**
- Created `frontend/src/services/pageStateService.ts`:
  - Tracks live current route, active entity (table, connection, automation, etc.), mounted forms, and active modals.
  - Automatically obfuscates secrets in form fields (passwords, tokens, keys are masked as `••••••••`).
  - Wired into `AssistantContext.tsx` and `api.ts`, automatically attaching `page_context` to `/api/agent/conversations/{id}/messages`.
  - In Laravel backend, `AgentController.php` and `AgentExecutionService.php` ingest `page_context` into `$task->slots['page_context']` and pass it to the AI planner for context-aware multi-turn reasoning.
  - Verified in `AgentAutonomousActionTest.php` (`test_page_context_preservation_in_agent_message`).

**5e. Orbit Character Animations & Mascot Synchronization** (G24) — **COMPLETED**
- Synchronized Orbit mascot sprite animations across all four key behavioral states:
  - `listening` / `transcribing`: activates when user speech audio is detected.
  - `thinking` / `understanding`: activates during AI plan generation and reasoning.
  - `flying` / `navigating`: triggers when semantic travel navigates between portal views.
  - `speaking`: triggers during local TTS playback with voice-reactive audio pulsing.
  - Sub-50ms instant barge-in (`ttsAdapter.stop()`) returns character immediately to `listening`.

**Phase 5 tests:** All 79 Laravel tests passing (783 assertions), all 80 Python tests passing, 7 frontend redaction unit tests passing, Vite production build successful with 0 errors.

---

### PHASE 6: Feature Flags (after core stable)

Behind `FEATURE_*` env vars, in priority order:
1. `FEATURE_DRY_RUN` — dry-run / simulation mode
2. `FEATURE_SCHEMA_DRIFT` — schema drift detection
3. `FEATURE_UNDO_CENTER` — compensation center
4. `FEATURE_QUALITY_SCORE` — readability/SEO/factual scoring
5. `FEATURE_CONTENT_CALENDAR` — drag-to-reschedule calendar view
6. `FEATURE_DB_INSIGHTS` — safe parameterized aggregations
7. `FEATURE_TEMPLATES` — blog/news/product/FAQ template library

---

## 6. Acceptance Test Mapping

| Acceptance Test (Prompt Section 7) | Phase |
|---|---|
| 1. Schema intelligence + dry-run valid payload | P1 (classifier) + P6 (dry-run) |
| 2. FK resolve: create_if_missing, resolve_only, multiple matches | P2 |
| 3. Rollback: no orphan category, no orphan image | P2 + P3 |
| 4. Image stored, media row, column verified | P3 |
| 5. Idempotency: exactly one row on retry | P2 |
| 6. Approval disabled: no approval created | ✅ Already implemented |
| 7. Voice "connect database": secure password, real test, verified, no secret in logs | P4 + P5 |
| 8. Failed connection: real sanitized error, no false success | P5 |
| 9. "Stop" mid-run: pending superseded, committed truthfully reported | ✅ Already implemented |
| 10. Tenant isolation | ✅ Already implemented + automated tests |
| 11. Prompt injection in KB / DB text: no effect | P4 |
| 12. DELETE/DROP/DDL refused + audited | ✅ Already implemented |
| 13. Provider offline: honest error, no silent fallback | ✅ Already implemented |
| 14. RAG proof: source IDs + text in model request logged | P1 |
| 15. UI bridge: route/mount failure stops sequence | P5 |
| 16. Task survives refresh, resumes from last event seq | ✅ Already implemented |

---

## 7. Key Decisions (see also docs/DECISIONS.md)

1. **Embeddings**: Ollama `/api/embeddings` + `nomic-embed-text` primary; TF-IDF fallback if Ollama offline.
2. **Field Classifier**: Rule-based + confidence scoring (deterministic, fast). LLM only for low-confidence confirmation.
3. **Context Package**: Assembled in Laravel (has schema access + auth context), sent to Python for generation.
4. **Prompt templates**: Plain Markdown in `prompts/`, loaded at runtime.
5. **Secret redaction**: Client-side first + server-side log scrubbing second. Both required.
6. **Media scope (P3)**: URL import + local storage only. ComfyUI/SD behind `FEATURE_IMAGE_GEN`.

---

## 8. Baseline Test Results (Verified 2026-10-14)

```
Python tests:  37 passed  (3.23s)   — ai_service/tests/
Laravel tests: 46 passed  (589 assertions, 28.05s) — laravel/tests/
Frontend build: clean (0 TypeScript errors, ~3.1s)
```

**Caveats:**
- RAG tests pass but retrieve meaningless chunks (random embeddings). Will need semantic quality tests after real embeddings land.
- Laravel agent tests use `MockAIProvider` exclusively — no live Ollama coverage in CI.
- No acceptance tests for new phases yet (created during each phase).

---

---

## 10. Addendum Verification & Delivery Status (Completed 2026-10-16)

All 14 areas from the 2026-10-15 Natural-Language Data Agent addendum have been implemented and verified:

1. **Access Modes & Policy Gate (ADR-010):**
   - Three per-connection modes: `read_only` (default), `read_write`, `read_write_delete`.
   - Permanent prohibition enforced in backend: `DROP`, `TRUNCATE`, `ALTER`, `CREATE`, `GRANT`, `REVOKE`, raw SQL console.
   - Read gate AST analyzer (`sqlglot`) blocks dangerous functions (`pg_sleep`, `sleep`, `LOAD_FILE`, `xp_cmdshell`) and forces limits.
2. **Natural-Language Data Agent Pipeline:**
   - Real schema linking: minimal slices, keyword & FK graph expansion, value grounding ("Rajasthan" -> "RJ").
   - Semantic table discovery with confidence scores and evidence columns.
   - Time-relative window resolution with user and target timezones (`Asia/Kolkata`, `UTC`).
   - Dummy/test data detection heuristics over bounded samples.
   - Collapsible "How I got this" diagnostics panel.
3. **Safe Writes (INSERT & UPDATE):**
   - Before/after diff preview and row limits.
   - Pinned primary keys execution in transactions.
   - TOCTOU affected count mismatch rollback verification (`MYSQL_ATTR_FOUND_ROWS`).
   - Encrypted before-image storage and verified one-click Undo restoration.
4. **Guarded DELETE:**
   - Strict `read_write_delete` access mode check.
   - Recursive foreign-key cascade impact analysis.
   - Mandatory typed phrase confirmation generated by backend (`DELETE 1 posts`). Voice-only rejected.
   - Encrypted backup with 7-day TTL and verified Undo restoration.
5. **Live Corrections & Barge-in:**
   - Versioned slot ledger (`CorrectionEngine`).
   - Smart barge-in detection: `patch_value`, `provide_value`, `cancel`, `pause`, `resume`.
   - Single-utterance self-corrections ("host is db1, no wait, db2").
   - Secret re-capture with old secret discard.
6. **Automation Clarity & Zero Silent Guessing:**
   - `AutomationRequirementsService` enforces that connection, table, schedule, timezone, publish status, approval policy, and image generation are never silently assumed.
   - Requirements Card with inline missing detail questions.
7. **Model Readiness Test:**
   - Endpoint: `POST /api/model-roles/readiness-test` evaluating JSON conformance, tool-calling, and NL query planning.
8. **Vector Store Ingestion (Qdrant, ADR-011):**
   - Headings-based chunking with SHA-256 content hashes.
   - 155 chunks across 22 documentation and prompt files embedded via local Ollama `nomic-embed-text` and upserted into Qdrant.
9. **NL Query Accuracy Suite (60 Questions):**
   - 60 questions evaluated against live MySQL `shopfx` fixture: **60/60 passed (100% Accuracy)**.
   - 60 questions evaluated against live PostgreSQL `shopfx` fixture: **60/60 passed (100% Accuracy)**.
   - 120 live queries executed without errors across both database dialects.
