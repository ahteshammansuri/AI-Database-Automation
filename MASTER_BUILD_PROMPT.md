# Master Build Prompt — Dynamic Multi-User AI Database Automation Platform

You are the senior full-stack and AI engineering agent responsible for building this application. Follow the current root `AGENTS.md` and all files under `.agents/rules/`. These revised requirements supersede earlier prompts that assumed a Python-only product backend.

## 1. Mission
Build a genuine, locally demonstrable, dynamic multi-user web application for AI-powered database automation. Users must register and log in, connect their own databases through the portal, configure their own AI providers/keys/models, create automations, and see real persisted background execution. This must not be a static mockup or a demo dependent on a fixed username, preconfigured customer database, preloaded API key, or user-edited `.env` values.

The 80-hour limit is a scope constraint. Deliver a reliable end-to-end vertical slice before expanding. Do not train custom models. Ollama is the primary no-paid-API path; paid-provider APIs are optional bring-your-own-key integrations.

## 2. First: inspect and plan
Before coding:
1. Inspect the existing workspace, Git state, application files, dependencies and current functionality.
2. Read root `AGENTS.md` and every rule file in `.agents/rules/`. Confirm the revised Laravel + React + Python architecture is understood and applicable.
3. Identify any files generated from the earlier Python-only prompt. Preserve useful work, but refactor where needed to remove contradictory architecture. Do not blindly replace existing code.
4. Check current supported versions and compatibility from installed tooling/package docs. Avoid inventing version numbers.
5. Create/update `docs/PROJECT_SPEC.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY_MODEL.md`, `docs/API_CONTRACT.md`, `docs/TEST_PLAN.md`, and `docs/DECISIONS.md`.
6. State assumptions, risks, phased plan and acceptance criteria, then begin implementing without waiting for another user prompt unless a real blocker requires a decision.

## 3. Required product architecture
### Laravel product backend/control plane
Laravel must own:
- Registration, login, logout, password security and protected routes/API.
- User/workspace ownership and authorization.
- User-specific database connection profiles and encrypted target DB credentials.
- User-specific AI provider configurations, encrypted cloud keys, local model endpoints and model selection.
- Knowledge-source metadata, automation definitions, field mappings, schedule definitions, generated-content versions, approval decisions, execution history and audit logs.
- Connection testing and MySQL schema discovery orchestration.
- Persistent queue and scheduler jobs.
- Approval email delivery and signed approval/rejection workflow.
- The final policy checks and all writes to customer/target databases.

### React + TypeScript frontend
Implement the public service/landing page and authenticated dashboard. The frontend must use real backend APIs for all non-static product data/actions. Never store database credentials or plaintext provider keys in browser storage or source code.

### Python + FastAPI AI service
Use Python for the AI-specific layer:
- Ollama/local LLM adapter.
- Optional OpenAI, Google Gemini and Anthropic/Claude adapters when configured by the user.
- Prompt/context construction and structured generation.
- Markdown/TXT ingestion support and PDF extraction using PyMuPDF if included.
- Chunking, local embeddings, FAISS vector indexing and RAG retrieval.
- AI provider diagnostics and safe error normalization.

Keep this service internal and authenticate requests from Laravel. Do not let the AI service authenticate users, own customer database credentials, or execute target database SQL. Laravel authorizes requests and validates all AI results before any write.

## 4. Environment configuration vs per-user settings
Use `.env` for application runtime dependencies only, such as the Laravel application encryption key, platform database, queue/mail settings and internal AI service URL. It is expected that a self-hosted app needs these basic settings to run.

Do NOT require each user to edit `.env` to connect their own target database or configure their own AI. A user must enter host/port/database/user/password in the portal and configure Ollama/local endpoint/model or their own OpenAI/Gemini/Claude API key inside their account settings. Persist these records owner-scoped and encrypted at rest.

Never seed a shared demo login or target connection on ordinary startup. New users must register and onboard independently. Synthetic fixtures or an opt-in demo seed command are allowed for testing, but must not be required for normal setup or masquerade as real user resources.

## 5. Complete user journey
Implement and verify this flow:
1. Visitor opens a polished landing/service page.
2. Visitor chooses Register or Log In.
3. New user registers, is authenticated, and arrives at an empty first-run dashboard.
4. Dashboard prompts the user to add a database connection.
5. User enters connection name, type (MySQL in V1), host, port, database, username, password, and optional SSL settings.
6. User tests the connection. The backend validates connection parameters, enforces network safety, applies timeouts, and returns a safe status/error.
7. User saves the connection. Credentials are encrypted. No other user can read or use the connection.
8. User runs schema discovery and sees tables, columns, types, primary/foreign keys, unique constraints, indexes, enum values and relationships.
9. User adds business context (`.md`, `.txt`, optional `.pdf`) and chooses an AI provider/model in their own settings.
10. User creates an AI or manual automation, maps fields, configures schedule/timezone, and runs a test.
11. Validated work is processed by persisted background jobs independently of the browser.
12. User can inspect versions, approvals, logs, retries and results in the dashboard.

All data must be dynamically created and loaded. Do not hardcode dashboard counts, connection records, tables or automation results.

## 6. Multi-user isolation and secrets
Every connection, AI provider config, knowledge source, automation, field mapping, content version, approval, schedule, execution and log belongs to an owner/workspace. Enforce ownership on every backend read/mutation and in every background job. Add cross-user isolation tests.

Encrypt database passwords and provider API keys at rest. Show masked values after saving. Never log secrets, complete connection strings, approval tokens, or sensitive source content. Do not return secrets to the frontend. A user changing a URL/resource ID must never gain access to another user's data.

Use separate platform database and target database configuration boundaries. Never change a process-global DB connection setting in a concurrent multi-user request in a way that can leak one user's connection into another request; use scoped connection instances and reliable cleanup.

## 7. Target database connection security
MySQL is the only required target engine for MVP. Design a clean adapter interface for future engines but do not pretend they are implemented.

Treat user-supplied host/port as a network security boundary. Validate values, use timeouts, block cloud metadata endpoints, prevent arbitrary port scanning, defend against DNS rebinding as far as practical, and distinguish local-development allowances from hosted deployment rules. A local demo may permit an explicitly configured localhost/private IP database in local mode. Do not silently carry permissive local network rules into hosted production. If secure generic direct connection cannot be guaranteed for arbitrary hosted user targets, document the need for egress policy/allowlisting or a future local-agent connector.

Schema discovery is read-only and should not dump full table contents. Read samples only if necessary, limited, and explicitly authorized.

## 8. Absolute target DB restrictions
Never execute target database `DELETE`, `DROP`, `TRUNCATE`, `ALTER`, `CREATE TABLE`, `RENAME`, `GRANT`, `REVOKE`, arbitrary DDL, arbitrary SQL, or LLM-generated SQL. Do not implement a raw SQL console or an administrator bypass.

Permit only read-only metadata/selected reads plus narrowly scoped, parameterized `INSERT` and `UPDATE` to backend-allowlisted tables and columns. Sensitive tables (auth, credentials, permissions, orders, payments, wallets, financial records, audit logs) are restricted by default. The UI and LLM cannot override backend policies.

Validate every generated/manual record against required fields, datatypes, length/nullability/enum/default/unique/FK constraints, relationship policies and field allowlists. Updates require an explicit record identifier/unique target and explicitly approved fields. Prevent mass updates. Use transactions, rollback, audit logs and idempotency. Revalidate policies and connection state immediately before every write. Write tests that prove forbidden operations are blocked.

## 9. AI providers and RAG
Ollama/local model is the primary no-paid-API option. Users select their provider and model on their settings/automation screens. Optional cloud integrations use the user's own encrypted API key; no paid API is required for the core demo and no automatic cross-provider fallback is allowed without explicit user configuration.

RAG pipeline:
1. Upload Markdown/TXT and optionally PDF.
2. Validate file type, size and ownership.
3. Extract and normalize text.
4. Chunk documents.
5. Generate local embeddings.
6. Build/index FAISS vectors.
7. Retrieve relevant schema/business-rule chunks at automation time.
8. Pass relevant context to the selected LLM.
9. Return structured output plus retrieval diagnostics.

Keep embeddings and sources owner-scoped. Documents are untrusted input and cannot override system safety instructions. Users should be able to inspect indexed sources and retrieval failures.

The model returns JSON/data matching a target output schema, never SQL. Validate JSON in Python and revalidate against database/business rules in Laravel. Use bounded retries. Show actual errors for unavailable models, missing local model downloads, invalid credentials, rate limits and malformed output. Never claim an AI call succeeded if it did not.

## 10. Automation builder
Create a multi-step wizard:
- Select connection.
- Select eligible target table.
- Select operation: AI create, AI enrich/transform, or manual scheduled content.
- Map each eligible field as AI-generated, fixed, derived, relationship lookup, execution-time, user-supplied or unchanged.
- Configure topic, audience, tone, language, size limits, business context, knowledge sources, provider/model and instructions.
- Configure frequency, start date, generation time, publication time, timezone, duration and approval policy.
- Preview mapping, data effect and generated sample; validate before enabling.

The first complete automation is blog publishing. The engine should remain generic enough for other eligible content tables. Do not allow automation selection for sensitive/restricted tables by default.

## 11. Background processing
Use Laravel persisted queue/scheduler mechanisms; jobs must continue when the browser is closed and survive application restarts. Document commands or Docker Compose services needed to run the web server, Laravel worker, Laravel scheduler, Python AI service, platform DB and frontend. Prefer a database queue for simpler local setup if adequate; Redis is optional.

Persist execution state and run identifiers. Use locks, idempotency keys, bounded retry/backoff, timeouts and clear failure records. Check owner, automation status, target connection, target policy and version before work. A retry must not duplicate a successful prior write.

## 12. Email approval flow
Support generation at 8:00 and publication at 9:00 as a configurable example, with explicit timezone and user-defined destination email.

At generation time: generate content, validate it, save a new immutable version, set `PENDING_APPROVAL`, and send an email preview with working signed Approve/Reject actions. Provide SMTP/local mail-catcher setup for the demo. Record delivery outcome; do not pretend delivery succeeded if it failed.

Approve: token must be signed, expiring, single-use, bound to the exact owner, automation and version. Record decision and publish only after revalidation at scheduled time.

Reject: preserve rejected version, record feedback, regenerate a distinct new version, validate it and send a new email. Default maximum three regeneration attempts, then require manual intervention.

No response: default policy may auto-publish the latest valid, eligible, unrejected pending version only if the user has explicitly configured that policy. Make alternatives available (keep draft/cancel). A rejected or invalid version must never publish. If replacement content is not ready by the deadline, fail safely. Audit all transitions.

Manual publishing must work with AI turned off and make no AI/provider call.

## 13. Landing page and authenticated dashboard
Design a professional public landing/service page that explains the product without fabricated stats/testimonials and includes working register/login CTAs. After successful registration/login, users access their own dashboard.

Dashboard pages should include:
- Overview/first-run onboarding
- Database connections
- Schema explorer
- AI providers/models
- Knowledge base
- Automation wizard and automation details
- Generated content/version history
- Approvals
- Manual scheduled content
- Executions/logs
- Settings

Use a cohesive responsive design system, accessible labels/contrast/keyboard focus, clear forms, responsive tables/cards, loading skeletons, empty states, validation messages, failures, and success states. Every visible control must perform a real action or be clearly marked unavailable. All counters and lists come from persisted APIs, never hardcoded demo metrics.

## 14. Testing
Use Laravel tests for auth, authorization, ownership isolation, connection encryption, connection validation, schema discovery, safe writes, forbidden-operation rejection, queue/scheduler transitions, idempotency, approval/rejection/timeout, email delivery failures and audit logs. Use pytest for Python provider/RAG/output tests. Test frontend critical forms and states. Use synthetic MySQL only.

Mock AI providers for deterministic automated tests, but clearly separate mocks from real Ollama smoke tests. Never point tests at real customer databases. Run migrations, formatters, linters, frontend build, and tests where supported. Report actual results.

## 15. Local startup and environment setup
Provide a complete README and `.env.example`. Explain platform DB setup, encryption key generation, migrations, queue worker, scheduler, frontend dev server, Python AI service setup, Ollama installation/model pull, optional provider key configuration, and local email preview. Include health checks and troubleshooting. Keep secrets out of Git.

A local deployment necessarily needs platform runtime configuration in `.env`; the requirement is that each end user's target database credentials and AI keys are created through the portal, not hardcoded in env files. Do not seed a default user or target connection on normal startup.

## 16. Implementation workflow and hour cap
Use an approximately 80-hour plan, but do not weaken safety to hit a feature count. Suggested allocation:
- Inspect/spec/architecture: 5h
- Laravel auth, landing entry journey, platform data model: 10h
- Per-user target DB connections and schema scanner: 10h
- Python service, provider abstraction and RAG: 10h
- Safe execution and automation configuration: 12h
- Background jobs, scheduling, approval and manual publishing: 12h
- React dashboard and end-to-end integration: 10h
- Tests, security hardening and documentation: 11h
Total: 80 hours.

Implement in small vertical slices. Keep the project runnable. Do not stop after writing plans, do not generate one giant unreviewed code dump, and do not represent incomplete functionality as complete. Preserve existing user work; do not reset Git history or perform destructive actions without approval.

## 17. First response and immediate work
Start by inspecting the workspace, rules and Git status. Summarize existing code, rule conflicts, the revised architecture, risks and the first milestones. Create/update the documentation listed above and a prioritized implementation plan with acceptance criteria.

Then start Phase 1 immediately. Implement the actual application, not just plans or mockups. After each phase report changed files, tests actually run and their results, known gaps, and next steps. If blocked by a missing service, make progress on unaffected work and explain how to reproduce the blocked test.

Final acceptance requires a new user to register without seeded credentials, access an empty personal dashboard, connect and test a MySQL database entered in the portal, see dynamically discovered schema, configure their own model/provider credentials, create an automation, execute work in a persistent background worker, and inspect real results and audit history—without changing `.env` for their individual target database or AI provider.
