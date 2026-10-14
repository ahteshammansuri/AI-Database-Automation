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

```bash
# 1. Laravel Tests
cd laravel && php artisan test

# 2. Python AI Service Tests
cd ai_service && pytest tests/ -v

# 3. Frontend Typecheck and Build
cd frontend && npm run build
```
