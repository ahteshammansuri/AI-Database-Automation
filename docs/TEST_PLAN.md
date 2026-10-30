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

### 2.1 Natural Language Data Agent & Safety Test Suites (Pillar B)
```bash
# Run all new Data Agent, Safe Writes, Guarded Delete, and Live Correction suites:
./scripts/php-pgsql.sh laravel/vendor/bin/phpunit \
  laravel/tests/Feature/NaturalLanguageDataAgentTest.php \
  laravel/tests/Feature/SafeDataWritesAndGuardedDeleteTest.php \
  laravel/tests/Feature/LiveCorrectionAndRequirementsTest.php

# Run 60-Question NL Accuracy Evaluation Suite (MySQL & PostgreSQL live fixtures):
./scripts/php-pgsql.sh laravel/vendor/bin/phpunit \
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
