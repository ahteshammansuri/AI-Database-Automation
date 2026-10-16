# Platform Operational Runbook

This runbook describes how to launch, monitor, troubleshoot, and operate the Multi-User AI Database Automation Platform in local development and production environments.

---

## 1. Quick Start

The platform provides a unified start script [`./run_all.sh`](file:///home/acquaint/Desktop/AI-Powered%20Database%20Automation/run_all.sh) that starts all services:

```bash
# 1. Start all platform components
./run_all.sh
```

This launches:
- **Python FastAPI AI Service**: `http://127.0.0.1:8001`
- **Laravel Control Plane Backend**: `http://127.0.0.1:8000`
- **Laravel Queue Worker**: Persisted database queue daemon
- **React Frontend (Vite)**: `http://localhost:5173`

---

## 2. Environment Configuration

### Control Plane (`laravel/.env`)
- `APP_KEY`: Application encryption key for database passwords and API keys at rest.
- `DB_CONNECTION=mysql`: Platform persistence database connection (`platform_automation`).
- `AI_SERVICE_URL=http://127.0.0.1:8001`: Private internal AI service connection.
- `AI_SERVICE_KEY`: Shared internal authentication token for service-to-service requests.
- `FEATURE_*`: Flags for Phase 6 advanced capabilities (all default to `true`).

### AI Service (`ai_service/.env`)
- `AI_SERVICE_KEY`: Matches control plane secret for request verification.
- `OLLAMA_BASE_URL=http://127.0.0.1:11434`: Local Ollama inference URL.
- `DEFAULT_OLLAMA_MODEL=llama3.2:1b`: Local default model.

---

## 3. Health & Diagnostic Endpoints

| Service | Method & Endpoint | Purpose |
|---|---|---|
| AI Service | `GET http://127.0.0.1:8001/v1/ai/health` | Verifies FastAPI health and Ollama connection |
| Control Plane | `GET http://127.0.0.1:8000/api/features` | Reports active feature flags |
| Control Plane | `GET http://127.0.0.1:8000/api/live/stream` | Server-Sent Events (SSE) live event channel |
| Target DB | `POST http://127.0.0.1:8000/api/connections/{id}/test` | Multi-stage staged diagnostics check |

---

## 4. Background Workers & Queue Management

Work is processed asynchronously by Laravel database queues:

```bash
# Start queue worker manually (if not using run_all.sh)
cd laravel && php artisan queue:work --tries=3 --timeout=120

# Run scheduler tick
cd laravel && php artisan schedule:run
```

---

---

## 5. Natural Language Data Agent & Fixture Databases (Pillar B)

### 5.1 Docker Fixture Databases
Synthetic multi-dialect databases run via Docker for isolated testing and local evaluation:
- **MySQL Container**: `127.0.0.1:3317` (user `root`, password `fxroot`)
- **PostgreSQL Container**: `127.0.0.1:5442` (user `postgres`, password `fxroot`)
- **Databases**:
  - `shopfx`: Primary read-only e-commerce fixture (13 tables, dummy data, junction tables).
  - `shopfx_w`: Writable clone for testing safe updates, guarded deletes, and TOCTOU concurrency rollbacks.
  - `legacyfx`: Unconventional schema (`tbl_acct_main`, `tbl_ord_hdr`, `tbl_prd_mst`) for semantic table discovery tests.
  - `crmfx`: Multi-connection disambiguation fixture with a second `users` table.

Re-generate or reset fixtures:
```bash
python3 fixtures/generate_fixtures.py
docker compose -f fixtures/docker-compose.yml restart
```

### 5.2 Data Agent Endpoints
| Endpoint | Method | Purpose |
|---|---|---|
| `/api/data-agent/ask` | `POST` | Ask plain English questions about connected databases (schema, dummy data, counts, filters, joins). |
| `/api/data-agent/preview-change` | `POST` | Generate before/after diff for updates or recursive impact analysis for deletes. |
| `/api/data-agent/confirm-change` | `POST` | Execute pinned write inside a transaction with typed phrase verification. |
| `/api/data-agent/undo-change` | `POST` | Revert any completed change using encrypted before-image. |
| `/api/model-roles/readiness-test` | `POST` | Benchmark model against JSON conformance, tool-calling, and NL planning. |

### 5.3 Vector Store (Qdrant) Corpus Ingestion
Markdown policy documents (`docs/orbit-agent/product_context_rag.md`, `docs/SECURITY_MODEL.md`, `docs/DECISIONS.md`) and all `prompts/` are embedded via local Ollama `nomic-embed-text` and indexed in Qdrant:
```bash
# Ingest corpus via API:
curl -s -X POST -H "X-Service-Token: platform_secret_internal_key_2026" \
  http://127.0.0.1:8001/v1/rag/ingest-corpus
```

---

## 6. Verification Commands

Run all automated test suites to ensure full system integrity:

```bash
# 1. Natural Language Data Agent & Safe Writes Feature Tests (480 assertions)
./scripts/php-pgsql.sh laravel/vendor/bin/phpunit \
  laravel/tests/Feature/NaturalLanguageDataAgentTest.php \
  laravel/tests/Feature/SafeDataWritesAndGuardedDeleteTest.php \
  laravel/tests/Feature/LiveCorrectionAndRequirementsTest.php \
  laravel/tests/Feature/NaturalLanguageQueryAccuracyTest.php

# 2. Autonomous Orbit Agent Loop Tests (30 tests, 447 assertions)
./scripts/php-pgsql.sh laravel/vendor/bin/phpunit \
  laravel/tests/Feature/AgentAutonomousActionTest.php

# 3. Core Laravel Control Plane Tests
cd laravel && php artisan test

# 4. Python AI Service Tests
cd ai_service && ../.venv/bin/pytest tests/ -v

# 5. Frontend Production Build Check
cd frontend && npm run build
```

---

## 7. Operational Incident Recovery

- **Ollama Offline**: When local Ollama is unreachable, the system does not crash or silently swap providers; it surfaces a clear diagnostic message in the UI and permits manual content scheduling.
- **Database Connection Failure**: Staged diagnostics report precisely which phase failed (DNS resolution, network timeout, SSL handshake, or authentication) without logging raw credentials.
- **Runaway Agent Task**: Pressing `Escape` or clicking "Stop" invokes `POST /api/agent/tasks/{id}/cancel` to immediately supersede pending steps.
- **Accidental Publication / Write**: The Data Change Service (`POST /api/data-agent/undo-change`) safely reverts the target record using encrypted before-images while recording the action in immutable audit logs.
- **TOCTOU Concurrency Conflict**: If target rows change between preview and execution, the executor automatically aborts the transaction, rolls back, and returns an honest conflict explanation.

