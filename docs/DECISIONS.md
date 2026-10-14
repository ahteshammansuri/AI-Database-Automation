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
- **Status:** Accepted
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


