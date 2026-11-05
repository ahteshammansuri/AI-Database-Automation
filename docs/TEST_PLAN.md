# Test Plan: Multi-User AI Database Automation Platform

## 1. Test Architecture & Boundaries

Testing spans three layers:
1. **Laravel Backend Tests (PHPUnit / Pest):**
   - User authentication, registration, token generation, and logout.
   - Tenant isolation & cross-user IDOR access checks (User B cannot access User A's connections or automations).
   - Dynamic database connection credential encryption at rest.
   - SSRF interception (blocks metadata endpoints, invalid IP ranges).
   - MySQL schema introspection on synthetic target database.
   - Safe execution engine: parameterized `INSERT`/`UPDATE` writes succeed, while mass-updates and forbidden operations (`DELETE`, `DROP`, `TRUNCATE`, `ALTER`) are blocked and throw security exceptions.
   - Sensitive table restriction verification (accessing `users` or `payments` is denied).
   - Approval token creation, single-use expiration, approval commit, and rejection feedback regeneration loop.
2. **Python AI Service Tests (pytest):**
   - Health check and service authentication (`X-Service-Token`).
   - Provider adapters: Mock provider generation, Ollama request/response parsing, error handling when model is missing.
   - Document chunking, text normalization, and PyMuPDF extraction.
   - FAISS vector indexing, partitioned tenant indexing, and semantic similarity querying.
   - Structured JSON output normalization and schema validation.
3. **Frontend Integration & Build Tests:**
   - Typechecking (`tsc -b`).
   - Linting (`npm run lint`).
   - Production bundle build (`npm run build`).
4. **End-to-End Vertical Slice Verification:**
   - Synthetic target MySQL database (`demo_blog_cms` on port 3308).
   - Full flow: Register user -> Connect database -> Discover schema -> Create automation -> Generate draft -> Receive email approval -> Approve draft -> Verify record inserted in target MySQL table -> Audit log confirmed.

---

## 2. Test Execution Commands

What the full Laravel suite (`php artisan test`) needs to run every test:
- the synthetic demo MySQL (`demo_blog_cms`, 127.0.0.1:3308);
- the fixture containers (`docker compose -f docker-compose.fixtures.yml up -d`: MySQL 3317, PostgreSQL 5442); tests on the fixture skip with a message when it is down;
- the AI service at `AI_SERVICE_URL` for `test_ast_read_gate_validates_sql_and_blocks_dangerous_functions` (the SQL parser runs there; skipped with a message when it is down, and `test_ast_read_gate_refuses_when_the_parser_is_unreachable` checks that the gate refuses every query meanwhile);
- `ORBIT_LIVE_EVAL=1` for the live accuracy evaluation below.

### 2.1 Natural Language Data Agent & Safety Test Suites (Pillar B)
```bash
# Run all new Data Agent, Safe Writes, Guarded Delete, and Live Correction suites:
./scripts/php-pgsql.sh laravel/vendor/bin/phpunit \
  laravel/tests/Feature/NaturalLanguageDataAgentTest.php \
  laravel/tests/Feature/SafeDataWritesAndGuardedDeleteTest.php \
  laravel/tests/Feature/LiveCorrectionAndRequirementsTest.php

# Live accuracy evaluation (16 questions with reference SQL on the shopfx fixture, real model).
# Opt-in because it takes ~15 minutes on a CPU-only machine; skipped unless ORBIT_LIVE_EVAL=1:
ORBIT_LIVE_EVAL=1 ./scripts/php-pgsql.sh laravel/vendor/bin/phpunit \
  laravel/tests/Feature/NaturalLanguageQueryAccuracyTest.php

# Run Orbit Autonomous Agent Decision & Action Test Suite:
./scripts/php-pgsql.sh laravel/vendor/bin/phpunit \
  laravel/tests/Feature/AgentAutonomousActionTest.php
```

### 2.2 Model Readiness & Vector Ingestion Tests
```bash
# Trigger Qdrant Vector Corpus Ingestion:
curl -s -X POST -H "X-Service-Token: platform_secret_internal_key_2026" \
  http://127.0.0.1:8001/v1/rag/ingest-corpus

# Test Model Readiness endpoint:
curl -s -X POST -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  -d '{"provider": "mock", "model_name": "llama3.2"}' \
  http://127.0.0.1:8000/api/model-roles/readiness-test
```

### 2.3 Core Platform Tests & Frontend Verification
```bash
# Core Laravel tests
cd laravel && php artisan test

# Python AI Service tests
cd ai_service && ../.venv/bin/pytest tests/ -v

# Frontend Typecheck and Build
cd frontend && npm run build
```



---

## Automation engine (2026-10-16)

| Suite | What it proves | Needs |
|---|---|---|
| `tests/Unit/ScheduleCalculatorTest.php` | 15-minute gap, midnight wrap, end date run count, weekly weekdays, one-time end, timezone aliases, wall-clock across DST, summary states | nothing |
| `tests/Feature/AutomationSchedulerTest.php` | exactly one run per occurrence, one-time completes, end date stops, weekly days only, missed window recorded, no back-fill after create/resume, manual containers never scheduled, keep-draft skips, late drafts not auto-published | platform DB |
| `tests/Feature/AutomationRelationsAndPipelineTest.php` | field-plan suggestions, tenant isolation, preview writes nothing, parent created first with required columns, reuse of existing parent (case-insensitive), closest existing when creation is off, schema/schedule validation messages, executor refusals (missing id, secret column, protected parent), unique slugs, enum normalisation, manual dry-run then publish, timezone scheduling, publish-now refuses rejected versions, honest e-mail failure, signed link never logged | fixture MySQL on 127.0.0.1:3317 (`docker compose -f docker-compose.fixtures.yml up -d`); skipped otherwise |
| `ai_service/tests/test_content_contract_and_images.py` | field contract, token budget, no fabricated values, one repair pass then honest `missing_fields`, no stock image URLs, local cover exact sizes, paid provider without key fails clearly, service token required | Pillow |
| `frontend/src/lib/schedule.test.ts` | client gap/weekday/run-date/timezone helpers match the server rules | Node 24 |

```bash
cd laravel && php artisan test tests/Unit/ScheduleCalculatorTest.php tests/Feature/AutomationSchedulerTest.php tests/Feature/AutomationRelationsAndPipelineTest.php
cd .. && .venv/bin/python -m pytest ai_service/tests/test_content_contract_and_images.py
cd frontend && npm test
```


## Linked records (2026-10-29)

| Suite | What it proves | Needs |
|---|---|---|
| `tests/Unit/RelationInferenceTest.php` | prefix-first detection (`blogs.category_id -> blog_categories`), pivots/views/backups never targets, self links, qualifiers, person roles, type mismatches and polymorphic pairs refused, declared keys win, owner settings, row labels never secret/personal, status-like columns | nothing |
| `tests/Feature/LinkedRecordsTest.php` | on a database with no foreign keys: links and labels on the Data page and Schema Explorer, options by name or id, create rules (name vs details, view-only and protected parents), new parent with the row in one transaction and Undo of both, existing names reused, wrong ids refused, `0` as none, new parent with details on edit, Undo keeps a parent still in use, value choices and names, owner link settings and audit, data check, IDOR, manual publishing through detected links with parent details | fixture MySQL on 127.0.0.1:3317 |
| `frontend/src/components/links/linkValue.test.ts` | new-link values, names in words, value names, typed values per type, schema facts | Node 24 |

```bash
cd laravel && php artisan test tests/Unit/RelationInferenceTest.php tests/Feature/LinkedRecordsTest.php tests/Feature/DataExplorerManagerTest.php
cd ../frontend && npm test && npx tsc -b && npm run build
```


## AI table reading and parent decisions (2026-10-30)
Verified with temporary suites that were removed afterwards, as requested (no new permanent test files):
- Laravel, fixture MySQL with generic names (`articles.hero` -> `uploads`, `state` 1/2): step-wise reading with a deterministic fake AI service; AI links, value names and kinds in the field plan, schema and Data page; `create.mode = upload`; IDOR on the insights endpoint; a parent decided as new by the model; a generated image planned as a new media row with the address in the column the model read as `file_url`; uploaded images through manual publishing and the Data page (with Undo); a foreign asset refused.
- AI service: validation (unknown roles, values that are not stored, normalisation of id images), the constrained value-naming follow-up, embedding-only answers without a model, parent decision (new, existing, same meaning, creation off, no model).
- Real local model (qwen2.5:3b, nomic-embed-text) on a demo database: see `docs/tasks/2026-10-30_ai-field-understanding/PROGRESS.md`.
Existing suites updated where behaviour changed on purpose: `DataExplorerManagerTest` (link shape), `LiveCorrectionAndRequirementsTest` (tests of removed services), `RelationshipResolverServiceTest` removed with its unused service.
