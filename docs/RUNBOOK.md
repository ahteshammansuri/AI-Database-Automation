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

## 5. Verification Commands

Run all automated test suites to ensure full system integrity:

```bash
# 1. Full Laravel Control Plane Tests (89 feature & unit tests)
cd laravel && php artisan test

# 2. Python AI Service Tests (13 tests)
PYTHONPATH=. ./.venv/bin/pytest ai_service/tests/

# 3. Frontend Production Build Check
cd frontend && npm run build
```

---

## 6. Operational Incident Recovery

- **Ollama Offline**: When local Ollama is unreachable, the system does not crash or silently swap providers; it surfaces a clear diagnostic message in the UI and permits manual content scheduling.
- **Database Connection Failure**: Staged diagnostics report precisely which phase failed (DNS resolution, network timeout, SSL handshake, or authentication) without logging raw credentials.
- **Runaway Agent Task**: Pressing `Escape` or clicking "Stop" invokes `POST /api/agent/tasks/{id}/cancel` to immediately supersede pending steps.
- **Accidental Publication**: The Undo Center (`POST /api/executions/{id}/undo`) safely reverts the target record within 24 hours while recording the action in immutable audit logs.
