# Task tracker: natural-language data agent addendum (started 2026-10-15)

The spec is the 2026-10-15 user addendum: NL data agent, safe writes, guarded delete, live corrections, visible agent, automation clarity, privacy modes and readiness test. The audit is the top section of `docs/AUDIT.md`. Statuses below are updated as each step is verified.

**Status legend:**
- `[ ]` todo
- `[~]` in progress
- `[x]` done and tested
- `[!]` partial (see note)

## 0. Environment and fixtures
- [ ] `docker-compose.fixtures.yml`: MySQL 8 on port 3317 and PostgreSQL 16 on port 5442. Three seeded DBs per engine: `shopfx`, `legacyfx`, `crmfx`. Restricted DB users `fx_ro`, `fx_rw`, `fx_rwd`.
- [ ] `fixtures/generate_fixtures.py`: deterministic. Writes both dialects plus `fixtures/expected/*.json` (dummy labels, NL questions).
- [ ] Host PHP loads `pdo_pgsql` via `-d extension=` from the Ubuntu package for PostgreSQL tests (`scripts/php-pgsql.sh`).
- [ ] `run_all.sh` stops a previous instance's whole process tree (stale queue workers).

## 1. Audit and policy docs
- [x] `docs/AUDIT.md` addendum audit
- [ ] `AGENTS.md` and `.agents/rules/03` updated to the new policy table (user-authorised override)
- [ ] `docs/orbit-agent/product_context_rag.md` (this is `PRODUCT_CONTEXT_RAG.md`): policy table, keeping structure and precedence
- [ ] `docs/DECISIONS.md` ADR-010 (policy), ADR-011 (Qdrant), ADR-012 (dialects), ADR-013 (stage merging on CPU)
- [ ] `docs/SECURITY.md`, `docs/CAPABILITIES.md`, `docs/TESTING.md`, `docs/RUNBOOK.md`

## 2. Safety base (Laravel)
- [ ] Migration: `db_connections.access_mode` (`read_only` default), `data_policy` JSON, `data_timezone`; user prefs `timezone`, `privacy_mode`, `agent_view_mode`.
- [ ] `App\Services\Data\Dialects\{Dialect,MySqlDialect,PostgresDialect,DialectRegistry}`: unsupported engines marked honestly.
- [ ] `TargetConnector`: read-only session and transaction, statement timeout, UTC session.
- [ ] `LiveSchema`: tables, views, columns, PK/UK, FK with delete rules, estimates, sizes, server info; 60 s cache; live wins.
- [ ] `ColumnClassifier` (secret, pii, temporal role, soft-delete, label) and `DataAccessPolicy` (mode, table class blocked/read_only/writable, owner overrides).
- [ ] Audit actions for every data operation and refusal.
- [ ] Connection UI: access mode, restricted-DB-user recommendation, table overrides.

## 3. Read pipeline
- [ ] AI service: `prompts/` registry (front matter `id`/`version`/`kind`), loaded by code.
- [ ] AI service: `/v1/sql/analyze` (sqlglot AST gate, per-dialect function rules, lineage for masking).
- [ ] AI service: `/v1/ai/data/plan` (intent + QueryPlan; dynamic-enum JSON schema; repair with backend errors, max 3).
- [ ] Qdrant vector store: namespaces, tenant filters, hash ingestion, embedding version, re-embed. Schema-profile upsert and search.
- [ ] Laravel: `SchemaLinker`, `QueryPlanValidator`, `QueryCompiler` (MySQL, PostgreSQL), `ReadExecutor` (EXPLAIN guard), `ResultMasker`, `SqlGate`, `AnswerComposer`, `DataAgentService`.
- [ ] Agent tools: `ask_database`, `describe_database`, `find_tables`, `explain_relationships`, `find_dummy_data`, `set_active_connection`, `export_result`.
- [ ] UI: result card, "How I got this", data page, context header.

## 4. Time windows, dummy data, multi-connection, context
- [ ] `TimeWindowResolver`: timezone, column choice, timestamp vs timestamptz, midnight and DST tests.
- [ ] `DummyDataDetector`: evidence, confidence, precision/recall on fixture.
- [ ] Connection disambiguation and remembered active connection.
- [ ] Conversation data context: active connection/table, last plan, result refs; follow-ups.

## 5. Writes and delete
- [ ] `DataChangeService`: preview/diff, ambiguity rule, light/count confirmation, pinned execution, TOCTOU rollback, verify, before-image with TTL, undo, row caps.
- [ ] Delete: mode gate, impact analysis (recursive FK cascade), soft-delete offer, typed phrase (voice rejected), backup, limits, rate limit.
- [ ] DDL and multi-statement always refused and audited.
- [ ] UI: write preview card, delete warning card with typed confirmation, undo.

## 6. Corrections and barge-in
- [ ] Versioned slot ledger with step usage; decision `utterance_role` and `slot_patch`; patch-only semantics; stale step re-run; committed-step honesty; secret re-capture.
- [ ] Barge-in at a safe boundary; manual control pause and reconcile.

## 7. Visible agent overlay
- [ ] Eased pointer and ripple, typing animation, scroll into view, read-back verification, timeline Pause/Stop/Take over, Watch/Fast/Background modes, reduced motion, mobile highlight.

## 8. Automation clarity
- [ ] Requirements extraction (provided/inferred/missing), never-guess fields, one-at-a-time questions, Requirements Card, dry-run payload, visible creation, verified next run.

## 9. Privacy modes and readiness
- [ ] Privacy modes enforced in the provider layer (AI service) and in Laravel; no silent fallback; per-task provider/model shown.
- [ ] Model Readiness Test (JSON conformance, tool choice, NL to QueryPlan on the fixture schema, correction), score and warning.

## 10. Decision protocol fix
- [ ] Per-kind `anyOf` decision schema so `CALL_TOOL` always carries `tool_call` (live finding).

## 11. Tests and report
- [ ] Laravel feature tests on real fixture DBs (MySQL and PostgreSQL), per spec section 12.
- [ ] NL accuracy suite: 60+ questions per dialect, accuracy per model (LIVE).
- [ ] Final report: complete / partial / not done.
