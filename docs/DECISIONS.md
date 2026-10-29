# Architecture Decision Records (ADRs)

## ADR-001: Architectural Split — Laravel Control Plane + Python AI Service
- **Status:** Accepted
- **Context:** The system must balance robust multi-tenant web application capabilities (auth, authorization, encrypted credential storage, background jobs, scheduling, email approvals, safe database writes, audit logging) with modern AI capabilities (Ollama local inference, RAG embeddings, vector search, chunking).
- **Decision:** Split the architecture into two dedicated services:
  1. **Laravel 11 (PHP 8.3):** Product backend & control plane. Owns user registration/auth, tenant isolation, database connection profiles, credential encryption, MySQL schema discovery orchestration, safe database execution layer (parameterized `INSERT`/`UPDATE` only), durable queues/scheduler, email approvals, and audit trails.
  2. **Python 3.12 (FastAPI):** Dedicated AI service (`ai_service/`). Owns provider adapters (Ollama, Mock, optional OpenAI/Gemini/Claude), prompt assembly, document parsing (Markdown, TXT, PDF via PyMuPDF), local embeddings, FAISS vector indexing, and structured JSON output.
  3. **React 19 + TypeScript + Vite:** Public landing page and authenticated portal.
- **Consequence:** Clean separation of concerns. The AI service has zero direct access to customer databases and does not handle user authentication or secrets. Laravel controls all database writes and tenant authorization.

---

## ADR-002: Platform Database Storage
- **Status:** Accepted
- **Context:** The platform requires relational storage for users, connection profiles, encrypted secrets, automations, execution history, content versions, approval tokens, and audit logs.
- **Decision:** Use MySQL 8.0 on port 3308 (`platform_automation` database) for the Laravel platform database, fully separated from any customer target databases. Target customer databases are connected dynamically using encrypted per-user profiles.
- **Consequence:** Full relational integrity, transactions, and robust queue support via Laravel's native database queue driver.

---

## ADR-003: Dynamic Customer Target Database Connector & Execution Safety
- **Status:** Superseded in part by ADR-010 (data operations policy, 2026-10-15). The connection, encryption and parameterization rules still apply.
- **Context:** Users connect their own MySQL databases to automate content generation. Absolute non-negotiable rule: no customer-target `DELETE`, `DROP`, `TRUNCATE`, `ALTER`, `CREATE TABLE`, `RENAME`, `GRANT`, `REVOKE`, arbitrary SQL, or LLM-generated SQL.
- **Decision:**
  1. Store connection credentials encrypted at rest using Laravel's managed encryption (`Crypt::encryptString`).
  2. Perform scoped connection management with cleanup in `finally` blocks (never mutating global Laravel connection config).
  3. Introspect schema using read-only `information_schema` and `SHOW` commands.
  4. Perform target writes exclusively through allowlisted parameterized `INSERT` and scoped `UPDATE` queries.
  5. Automatically restrict sensitive tables (authentication, passwords, tokens, permissions, payments, orders, wallets, financial data, audit logs) by default.
- **Consequence:** Eliminates SQL injection and unauthorized destructive actions.

---

## ADR-004: AI Provider Hierarchy & Offline Local Demo Reliability
- **Status:** Accepted
- **Context:** The prompt mandates Ollama as the primary local LLM with no paid API requirement. When local Ollama is offline or uninstalled, the platform must remain 100% demonstrable and testable without crashing or quietly using paid APIs.
- **Decision:** Implement a pluggable provider interface in the Python AI service:
  1. `OllamaProvider`: Default primary provider querying local Ollama (`http://localhost:11434`).
  2. `MockAIProvider`: High-fidelity local synthetic generator for automated tests and offline demos.
  3. Cloud provider adapters (OpenAI, Gemini, Anthropic) requiring explicit user credentials and opt-in.
- **Consequence:** Zero paid API cost; complete offline testability; seamless local Ollama experience when available.

---

## ADR-005: Vector Search & Embeddings Layer
- **Status:** Accepted
- **Context:** We need a local RAG pipeline to ingest Markdown, text, and PDF files.
- **Decision:** Extract PDF content using `PyMuPDF` (`fitz`), clean and chunk text, generate local embeddings, and index with `faiss-cpu`. All vector stores are tenant-scoped by `user_id`.
- **Consequence:** Fast indexing, low RAM footprint, and semantic retrieval accuracy without external vector database dependencies.

---

## ADR-006: Email Approval Token Security & Crawler Neutralization
- **Status:** Accepted
- **Context:** Automated email scanners (e.g. Defender, Google Workspace) follow links in emails. If an email link approves content on HTTP `GET`, automated crawlers will prematurely publish drafts.
- **Decision:** Email links route to a frontend confirmation page (`/approvals/:token`). The confirmation screen displays the rendered content preview and requires an interactive user button click that submits an HTTP `POST` mutation with a signed single-use token.
- **Consequence:** Prevents crawler approvals while providing a rich preview and rejection feedback workflow.

---

## ADR-007: Autonomous AI Agent Architecture & Tool Registry
- **Status:** Accepted
- **Context:** The platform requires an action-capable, animated AI assistant that performs authorized operations on the user's behalf (not a guided tour or simple chat bubble).
- **Decision:**
  1. **Control Plane Tool Execution:** All mutating and querying actions execute through a centralized, server-side `AgentToolRegistry` in Laravel. The LLM produces structured tool calls, never direct database writes or SQL.
  2. **Zero Destructive SQL:** Destructive tools (`DELETE`, `DROP`, `TRUNCATE`, DDL, raw SQL) are strictly excluded from the registry.
  3. **Strict Parameter Validation & Tenant Scoping:** Every tool call validates incoming parameters against strict schemas and checks ownership against the authenticated session user (`auth()->id()`).
  4. **Masked Secret Collection:** Passwords and API keys are never collected in conversation text or LLM prompts. The agent issues a structured request that renders a secure masked input component in the UI.
  5. **Hybrid Planning:** The Python AI service provides intent planning (`/v1/ai/agent/plan`) with local LLM capabilities, backed by deterministic rule-based planning in Laravel for reliable offline/demo operation.
- **Consequence:** Secure, predictable, auditable agent operations with zero risk of unauthorized SQL execution or credential leakage.

---

## ADR-008: Real-Time State Machine, Observable Autonomy & Instant Interruption
- **Status:** Accepted
- **Context:** The assistant must show honest, live progress across 14 distinct states and allow instant interruption or correction via typed or spoken commands during long-running tasks.
- **Decision:**
  1. **Real-time Live Events:** All agent timeline events and task status updates are persisted in `agent_task_timeline_events` and published via `LiveEventService`, immediately streamed to the UI via Server-Sent Events (SSE).
  2. **Cooperative Cancellation & Safe Checkpoints:** Mutating tasks check cancellation tokens (`INTERRUPT_REQUESTED`) at atomic boundaries. If interrupted before commit, remaining steps are cancelled and the plan is revised. If already committed, the state is honestly reported and a compensating update is offered.
  3. **Visual Active Lock:** When the agent executes a write task on a resource, a global indicator notifies the user and temporarily locks conflicting form fields to avoid data races, while keeping Stop, Pause, and Correction controls always accessible.
  4. **Distinctive Character Motion:** An original CSS/SVG "Orbital Core" character animates smoothly across 14 explicit states (`IDLE`, `LISTENING`, `THINKING`, `PLANNING`, `WORKING`, `INTERRUPTING`, etc.), respecting `prefers-reduced-motion`.
- **Consequence:** Transparent, responsive autonomy that users can trust and control at any millisecond.

---

## ADR-009: Open-Ended Semantic Intent Resolution, Dynamic Capability Discovery & Authoritative Verification
- **Status:** Accepted
- **Context:** The previous agent implementation had risk of brittle keyword matching or hardcoded example topics (e.g. "Electric cars", "Cars"). The upgraded platform requires open-ended natural-language understanding across all portal capabilities without phrase templates, while maintaining absolute security guardrails.
- **Decision:**
  1. **Dynamic Capability Discovery Registry:** Defined a 33-tool capability registry covering all actual portal features with full schemas, risk classifications, side effects, confirmation requirements, and live availability computed from current tenant resources.
  2. **6 Formal Outcome Classifications:** Every request resolves to one of six explicit semantic outcomes: `SUPPORTED_AND_SPECIFIED`, `MISSING_INFORMATION`, `AMBIGUOUS`, `CURRENTLY_UNAVAILABLE`, `UNSUPPORTED`, or `DISALLOWED_BY_POLICY`.
  3. **Zero Hardcoded Entity/Topic Routing:** Entity, category, schedule, and topic values are extracted dynamically from conversational intent rather than matching fixed developer examples.
  4. **Intent Evaluation Precedence:** Schema discovery intents take precedence over generic database connection keywords, ensuring queries like "Scan schema for connection 21" resolve to `SCAN_SCHEMA` rather than `ADD_CONNECTION`.
  5. **Authoritative Post-Execution Verification:** After tool execution, Laravel verifies consequential database mutations directly against Eloquent/database records before reporting success to the user or frontend.
  6. **Dynamic Parameter Revision & Compensating Updates:** Mid-task corrections evaluate semantic parameter changes (e.g., category revisions), re-planning uncommitted steps or applying atomic compensating updates to already-committed automations.
- **Consequence:** Fully open-ended, robust natural-language interaction with zero phrase brittleness, zero destructive SQL, and verifiable execution fidelity.



---

## ADR-010: Tiered data operations policy for the natural-language data agent (2026-10-15)
- **Status:** Accepted. The product owner authorised the change in the 2026-10-15 addendum. It supersedes the "no DELETE / no model-written SQL" rule in ADR-003.
- **Context:** Users want to ask about, and change, data in their own connected databases in plain English. The earlier rule allowed only automation inserts and single-row updates.
- **Decision:**

  | Operation | Policy |
  |---|---|
  | SELECT / COUNT / aggregates / schema questions | Allowed. Read-only, validated, limited. |
  | INSERT | Allowed after a preview and confirmation. |
  | UPDATE | Allowed after a preview and confirmation, pinned to the exact previewed primary keys. |
  | DELETE | Only in access mode `read_write_delete`, with impact analysis, typed confirmation, a transaction, a backup and an audit record. |
  | DROP / TRUNCATE / ALTER / CREATE / GRANT / any DDL | Always prohibited. No setting enables them. |
  | Raw model-written SQL for writes | Always prohibited. Writes are structured plans compiled by backend code. |
  | Raw model-written SELECT | Only through the validated read gate: AST parse, allowlists, forced LIMIT, timeout, read-only transaction. |

  - **Access mode:** per connection, `read_only` (default), `read_write` or `read_write_delete`. Enforced in Laravel regardless of the database user's privileges.
  - **Data classes:**
    - **Blocked tables:** credentials, tokens, sessions.
    - **Read-only tables:** financial, permission, order and audit tables, unless the owner overrides.
    - **Secret columns** are never returned, sent to a model, or written.
    - **PII columns** are masked unless revealed, and every reveal is audited.
  - **No model permissions:** the model never decides permissions. Every plan is validated against the live schema and this policy before compilation.
- **Consequence:**
  - `AGENTS.md`, `.agents/rules/03`, the product knowledge doc and the security docs were updated together.
  - The automation engine's eligibility tiers still apply to automations. Agent data changes use this policy instead.

---

## ADR-011: Qdrant Vector Store for Hybrid Metadata-Filtered Retrieval
- **Status:** Accepted (2026-10-15)
- **Context:** The previous RAG implementation relied on per-user FAISS index files with custom JSON metadata files. Storing table profiles, schema summaries, few-shot examples, product docs, and user uploads required structured metadata filtering (by `tenant_id`, `namespace`, `version`, `hash`) *before* vector scoring. The platform database is MySQL, ruling out pgvector.
- **Decision:**
  1. Adopt Qdrant as the unified vector store abstraction.
  2. For local developer environments and small-footprint deployments, run Qdrant in embedded/local mode (on-disk persistence) without requiring an extra daemon.
  3. Pre-filter by `tenant_id` and `namespace` on every query to guarantee zero cross-tenant leakage.
  4. Use an incremental, content-hash-based ingestion pipeline for Markdown documentation and table profiles.
- **Consequence:** Fast, deterministic, tenant-isolated vector retrieval with payload filtering, eliminating index file collision risks.

---

## ADR-012: Multi-Dialect Target Database Abstraction & Honest Engine Feasibility
- **Status:** Accepted (2026-10-15)
- **Context:** The prompt requires supporting MySQL and PostgreSQL for user-connected databases, while handling other engines (SQLite, SQL Server, MongoDB) honestly rather than pretending they work.
- **Decision:**
  1. Define a strict `Dialect` interface (`App\Services\Data\Dialects\Dialect`) that encapsulates identifier quoting, DSN construction, session safety initialization (UTC, statement timeout, lock timeout, read-only session), catalog introspection, and `EXPLAIN` plan parsing.
  2. Implement concrete `MySqlDialect` and `PostgresDialect` adapters.
  3. Formally register engines in `DialectRegistry`. Engines without an adapter (SQL Server, MongoDB) or engines that present multi-tenant host security risks (SQLite file paths on the server) are explicitly rejected with clear, honest error explanations.
  4. Ensure `TargetConnector` wraps read execution in isolated, read-only transactions on dedicated short-lived PDO instances that are cleaned up in `finally` blocks.
- **Consequence:** Extensible, safe database connectivity across supported dialects, preventing unverified claims.

---

## ADR-013: Natural-Language Planning Stage Merging for Low-Latency Execution on Constrained CPUs
- **Status:** Accepted (2026-10-15)
- **Context:** On constrained developer environments (CPU-only, local Ollama with models like `qwen2.5:3b`), chaining multiple sequential LLM calls (intent classification -> schema linking -> query plan generation -> answer composer) introduces 30–90 seconds of latency per query.
- **Decision:**
  1. Allow consolidation of Intent Classification and QueryPlan Generation into a single structured schema-constrained JSON invocation (`/v1/ai/data/plan`) while keeping the logical stages decoupled in code.
  2. Use schema linking to retrieve a minimal relevant slice of tables and columns via keyword matching and FK graph expansion before prompting the model.
  3. Retain a backend validation and repair loop (feeding exact validation error strings back to the model with a hard limit of 3 attempts).
  4. Fall back to deterministic algorithmic answer phrasing when `llm_answer_phrasing` is disabled, ensuring sub-second response times after query execution.
- **Consequence:** Maintains rigorous structured validation while delivering responsive user experiences on CPU-only local setups.



---

## ADR-014: Relational parents, images and honest generation in automations (2026-10-16)
- **Status:** Accepted.
- **Context:** Automations must work for any table (blogs, articles, news, products, FAQs). Many tables reference parents (`category_id → categories`), many have image columns, and the AI layer previously filled gaps with invented values (stock-photo URLs, placeholder text, foreign key `1`).
- **Decision:**
  1. A per-column field plan is built from the live schema. Foreign keys are resolved by explicit per-column rules: *AI picks (reuse or create)*, *AI picks existing only*, *fixed record*, or *empty*.
  2. A missing parent is created only when the column's policy is `CREATE_IF_MISSING`, the parent table is writable and not sensitive, and every required parent column can be filled honestly (label, slug, description, timestamps, active-looking enum, 0 for counters). Parents that need another foreign key or a secret column are refused. Parent and child are written in one transaction, parent first.
  3. Foreign keys never fall back to a guessed id. A missing id, a disallowed creation or a protected parent is an error with a plain message.
  4. The text model receives a field contract (kind, limits, enum values, existing parent names). Missing fields get one repair pass and are then reported, never invented. Image columns are never sent to the text model.
  5. Images are generated from the produced title and summary: OpenAI or Gemini with the user's own key, or a locally rendered designed cover (clearly labelled, not presented as AI). They are stored as platform media (magic bytes checked, per-user dedup), and the column receives a URL.
  6. Every run produces a read-only write plan (`planInsert`, `START TRANSACTION READ ONLY`) that is stored with the version and shown in the preview, the review email and the history.
- **Consequence:** The same rules protect previews, scheduled runs and manual publishing. Automations still follow the eligibility tiers of ADR-003/010. Connection `access_mode` is not yet applied to automations, as ADR-010 states; whether it should be is an open product decision.

## ADR-015: Schedule model with end dates, weekdays, completion and a 15-minute gap (2026-10-16)
- **Status:** Accepted. Replaces the 30-minute lead time in ADR-related docs.
- **Decision:** One-time / daily / weekly with `start_date`, optional `end_date` and ISO `weekly_days`, evaluated in the automation's IANA timezone by a single `ScheduleCalculator`. Publication ≥ 15 minutes after generation (next day allowed). One-time and bounded schedules complete automatically. Missed windows are recorded, not back-filled. `schedule_anchor_at` prevents back-filling after create, change or resume.

## ADR-016: Orbit operates the portal visibly; removals are confirmed only in its panel (2026-10-16)
- **Status:** Accepted.
- **Decision:** Orbit's on-screen tools act through the page's own handlers (`useOrbitSurface`), checked against `laravel/resources/orbit/surfaces.json` on the server. Text is typed progressively through the field's own setter. Actions marked `consequential` need confirmation (ToolPolicyGate). Actions marked `destructive` (remove connection, delete automation, remove document, cancel run) and tools with `confirm_by_button` are confirmed only by the Confirm button in Orbit's panel: a typed or spoken "yes" is interpreted by the model, and the model never decides permissions. Only then does the server send `user_confirmed`, and only then does the browser click the page's own confirmation popup (the same popup a person sees). If the model ends a turn without REQUEST_CONFIRMATION after the gate asked for one, the task still waits for approval so the button is shown.
- **Knowledge:** Orbit's product knowledge is retrieved (embeddings, FAISS partition `user_0`) from every guide in `docs/orbit-agent/`, versioned by one content hash. Guides are written from the code and must be kept exact; the Security page renders the same rules Orbit reads.
- **Consequence:** A removal always takes two deliberate user actions (panel Confirm, then watching Orbit click the popup, which the user can still cancel). The page popups now resolve a promise (`ToastContext.confirm`) so a human click and Orbit share one code path.

## ADR-017: Model-written SELECT through a validated read gate; focused path for data questions (2026-10-19)
- **Status:** Accepted. Replaces the keyword query planners of the data assistant.
- **Context:** Grouped/ranked questions ("which customer has the most refunds") always became `COUNT(*)`: the AI planner timed out (15 s / 30 s budgets on a CPU-only machine, and a TypeError in the provider call) and two keyword fallbacks answered a different question. Orbit's 3B model, inside its long agent prompt, also misread Hinglish data questions.
- **Decision:** The user's model writes one SELECT from the live schema slice (real types, enum values, foreign keys, sampled categorical values). The AI service's gate (sqlglot) accepts it only as a single SELECT over readable tables, allow-listed functions, columns resolved against the readable schema (secret columns absent), fan-out-safe aggregates, forced LIMIT; Laravel runs it read-only with a timeout, masking and audit, retries with the exact error (max 3) and otherwise reports failure — it never substitutes another query. When a message names the user's own tables/values (schema-derived `data_hint`) or a portal page (catalog-derived `page_hint`), small focused model calls route it (data question / open page / other) and write the reply from verified facts; replies must contain every verified fact or the factual sentence is used. Everything else uses the full agent loop.
- **Accuracy checks (measured):** a model-based "critic" was tried and removed: it lowered live accuracy from 13/15 to 11/15. Deterministic, question-grounded checks replaced it (unrequested filters, rankings without sorting, rankings over raw child rows, duplicating joins) and live accuracy on the 16-question reference set reached 16/16 with qwen2.5:3b (`ORBIT_LIVE_EVAL=1 php artisan test --filter=NaturalLanguageQueryAccuracyTest`).
- **Consequence:** Correct answers to rankings, ties, totals and lookups; honest failures; data questions in ~1–3 minutes and page opens in ~30 s on CPU. Orbit can no longer unmask PII itself.

## ADR-018: Orbit knowledge only in the database; visible actions enforced by the server (2026-10-23)
- **Status:** Accepted. Replaces the knowledge line of ADR-016 (guides in `docs/orbit-agent/`).
- **Decision:** Orbit's product guides are records in `orbit_knowledge_guides`, edited and published from the admin panel. A migration stores the current guides (an admin-edited guide is never overwritten); `{brand}` is replaced with the brand setting at publish time. The AI service indexes the published payload directly and keeps no Markdown files; `orbit:sync-knowledge` re-sends the guides when the AI service has none. With the portal open, backend tools that have an exact on-screen equivalent (run now, pause/resume, delete automation, retry/cancel/pause a run, approve, send back) are carried out by going to the page and pressing its own button, then verified on the server; the backend tool runs only when nothing was pressed.
- **Why:** The owner asked for all Orbit and site knowledge to live in the database and be managed from the admin side, and for Orbit to act in front of the user. Small local models often chose the background tool even when told to use the screen, so the server enforces it instead of the prompt.
- **Consequence:** A fresh AI service has no product knowledge until Laravel publishes it (automatic within 10 minutes). Pause and resume are explicit surface actions (never a toggle), and list surfaces report rows they do not show so the backend tool can take over.

## ADR-019: Fewer model calls, one-call page tours, visible thinking (2026-10-26)
- **Status:** Accepted.
- **Context:** Orbit felt slow: a portal tour took 24 model calls and 12.5 minutes and stopped at the turn limit; every on-screen step was a separate model call (17-65 s each with the owner's Gemini planner, which was out of quota and retried with back-off). Some replies were spoken twice.
- **Decision:** (1) Provider calls never retry a quota error, remember an unavailable model for a while, move to the next model at once and cap a stalled call; the user is told once which model answered. (2) A decision may carry up to 6 follow-up on-screen steps (`then`: go_to_page, open_form, fill_fields, choose_option, show_me, or press of a non-consequential action) that the server runs in order without asking the model again, stopping at the first problem; `finish_after` ends the turn with the verified result. Consequential steps are never chained: they still go through ToolPolicyGate. (3) Tours (`give_tour`, `explain_page`) are one tool call each; the browser runs the steps from `orbit_page_tours` (database, admin-editable), validated on the server against the catalog, pressing only actions that open or close something. (4) The model's one-line `thought` and planned steps are shown live (`agent.thinking`). (5) The same sentence is never spoken twice within a minute; speech is a little slower by default (0.95).
- **Consequence:** Explaining a page costs one model call instead of one per control. Speed still depends on the chosen model: a slow or rate-limited provider stays slow, and Orbit says which model answered.


## ADR-020: Orbit is grounded in retrieved knowledge and schema; the server never guesses a database (2026-10-28)
- **Status:** Accepted. Replaces the keyword `data_hint` / `page_hint` gates of ADR-017 and the fixed agent policy in the AI service.
- **Context:** Orbit added a dummy user to the wrong one of the owner's two databases. Causes found in the code and the task log: the Data page wrote a stale connection back into the URL when Orbit set connection and table in one step (and switched back to it); the orchestrator switched the screen to a connection remembered from earlier, and to a table found by a word regex, before pressing Add row; data tools fell back to the first connection, and `preview_data_change` treated a missing action, and `insert`, as a delete; the browser redactor took the Hindi "mere pass to …" for a password and removed the database name from the message. Behaviour was also steered by text in code: a long fixed prompt with one-off rules and Hindi examples (which told the model to call `choose_option` with an argument the tool does not have), keyword and regex routers, a regex that turned any "let me check" answer into a dummy-data scan, a Hindi synonym list in retrieval, and tool descriptions and policy in `TOOL_META`.
- **Decision:**
  - The decision is the model's. The server never rewrites it into another tool or a canned question, and never switches the database or table on screen. A data tool without `connection_id` while several databases are connected answers `CONNECTION_REQUIRED` with the candidates (`ConnectionResolver`); an action is never assumed; a delete's typed phrase counts only when it is in the user's own latest message.
  - Every model call is grounded in what the request brings: the administrators' role and principles and the focused calls' instructions (settings, seeded as data), the decision protocol generated from the schema, the live runtime context, and retrieval for this request: Orbit's knowledge guides (including a new operating guide that holds what the fixed prompt used to), the user's documents, and the tables of all their databases (described by Laravel from the scans; ranked in the AI service by meaning relative to the set and by rare words of table names; a same-named table in another database always comes along). The model can search the knowledge itself with `search_orbit_knowledge`.
  - The focused route call is gated by that retrieval (no model call when nothing matches) and may only answer with a database its retrieved tables are in.
  - Tool descriptions and policy live in `orbit_tools` (admin-editable, `resources/orbit/tools.json` is the shipped catalog for fresh installs); an argument named like a password or key is always filled from the vault, whatever the catalog says.
- **Not moved to data:** the decision protocol (it is the contract), the safety enforcement (ADR-010, enforced in Laravel), workflow state sets (they define the state machine), and system notices for when no model can answer.
- **Consequence:** Behaviour is changed in the admin panel (Settings › Orbit, Orbit › Knowledge, Orbit › Tools), not in code. The first request after a schema change ranks new tables by words until their vectors are embedded in the background (about 0.2 s per table on a CPU), then by meaning; vectors are kept on disk.
