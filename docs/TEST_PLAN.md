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

