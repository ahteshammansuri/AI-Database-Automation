# Workspace Agent Instructions — Multi-User AI Database Automation Platform

## Product definition
Build a genuinely functional, self-service web application where individual users can register, log in, connect their own supported databases, inspect discovered schema, configure their own AI provider credentials or local model connection, and run AI or manual data automations. This is not a hardcoded showcase with one preconfigured database, seeded login, or shared provider key.

The primary demonstration is blog-content generation/approval/scheduled publishing, but the workflow engine should be reusable for eligible tables such as product descriptions, FAQs, and web pages.

## Required architecture
- **Laravel** is the main application backend/control plane: authentication, users, tenant/resource ownership, database connection profiles, automation definitions, scheduling and queues, email approval, platform persistence, audit logs, authorization, and REST API.
- **React + TypeScript** is the public landing/service page and authenticated portal/dashboard.
- **Python + FastAPI** is a dedicated AI service for Ollama/local LLM inference, optional provider adapters, prompt/context construction, embeddings, RAG retrieval, and structured AI output.
- Use a private/internal service connection between Laravel and the Python service. Keep business authorization and all target-database access (reads and writes) in Laravel's controlled execution layer. The AI service must not have customer-database access; it may parse SQL text, but it never connects to a target.
- MySQL is the first supported customer/target database; PostgreSQL goes through the same dialect adapter interface. Do not claim other database engines work until they are implemented and tested. Mark unsupported engines honestly.

## Configuration boundary
Environment variables are for application/runtime configuration only (for example platform database, Laravel application key, queue/mail configuration, and internal AI-service URL). They must NOT contain per-user customer database credentials, per-user provider API keys, a fixed demo user, a preconfigured customer database, or an automation that users are expected to share.

User-specific target database connections, AI provider selections, provider keys, local model endpoints, and automation configuration must be created through the authenticated portal, persisted with ownership boundaries, and protected at rest. A fresh installation must not depend on seeded customer connections or a default demo account.

## Non-negotiable security
- Customer-target data policy (owner-authorised change, 2026-10-15; see `docs/DECISIONS.md` ADR-010). It is enforced in Laravel and never decided by the model:
  - **Reads** (SELECT, counts, aggregates, schema questions) are allowed: read-only, validated and limited.
  - **INSERT** and **UPDATE** are allowed only after a preview and confirmation. UPDATEs are pinned to the exact previewed primary keys. Never allow an unscoped update.
  - **DELETE** is allowed only when the connection owner set access mode `read_write_delete`, with impact analysis, typed confirmation, a transaction, a backup and an audit record.
  - **Always prohibited:** `DROP`, `TRUNCATE`, `ALTER`, `CREATE`, `RENAME`, `GRANT`, `REVOKE`, any other DDL, a raw SQL console, and model-written SQL for writes.
  - **Model-written SELECT** may run only through the validated read gate: AST parse, single statement, allowlisted tables and functions, forced LIMIT, timeout, read-only transaction.
  - Per-connection access mode defaults to `read_only`.
- Enforce tenant/resource ownership in backend authorization and background jobs, not just in frontend filtering.
- Sensitive tables and fields are restricted by default:
  - **Blocked:** credential, token and session tables.
  - **Read-only:** financial, permission, order and audit tables, until the owner changes that per connection.
  - **Never returned or written:** secret columns such as password hashes, tokens, card numbers and national IDs.
  - **Masked:** PII such as emails and phones, revealed only through an audited action.
- Encrypt stored database credentials and provider API keys at rest. Never log secrets or return them to the frontend after saving.
- AI output is untrusted. Validate schema, data type, length, required fields, allowed enum values, business policy, references and uniqueness before writes.
- Use transactions, rollback, idempotency, execution locks, bounded retries and an audit trail.
- Protect connection testing against SSRF and network abuse. See the database security rule for local-demo vs hosted deployment handling.

## Product behavior
- Public landing/service page → register or log in → authenticated dashboard → user creates a connection → test connection → discover schema → create automation.
- Every user has separate connections, provider credentials, knowledge sources, automations, content versions, approval decisions, schedules, and execution logs.
- Support local Ollama as the no-paid-API path. OpenAI, Gemini and Claude are optional user-configured providers; never require a paid API for the core workflow.
- Support Markdown and TXT context, with PDF as an additional format. Implement real embeddings and RAG retrieval when using RAG.
- Support AI-generated content with email approval/rejection/versioned regeneration, and manual content scheduling with AI disabled.
- Background work must continue when the browser is closed and survive application restarts using persisted jobs/schedules, not browser timers or in-memory-only state.

## Development constraints
- Aim for an approximately 80-hour MVP. Scope the first end-to-end vertical slice; do not build every future enterprise feature.
- Use synthetic/public data for tests and demo. Never require production data.
- Inspect the repository and all rules before modifying code. Preserve useful existing work.
- Build incrementally, keep the app runnable, test each vertical slice, and report actual test results. Never claim unverified functionality works.
- Do not commit secrets, discard user changes, reset Git history, or run destructive commands without explicit authorization.
- Maintain `docs/IMPLEMENTATION_PLAN.md`, architecture/security/API/test documents, and a complete README.

See `.agents/rules/` for the required detail by domain. If these files conflict with earlier project prompts that require a Python-only web backend, follow this updated architecture: Laravel product/control-plane backend + Python/FastAPI AI service.
