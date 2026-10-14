# Local Demonstration Guide: AI-Powered Database Automation Platform

This guide walks through the complete end-to-end user journey for verifying the platform locally with zero paid API dependencies.

---

## Prerequisites & Environment
- **Python:** 3.12+ (Virtualenv in `.venv`)
- **Node.js:** v20+ / v24+
- **MySQL Target Database:** Running locally or via Docker on port `3308` (database: `demo_blog_cms`).

---

## Step-by-Step Verification Journey

### Step 1: Initialize Database & Run Backend
1. Activate virtual environment and ensure synthetic demo target database is seeded:
   ```bash
   source .venv/bin/activate
   python scripts/setup_synthetic_mysql.py
   ```
2. Start the FastAPI backend server:
   ```bash
   uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --reload
   ```
3. Verify backend health:
   ```bash
   curl http://localhost:8000/api/v1/health
   # Returns: {"status": "ok", "version": "1.0.0", "platform_db": "connected", ...}
   ```

### Step 2: Launch Modern React Dashboard
1. In a separate terminal, start the Vite development server:
   ```bash
   cd frontend
   npm run dev
   ```
2. Open your browser at `http://localhost:5173`.

---

### Step 3: Connect Target Database
1. Navigate to **Connections** in the sidebar.
2. Click **Connect Synthetic Demo DB** (or click **Add Connection** with host `127.0.0.1`, port `3308`, database `demo_blog_cms`, user `root`, password `ipo_root_password`).
3. Click **Test** on the connection card. Observe that the server returns `Connected successfully! (X ms)`.

---

### Step 4: Explore Introspected Schema & Safety Policies
1. Click **Schema** or navigate to **Schema Explorer** in the sidebar.
2. Select `Synthetic Demo Blog CMS`.
3. Notice discovered tables:
   - `posts`: Tagged as **ALLOWLISTED** (green). Inspect columns (`title`, `slug`, `excerpt`, `content`, `status`, `category_id`).
   - `categories`: Tagged as **ALLOWLISTED**.
   - `users`: Tagged as **RESTRICTED** (rose). Rationale: *"Contains sensitive credentials or auth data"*.
   - `payments`: Tagged as **RESTRICTED** (rose). Rationale: *"Contains financial data"*.
4. Inspect foreign key relationships showing `posts.category_id → categories.id` and `posts.author_id → users.id`.

---

### Step 5: Ingest Knowledge Base Document (RAG)
1. Navigate to **Knowledge Base**.
2. Upload a sample guidelines file (e.g. `docs/PROJECT_SPEC.md` or a markdown notes file) with title `"Brand Editorial Guidelines"`.
3. Observe document is chunked and indexed into the local FAISS vector store.
4. Test the **RAG Retrieval Diagnostic Tester** with query `"database security and publication"`. Inspect the retrieved semantic chunks and similarity scores.

---

### Step 6: Create & Trigger Blog Automation
1. Navigate to **Automations** and click **Seed Demo Automation** (or click **New Automation** to walk through the 5-step wizard).
2. Automation configuration:
   - Target table: `posts`
   - Mode: `AI_GENERATED`
   - Mapping: `title` (AI), `slug` (runtime slugify), `content` (AI), `category_id` (relationship lookup: "Engineering & Tech"), `author_id` (1), `status` ("published").
   - AI Provider: `mock` (or `ollama` if running locally).
3. Click **Run Now** on the automation card.
4. The backend:
   - Retrieves RAG context
   - Generates structured payload
   - Enforces Pydantic schema validation
   - Creates immutable `ContentVersion` in `PENDING_APPROVAL` status
   - Issues single-use HMAC tokens
   - Dispatches simulated approval preview email.

---

### Step 7: Review, Rejection & Versioned Regeneration
1. Navigate to **Approvals** (or open the approval URL link).
2. Inspect the generated draft article preview (Title, Excerpt, Content).
3. Test Rejection Loop:
   - Enter feedback: *"Make the tone more technical and emphasize transaction rollbacks."*
   - Click **Reject & Regenerate Version**.
4. Observe:
   - Original version is preserved as `REJECTED`.
   - Rejection feedback is added to context.
   - New version (`Version #2 (Revised Edition)`) is generated incorporating your feedback!

---

### Step 8: Approve & Publish to Target MySQL
1. On the revised version, click **Confirm Approval**.
2. Navigate to **Execution History**.
3. Click **Publish** on the approved run.
4. The backend:
   - Begins transaction on target MySQL database
   - Resolves foreign keys (`category_id` for 'Engineering & Tech')
   - Executes parameterized `INSERT INTO posts`
   - Links association table `post_tags`
   - Commits transaction atomically
   - Marks status as `PUBLISHED`.
5. Verify directly in MySQL:
   ```bash
   mysql -h 127.0.0.1 -P 3308 -u root -pipo_root_password -e "SELECT id, title, slug, status FROM demo_blog_cms.posts ORDER BY id DESC LIMIT 2;"
   ```

---

### Step 9: Zero-AI Manual Content Publishing
1. Navigate to **Manual Publishing**.
2. Supply custom title, slug, excerpt, and markdown content.
3. Click **Schedule Publication**.
4. Observe that the record is published directly to MySQL **without any AI provider or LLM model invocations**.

---

### Step 10: Non-Negotiable Database Safety Verification
1. Run the security guardrails test suite:
   ```bash
   pytest tests/test_security_guardrails.py -v
   ```
2. Observe 100% pass rate proving:
   - `DELETE`, `DROP`, `TRUNCATE`, `ALTER`, `CREATE` are unconditionally blocked.
   - Restricted tables (`users`, `payments`) cannot be targeted.
   - Non-allowlisted columns cannot be written.
   - Expired or consumed approval tokens cannot be replayed.
