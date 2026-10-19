# AI-Powered Multi-User Database Automation Platform
### With Autonomous Voice-First AI Operator (Orbit)

[![Docker Ready](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)](docker-compose.yml)
[![Laravel 11](https://img.shields.io/badge/Laravel-11.x-FF2D20?logo=laravel&logoColor=white)](laravel/)
[![Python FastAPI](https://img.shields.io/badge/FastAPI-3.12-009688?logo=fastapi&logoColor=white)](ai_service/)
[![React 19](https://img.shields.io/badge/React-19_TypeScript-61DAFB?logo=react&logoColor=black)](frontend/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

A production-grade, self-service web application where users register, connect their own MySQL databases through an authenticated portal, inspect discovered schema, configure their own AI provider credentials (local Ollama or cloud LLMs), author RAG business context, and execute safe automated content pipelines with durable background workers and human-in-the-loop email approvals.

The platform includes **Orbit**, a voice-first companion that operates the portal on your behalf. Your configured model chooses real registered tools, Laravel runs and verifies them, and Orbit reports what actually happened.

---

## Table of Contents
1. [System Architecture](#1-system-architecture)
2. [Quickstart with Docker (Zero Host Dependencies)](#2-quickstart-with-docker-recommended)
3. [Bare-Metal Local Setup (Manual Setup)](#3-bare-metal-local-setup)
4. [Step-by-Step User Journey & Verification](#4-step-by-step-user-journey--verification)
5. [Orbit — Voice-First Website Operator](#5-orbit--voice-first-website-operator)
6. [Core Security & Guardrails](#6-core-security--guardrails)
7. [Automated Test Suites](#7-automated-test-suites)
8. [Configuration & Environment Reference](#8-configuration--environment-reference)

---

## 1. System Architecture

The application is engineered into three cleanly decoupled tiers, supervised by background workers and isolated by tenant security boundaries:

```
+---------------------------------------------------------------------------------------+
|                       React 19 + TypeScript Frontend (Port 5173)                       |
|   - Public Landing / Service Page            - Self-service Registration & Login       |
|   - Empty Onboarding Workspace Flow          - Dynamic MySQL Connection Manager        |
|   - Real-time Schema & Security Explorer     - Automation Pipeline Wizard              |
|   - Content Versioning & Audit Logs          - Single-Use Email Approval Reviewer      |
|   - Orbit: Animated Voice-First Operator     - Sound Effects & Sub-second HUD Controls |
+------------------------------------------+--------------------------------------------+
                                           | REST API (Sanctum Tokens)
                                           v
+---------------------------------------------------------------------------------------+
|                     Laravel 11 Control Plane Backend (Port 8000)                      |
|   - Multi-Tenant Authentication & Scoped Authorization Policies                       |
|   - AES-256 Encrypted Customer DB Credentials & Provider Keys at Rest                 |
|   - Read-only Dynamic Schema Introspection (Tables, Columns, Enums, Foreign Keys)      |
|   - Deterministic 4-Tier Sensitive Table Classifier (Restricts users, payments, auth)  |
|   - Hard AST SQL Interceptor (Rejects DELETE, DROP, TRUNCATE, ALTER, DDL)             |
|   - Safe Parameterized Target Executor (INSERT & Primary-Key Scoped UPDATE Only)      |
|   - Supervised Queue Worker (`queue:work`) & Background Scheduler (`schedule:work`)    |
|   - Signed Single-Use Approval Token & Mail Delivery Engine                           |
|   - Agent Tool Registry & Orbit Observe-Act Loop (queued, verified)                     |
+------------------------------------------+--------------------------------------------+
                                           | Internal HTTP (X-Service-Token)
                                           v
+---------------------------------------------------------------------------------------+
|                      Python 3.12 FastAPI AI Service (Port 8001)                       |
|   - Local Ollama Adapter (http://localhost:11434 / host.docker.internal:11434)        |
|   - High-Fidelity Mock Provider (Deterministic Instant Generation / Offline Testing)  |
|   - Optional Cloud Adapters (OpenAI, Gemini, Anthropic Claude)                        |
|   - Document Ingestion: Markdown (.md), Plain Text (.txt), and PDF (PyMuPDF)          |
|   - Overlapping Sliding Chunks, Dense Vector Embeddings, FAISS Vector Search Index    |
|   - Sub-second Agent Planner with Deterministic Fallback & Structured Schema Repair    |
+---------------------------------------------------------------------------------------+
```

---

## 2. Quickstart with Docker (Recommended)

Docker is the **recommended, zero-dependency path**. You do **not** need to install PHP, Composer, Python, Node.js, or MySQL on your host machine. Docker orchestrates all 7 services in isolated containers.

### Prerequisites
- [Docker Engine](https://docs.docker.com/engine/install/) (v24.0+)
- [Docker Compose](https://docs.docker.com/compose/install/) (v2.20+)

### Start the Platform
Clone the repository and run:

```bash
# 1. Clone the repository
git clone https://github.com/ahteshammansuri/AI-Database-Automation.git
cd AI-Database-Automation

# 2. Start all services in Docker (builds containers and starts background services)
docker compose up --build
```

*(To run in detached background mode, add `-d`: `docker compose up --build -d`)*

### What Happens Automatically on Startup:
1. **Frontend:** Builds Node 20 container, runs Vite on port `5173`, and proxies `/api` calls to Laravel.
2. **Laravel Control Plane:** Builds PHP 8.3 container, installs Composer dependencies, initializes `.env`, generates `APP_KEY`, creates SQLite database, runs all migrations, and serves the API on port `8000`.
3. **Queue Worker:** Starts supervised background worker processing jobs (`php artisan queue:work`).
4. **Scheduler:** Starts background cron runner (`php artisan schedule:work`).
5. **Python AI Service:** Builds Python 3.12 container, installs requirements (FastAPI, PyMuPDF, FAISS), and serves on port `8001`.
6. **Synthetic Demo MySQL:** Boots MySQL 8.0 on port `3309` (mapped internally to 3306), executes `scripts/docker-init-db/init.sql`, and creates demo tables (`posts`, `categories`, `tags`, `post_tags`, `users`, `payments`).
7. **Mailpit:** Runs local SMTP server on port `1025` and web inbox UI on port `8025`.

### Service URLs & Ports

| Service | Access URL | Description |
| :--- | :--- | :--- |
| **Web Portal & UI** | [http://localhost:5173](http://localhost:5173) | Main application frontend with Orbit Mascot |
| **Laravel REST API** | [http://localhost:8000](http://localhost:8000) | Control plane API & health endpoints (`/up`) |
| **Python AI Service** | [http://localhost:8001](http://localhost:8001) | AI OpenAPI Swagger docs at `/docs`, health at `/health` |
| **Mailpit Email UI** | [http://localhost:8025](http://localhost:8025) | Local inbox to preview generated approval emails |
| **Synthetic Demo MySQL** | `localhost:3309` | Target database for tests & automations (see credentials below) |

#### Demo Database Credentials (Pre-seeded in Docker):
- **Host:** `demo-mysql` (when connecting from inside Docker) or `127.0.0.1` (from host machine)
- **Port:** `3306` (from inside Docker network) or `3309` (from host machine)
- **Database:** `demo_blog_cms`
- **Username:** `ipo_user`
- **Password:** `ipo_password`

### Stopping the Docker Services
```bash
docker compose down
```
*(To also remove volume data: `docker compose down -v`)*

---

## 3. Bare-Metal Local Setup

If you prefer to run the components directly on your host machine without Docker:

### Prerequisites
- **PHP 8.2 or 8.3** with extensions: `pdo_mysql`, `pdo_sqlite`, `curl`, `mbstring`, `openssl`, `bcmath`, `xml`
- **Composer 2.x**
- **Python 3.10+** (Python 3.12 recommended)
- **Node.js 18+** & **npm**
- **MySQL 8.0** (or Docker MySQL on port 3308/3309)
- **Ollama** installed locally, with `qwen2.5:3b` and `nomic-embed-text` pulled (see section 5); optional cloud providers use your own API key

### Step 1: Environment Configuration
```bash
# Root environment
cp .env.example .env

# Laravel environment
cp laravel/.env.example laravel/.env
```

### Step 2: Python AI Microservice Setup
```bash
# Create Python virtual environment
python3 -m venv .venv
source .venv/bin/activate

# Install AI dependencies (FastAPI, PyMuPDF, FAISS, Pytest)
pip install -r ai_service/requirements.txt
```

### Step 3: Laravel Control Plane Setup
```bash
cd laravel

# Install PHP dependencies
composer install

# Generate application encryption key
php artisan key:generate

# Run platform database migrations (SQLite or MySQL)
php artisan migrate

cd ..
```

### Step 4: React Frontend Setup
```bash
cd frontend

# Install Node dependencies
npm install

cd ..
```

### Step 5: Start All Services (Single Command)
Run the supervised root startup script:
```bash
./run_all.sh
```

This single command launches:
1. Python AI Service on `http://127.0.0.1:8001`
2. Laravel Control Plane on `http://127.0.0.1:8000` (8 workers)
3. Laravel Supervised Queue Worker (`php artisan queue:work --queue=default`)
4. Orbit Agent Worker (`php artisan queue:work --queue=agent --timeout=700`)
5. Laravel Background Scheduler (`php artisan schedule:work`)
6. React Frontend on `http://localhost:5173`

Press `Ctrl+C` to gracefully terminate all services.

---

## 4. Step-by-Step User Journey & Verification

Follow this end-to-end walkthrough on a clean installation:

### Step 1: Self-Service Registration
1. Navigate to [http://localhost:5173](http://localhost:5173).
2. Click **Get Started** or **Register**.
3. Register a new account (`name`, `email`, `password`).
4. An isolated tenant workspace is provisioned automatically. You are redirected to your empty onboarding dashboard.

### Step 2: Connect a Target Database
1. In the sidebar or dashboard banner, click **Database Connections** -> **New Connection**.
2. Fill in the connection form:
   - **Connection Name:** `Demo Blog CMS`
   - **Host:** `demo-mysql` (if using Docker) or `127.0.0.1` (bare-metal)
   - **Port:** `3306` (inside Docker) or `3309` (from host)
   - **Database Name:** `demo_blog_cms`
   - **Username:** `ipo_user`
   - **Password:** `ipo_password`
3. Click **Test Connection**. The backend verifies connectivity and SSRF boundaries.
4. Click **Save Connection**. Credentials are encrypted at rest with AES-256.

### Step 3: Real-Time Schema Explorer
1. Navigate to **Schema Explorer** (`/explorer`).
2. Select your newly added connection.
3. Observe real-time introspection:
   - `users` and `payments` are flagged with a red badge: **RESTRICTED** (Default-deny security policy).
   - `categories` and `tags` are marked **ELIGIBLE (REFERENCE)**.
   - `posts` is marked with a green badge: **RECOMMENDED (PRIMARY TARGET)**.

### Step 4: Configure AI Provider & Knowledge Base
1. Navigate to **AI Providers** (`/ai-providers`).
2. Select **Local Ollama** (default, no paid API needed) or **Mock Provider** (instant deterministic generation for testing).
3. *(Optional)* Navigate to **Knowledge Base** (`/knowledge`) and upload `.md`, `.txt`, or `.pdf` technical guidelines to index into the FAISS vector store.

### Step 5: Create an automation (any table: posts, articles, news, products, FAQs)
1. Open **New Automation** (`/automations/new`), pick a template or describe it in words, then choose the connection and the table to write into.
2. **Fields**: every column is read from your live database and gets a safe default with a plain-English explanation:
   - text columns (title, summary, body, SEO fields) → *AI writes it*;
   - foreign keys (e.g. `category_id → categories`) → *AI picks a category (creates it if new)*: the parent row is created first, with all of its required columns filled, then the new row stores its id, in one transaction. Protected parents such as `users` are only ever linked to an existing record you choose;
   - image columns (banner, cover, thumbnail, og/meta image) → *Generate an image* from the generated title and summary;
   - slug → built from the title and made unique; publish/created dates → the publication time; status → a fixed value.
3. **AI & content**: topic, tone, length, Markdown or HTML, image source, model, optional knowledge documents.
4. **Schedule**: one time, daily or weekly; timezone; start date and optional *run until* date; weekdays for weekly; generation time and publication time (at least 15 minutes later). The calendar shows this schedule's run days next to your other automations; the summary shows the next runs.
5. **Preview & save**: *Generate sample preview* runs the real pipeline (text, parent decisions, images, exact database write plan) without writing anything. Then **Save and schedule**.

### Step 6: Review email, approval and publishing
1. At generation time the background worker writes the content (your browser can be closed).
2. If approval is on, the reviewer gets an HTML email with the rendered article and images, the exact database steps (e.g. *1. Create category "Cloud Databases" · 2. Insert into posts*), the publication time in the automation's timezone, and what happens without a decision.
3. **Review and approve** / **Request changes** open a secure page where one click decides. Requesting changes regenerates a new version with your notes (up to 3 times).
4. At publication time the approved version is written in one transaction. Check the run in **Execution history** (rendered content, write plan, timeline) and **Audit Logs**.

Images: with an OpenAI or Gemini key saved on **AI Providers**, images are AI-generated with that key. Without a key, a designed cover (title + category, colours from the topic) is created locally for free. Set `MEDIA_PUBLIC_URL` so the stored image URLs are reachable by your website.

---

## 5. Orbit — Voice-First Website Operator

Orbit is the articulated companion in the bottom-right corner of the signed-in portal. It is an agent, not a script:

1. Every request you speak (or type) goes to **your configured model**, together with live context: current page and form, your connections, the current task, recent conversation, and relevant passages from the product guide and your knowledge base.
2. The model picks a **real registered tool**. Laravel checks it (ownership, arguments, confirmation policy), runs it, verifies the result, and sends the result back to the model, which decides the next step.
3. Orbit **visibly operates the page**: it flies to the real button or field, types values visibly through the page's own inputs, picks options and presses controls. It then speaks only what actually happened.
4. Product knowledge comes from retrieval (embeddings + FAISS) over the guides in [`docs/orbit-agent/`](docs/orbit-agent/) (product overview, automations, security, portal tour) and your own knowledge base, not from hard-coded answers.

How it is built: [`docs/orbit-agent/ARCHITECTURE.md`](docs/orbit-agent/ARCHITECTURE.md). The pre-upgrade audit: [`docs/orbit-agent/CURRENT_STATE_AUDIT.md`](docs/orbit-agent/CURRENT_STATE_AUDIT.md).

### Required local models (no paid API)

```bash
ollama pull qwen2.5:3b         # drives Orbit (choose it under AI Providers → Model Roles → Agent Planner)
ollama pull nomic-embed-text   # embeddings for knowledge retrieval (without it, retrieval falls back to lexical matching)
```

On CPU-only machines a single model decision can take **20–90 s**, and longer under heavy load, so a multi-step task can take minutes. The work runs on a background queue, so you can keep using the portal or close the tab. Timeouts are configurable in `laravel/config/orbit.php`.

### Using Orbit
- **Talk:** hold Orbit (or the mic button) and speak; release to send. Or tap to start and stop. `Ctrl/Cmd+J` toggles listening. Speaking again interrupts Orbit's reply.
- **It does the work on screen.** Ask "connect my database", "create a daily blog automation", "approve the pending draft" or "how do I add an OpenAI key?". Orbit goes to the page, opens the form, fills what it knows, asks only for what's missing, picks options from the real dropdowns, and presses the real buttons, while you watch. One long request is enough: Orbit keeps every detail you gave (names, table, topic, dates, times, timezone, emails) and fills multi-step forms such as the five-step Automation Builder step by step, including how each column is filled.
- **Validation:** when a field is rejected, Orbit says which field and why, and asks for a correction.
- **Confirmations:** changes that matter (running, approving, publishing, editing records) wait for your OK. Removals and cancellations (a connection, an automation, a knowledge document, a run) are confirmed **only with the Confirm button in Orbit's panel**, never by a typed or spoken "yes". After you confirm, Orbit presses the page's own button and then clicks the page's own confirmation popup in front of you.
- **Speech bubble:** while the panel is closed, a small bubble next to Orbit shows what it is doing, the question it is waiting on, a pending confirmation ("Open to confirm"), or a short version of its answer.
- **Questions about your data, in any language:** "Aisa kaun sa customer hai jismein sabse zyada order kiye ho?" or "how many orders were refunded this month?". Orbit writes one read-only query with your model, a safety gate checks it against your live schema (no secret columns, no writes, forced limits), and the answer comes from the real rows — ties are named, emails and phones stay masked. If it cannot answer safely it says why instead of guessing.
- **Questions and tours:** ask about security, your audit log ("did I ever delete a connection?"), runs, approvals, providers or knowledge documents; Orbit answers from real tool results and the product guides. Ask "show me around" for a guided tour from page to page.
- **Passwords and API keys:** Orbit points at the form's own password/key box and you type it there yourself. Press Enter or "Continue with Orbit". The value goes only from that form to the portal's API; it never reaches the AI model, the chat or the logs.
- **Type instead:** a small toggle in the panel, for accessibility or when voice is unavailable.
- **Stop / Pause / Resume** control a running task. No new step starts after Stop; anything already committed is reported as committed.
- **Memory:** Orbit remembers what you said earlier in the conversation, such as the connection name and earlier answers.
- **Character:** Orbit is an articulated vector character whose poses follow what is really happening (flying to a target, tapping, typing, thinking, celebrating only after a verified result). At rest it blinks, glances around, tilts its head and reacts when you rest the pointer on it. A 3D renderer exists as an option (`renderer="3d"`).
- **Voice privacy:** browser speech recognition in Chrome/Edge may send audio to the browser vendor. Orbit tells you this the first time you use it.

### Required background worker
Orbit's turns run on a dedicated `agent` queue connection (long multi-step turns up to 25 minutes); `./run_all.sh` starts the workers (restart it after updating):
```bash
php artisan queue:work agent --queue=agent --sleep=1 --tries=1 --timeout=1600
```

---

## 6. Core Security & Guardrails

The application enforces strict non-negotiable security rules:

1. **Zero Destructive Queries:**
   The backend AST interceptor permanently blocks `DELETE`, `DROP`, `TRUNCATE`, `ALTER`, `CREATE TABLE`, `RENAME`, `GRANT`, `REVOKE`, and arbitrary raw SQL execution.
2. **Allowed Operations Only:**
   The target executor permits **read-only metadata introspection**, parameterized allowlisted `INSERT`, and primary-key scoped `UPDATE` queries exclusively.
3. **Sensitive Table Auto-Deny:**
   Tables matching patterns like `users`, `auth`, `passwords`, `tokens`, `payments`, `billing`, and `audit_logs` are classified as restricted by default.
4. **Encrypted Credentials at Rest:**
   Database passwords and provider API keys are encrypted at rest with AES-256 (`Crypt::encryptString`) and masked in all UI responses (`********`).
5. **SSRF Defense:**
   Rejects connections to cloud metadata endpoints (`169.254.169.254`) and unauthorized infrastructure ports.
6. **Multi-Tenant Ownership Isolation:**
   All connections, automations, executions, knowledge sources, and logs are strictly scoped to the authenticated user ID. Cross-user IDOR access returns `404 Not Found`.

---

## 7. Automated Test Suites

The codebase includes comprehensive test suites across all tiers:

### 1. Laravel Control Plane Test Suite
Tests authentication, cross-user IDOR isolation, SSRF prevention, sensitive table auto-classification, forbidden SQL interceptor, live MySQL target execution, and signed approval token lifecycle:
```bash
cd laravel
php artisan test
```
*Result: 46 passed, 589 assertions.*

### 2. Python AI Service Test Suite
Tests service token authentication, Mock provider generation, Ollama error handling, PyMuPDF parsing, and FAISS RAG vector indexing/retrieval:
```bash
source .venv/bin/activate
pytest ai_service/tests/ -v
```
*Result: 10 passed.*

### 3. Frontend Type Check & Production Build
Tests TypeScript strict compilation and Vite client asset bundling:
```bash
cd frontend
npm run build
```
*Result: 0 errors.*

### 4. End-to-End Vertical Slice Integration Test
Simulates complete real-world tenant journey (registration -> empty dashboard -> target MySQL connect -> schema scan -> automation creation -> queue generation -> signed email approval -> target database write verification -> cross-tenant IDOR defense):
```bash
python scripts/verify_end_to_end.py
```

### 5. Orbit Mascot & Autonomous Operator Verification
Validates mascot sprite assets, vector rig fallback, sound effects, HUD interaction, and capability registration:
```bash
python scripts/verify_orbit_mascot.py
```

---

## 8. Configuration & Environment Reference

### Key Environment Variables (`.env` and `laravel/.env`)

| Variable | Default (Local) | Default (Docker) | Purpose |
| :--- | :--- | :--- | :--- |
| `DB_CONNECTION` | `sqlite` or `mysql` | `sqlite` | Platform database driver |
| `DB_DATABASE` | `database/database.sqlite` | `/app/database/database.sqlite` | Platform database file / name |
| `AI_SERVICE_URL` | `http://127.0.0.1:8001` | `http://ai-service:8001` | URL of the internal Python AI microservice |
| `AI_SERVICE_KEY` | *(Shared Secret)* | *(Shared Secret)* | Header token (`X-Service-Token`) for service auth |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | `http://host.docker.internal:11434` | Ollama local inference endpoint |
| `MAIL_MAILER` | `smtp` | `smtp` | Transport driver for approval emails |
| `MAIL_HOST` | `127.0.0.1` | `mailpit` | Mailpit host |
| `MAIL_PORT` | `1025` | `1025` | Mailpit SMTP port |
| `DEMO_MYSQL_PORT` | `3308` | `3309` | Exposed host port for the synthetic demo MySQL target |
| `VITE_BACKEND_URL` | `http://localhost:8000` | `http://laravel:8000` | Target URL for Vite `/api` reverse proxy |
| `MEDIA_PUBLIC_URL` | `http://127.0.0.1:8000` (set by `run_all.sh`) | your public API host | Base URL for generated/uploaded images stored in `storage/app/public` (`php artisan storage:link`) |
| `FRONTEND_URL` | `http://localhost:5173` | your portal URL | Used for the review links in approval emails |

---

## License

This project is licensed under the [MIT License](LICENSE).
