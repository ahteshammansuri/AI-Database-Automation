# AI-Powered Database Automation Platform

A self-service, multi-user web application where users register, log in, connect their own MySQL databases through the portal, inspect discovered schema, configure their own AI provider credentials (local Ollama or optional cloud APIs), author RAG business context, and execute automated or manual content pipelines with durable background processing and human-in-the-loop email approvals.

---

## 1. System Architecture

The application is structured into three decoupled tiers:

```
+-------------------------------------------------------------------------+
|                  React 19 + TypeScript Frontend (Port 5173)              |
|   - Public Landing / Service Page       - Registration & Login          |
|   - First-run Onboarding State          - Database Connection Manager   |
|   - Real-time Schema Explorer           - Automation Wizard             |
|   - Content Version History             - Email Approval Review Portal  |
+------------------------------------+------------------------------------+
                                     | REST API (Sanctum Tokens)
                                     v
+-------------------------------------------------------------------------+
|                 Laravel 11 Control Plane Backend (Port 8000)            |
|   - User Authentication & Multi-Tenant Authorization (Sanctum)          |
|   - Dynamic MySQL Target Connections (Encrypted Credentials at Rest)    |
|   - Read-only Schema Introspection Engine (Tables, Columns, Enums, FKs) |
|   - Sensitive Table Auto-Classifier (Restricts users, payments, auth)   |
|   - Hard SQL Interceptor (Rejects DELETE, DROP, TRUNCATE, ALTER, DDL)   |
|   - Safe Target Executor (Parameterized INSERT & Scoped UPDATE only)    |
|   - Background Queue Worker & Scheduled Job Runner                      |
|   - Signed Single-Use Approval Token & Email Notification Engine        |
|   - Tenant-Scoped Audit Logging                                         |
+------------------------------------+------------------------------------+
                                     | Internal HTTP (X-Service-Token)
                                     v
+-------------------------------------------------------------------------+
|                 Python 3.12 FastAPI AI Service (Port 8001)              |
|   - Local Ollama Adapter (http://localhost:11434)                       |
|   - High-Fidelity Mock Provider (Deterministic Testing / Offline Demo)  |
|   - Optional User-Configured Cloud Adapters (OpenAI, Gemini, Anthropic) |
|   - Document Ingestion: Markdown (.md), TXT (.txt), and PDF (PyMuPDF)   |
|   - Overlapping Chunking, Dense Embeddings, FAISS Vector Indexing       |
|   - Structured JSON Generation Validated Against Target Schema          |
+-------------------------------------------------------------------------+
```

---

## 2. Core Security & Guardrails

- **Zero Destructive Queries:** The platform will NEVER execute `DELETE`, `DROP`, `TRUNCATE`, `ALTER`, `CREATE TABLE`, `RENAME`, `GRANT`, `REVOKE`, or arbitrary raw SQL. An AST-level interceptor blocks any prohibited query string.
- **Allowed Target Operations:** Read-only metadata introspection and parameterized, allowlisted `INSERT` and scoped primary-key `UPDATE` statements exclusively.
- **Default-Deny Sensitive Tables:** Tables containing passwords, authentication, tokens, permissions, payments, billing, wallets, and audit logs are classified as restricted and blocked from automation.
- **Encrypted Credentials:** Target database passwords and provider API keys are encrypted at rest with AES-256 (`Crypt::encryptString`) and masked in all UI responses (`********`).
- **SSRF Defense:** Prohibits connections to cloud metadata endpoints (`169.254.169.254`) and restricted network ranges.
- **Multi-Tenant Ownership:** Every database connection, AI provider setting, knowledge source, automation, version, and log is owned by the authenticated user. Cross-user IDOR access is strictly rejected with 404s.

---

## 3. Quick Start & Local Setup

### 3.1 Prerequisites
- **PHP 8.3** with `pdo_mysql`, `curl`, `mbstring`, `openssl`
- **Composer 2.x**
- **Node.js 18+** & **npm**
- **Python 3.12**
- **MySQL 8.0**

### 3.2 Automated Startup (Single Command)
Run the all-in-one startup script from the project root:
```bash
./run_all.sh
```

This launches:
1. Python AI Service on `http://127.0.0.1:8001`
2. Laravel Control Plane on `http://127.0.0.1:8000`
3. Laravel Queue Worker (`php artisan queue:work`)
4. React Frontend on `http://localhost:5173`

Open **http://localhost:5173** in your browser.

---

## 4. Manual / Individual Service Setup

If running components separately:

### Python AI Microservice:
```bash
# Setup venv and run service
.venv/bin/python -m uvicorn ai_service.app.main:app --host 127.0.0.1 --port 8001
```

### Laravel Backend:
```bash
cd laravel
# Configure environment (DB_DATABASE=platform_automation, DB_PORT=3308)
cp .env.example .env (if needed)
php artisan key:generate
php artisan migrate

# Start API server
php artisan serve --host=127.0.0.1 --port=8000

# Start background queue worker
php artisan queue:work
```

### React Frontend:
```bash
cd frontend
npm install
npm run dev
```

---

## 5. Automated Test Suites

### 1. Laravel Test Suite (15 Tests, 58 Assertions)
Tests authentication, cross-user IDOR tenant isolation, SSRF prevention, sensitive table auto-classification, forbidden SQL AST interceptor, live target MySQL safe insertion, and single-use approval token lifecycle:
```bash
cd laravel && php artisan test
```

### 2. Python AI Service Test Suite (6 Tests)
Tests service token authentication, Mock provider generation, Ollama error handling, PyMuPDF parsing, and FAISS RAG vector indexing/retrieval:
```bash
PYTHONPATH=. .venv/bin/pytest ai_service/tests -v
```

### 3. Frontend TypeScript & Production Build
Tests type safety and builds client bundle:
```bash
cd frontend && npm run build
```

### 4. End-to-End Vertical Slice Integration Test
Executes the full user journey: register -> empty dashboard check -> connect MySQL target -> schema scan -> build automation -> background queue generation -> email review -> interactive approval -> background publication -> direct physical MySQL target table verification -> cross-user IDOR check:
```bash
.venv/bin/python scripts/verify_end_to_end.py
```

---

## 6. End-to-End User Journey

1. **Public Landing Page (`/`):** Explains product value, safety boundaries, and local vs cloud AI options. Click **Get Started** or **Sign In**.
2. **Registration (`/register`):** Create an account with name, email, and password. An isolated tenant workspace is initialized.
3. **Empty Onboarding Dashboard (`/dashboard`):** Prompts the user with a welcoming banner to connect a database.
4. **Add Connection (`/connections`):** Enter host, port (e.g. `127.0.0.1:3308`), database name (`demo_blog_cms`), user, and password. Test live and save with encryption.
5. **Schema Explorer (`/explorer`):** Inspect discovered tables, columns, data types, primary keys, and foreign keys. Observe that `users` and `payments` are marked restricted.
6. **Configure AI / RAG (`/ai-providers`, `/knowledge`):** Select local Ollama or Mock provider; optionally upload Markdown or PDF technical guidelines for vector retrieval.
7. **Create Automation (`/automations/new`):** Select eligible table (`posts`), map fields (`title`, `slug`, `content`, `excerpt`, `status`), configure schedule and reviewer email.
8. **Review & Publish (`/approvals/:token`):** Review generated preview via signed email link. Approve or reject with editorial feedback. Approved records are published to target MySQL by background workers.
9. **Audit Trail (`/audit-logs`):** Inspect immutable audit records for every action.

---

## 7. Orbit — Animated Voice-First AI Companion Mascot

The portal features an original, fully articulated 3D companion mascot named **Orbit** that floats in the bottom-right corner of authenticated routes.

### Visual Architecture
- **Canonical Model:** Smooth pearl-white shell (`#FFFFFF`), midnight glossy face visor (`#0B1020`), expressive digital cyan LED eyes (`#00D4FF`), royal purple cape (`#6366F1`), illuminated triangular AI core emblem, and cyan hover levitation thrust glow (`#06B6D4`).
- **Production Asset Suite:** 23 standalone transparent RGBA PNG sprites under `frontend/public/mascot/` registered in `manifest.json`, including:
  - `mascot-idle.png`, `mascot-listening.png`, `mascot-thinking.png`, `mascot-speaking.png`, `mascot-planning.png`, `mascot-flying.png`, `mascot-navigating.png`, `mascot-working.png`, `mascot-validating.png`, `mascot-success.png`, `mascot-warning.png`, `mascot-error.png`, `mascot-paused.png`, `mascot-interrupted.png`, `mascot-offline.png`, `mascot-celebrate.png`, `mascot-compact.png`, `mascot-model-sheet.png`.
  - Turnaround angles: `turnaround-front.png`, `turnaround-front-three-quarter.png`, `turnaround-side.png`, `turnaround-rear-three-quarter.png`, `turnaround-back.png`.
- **Articulated Vector Rig Fallback (`OrbitVectorRig`):** If image loading is disabled or fails, Orbit gracefully renders as an articulated SVG vector rig matching the canonical character geometry.

### Voice-First Interaction
- **Press & Hold to Speak:** Hold Orbit or the microphone button in the operational HUD (`AgentOperationalHUD.tsx`) to speak; release to execute. Or tap to start/stop listening hands-free.
- **Global Hotkey:** `Cmd+J` or `Ctrl+J` activates voice recording from anywhere.
- **Instant Interruption:** Press `Escape` or the visible **Stop** / **Pause** buttons to immediately cancel in-flight tasks and prevent stale queued writes.
- **Secure Masked Inputs:** For sensitive database passwords or provider API keys, Orbit presents a masked form card (`SecureCredentialCard.tsx`) rather than prompting over audio.
- **Zero Raw SQL Guardrail:** Orbit executes actions only through authenticated, parameterized platform capabilities discovered dynamically from `AgentToolRegistry.php`.

### Verification Suite
Run the mascot and autonomous assistant test suite:
```bash
.venv/bin/python scripts/verify_orbit_mascot.py
```

