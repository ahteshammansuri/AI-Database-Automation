# Security Review — Multi-User AI Database Automation Platform

**Date:** October 9, 2026  
**Auditor:** Principal Security & Cloud Architecture Specialist  
**Security Level:** High (Multi-Tenant & External Database Integration)  

---

## 1. Threat Modeling & Attack Surface

The platform connects to user-supplied customer database instances and processes untrusted AI output. This presents four primary threat vectors:

1. **Server-Side Request Forgery (SSRF) & Internal Network Scanning:**
   - *Threat:* Malicious tenant provides cloud metadata IP (`169.254.169.254`), internal Docker daemon (`2375`), or local infrastructure ports (SSH, Consul, Redis) as their database host.
   - *Mitigation:* `DatabaseSafetyService.validateConnectionTarget()` blocks metadata IPs (`169.254.169.254`, `0.0.0.0`), restricts dangerous ports (22, 23, 25, 110, 143, 6379, 8500), and validates port ranges (1–65535). Local development localhost connections are permitted only under explicitly verified flags.

2. **Insecure Direct Object Reference (IDOR) & Tenant Cross-Access:**
   - *Threat:* User A accesses, mutates, or runs automations on User B's connection profile by manipulating resource IDs in API requests.
   - *Mitigation:* Strict server-side ownership enforcement in Laravel Eloquent queries:
     ```php
     $connection = DbConnection::where('user_id', $request->user()->id)->where('id', $id)->firstOrFail();
     ```
     Background queue jobs carry tenant identity and re-verify ownership before executing. All automated cross-user tests assert 404/403 responses.

3. **Arbitrary SQL Execution & SQL Injection:**
   - *Threat:* Malicious payload or AI hallucination introduces SQL injection or destructive DDL (`DROP TABLE`, `DELETE FROM users`).
   - *Mitigation:*
     - The AI service has zero direct database connectivity.
     - Laravel uses exclusively parameterized PDO `INSERT` and scoped `UPDATE` statements.
     - Hard AST safety interceptor detects forbidden SQL keywords (`DELETE`, `DROP`, `TRUNCATE`, `ALTER`, `CREATE`, `RENAME`, `GRANT`, `REVOKE`, `EXEC`, `CALL`) and throws immediate fatal exceptions.
     - Sensitive tables (`users`, `payments`, `credentials`, `sessions`, `tokens`, `audit_logs`) are hard-restricted by code.

4. **Crawler Auto-Approval Exploitation:**
   - *Threat:* Automated email security crawlers (Microsoft Defender, Google Safe Browsing) scan links in notification emails and prematurely trigger approval on HTTP `GET`.
   - *Mitigation:* Email links route to an interactive frontend review portal (`/approvals/:token`). Approval requires an explicit HTTP `POST` submission with an expiring, single-use, cryptographically secure token.

5. **Secrets at Rest & in Flight:**
   - *Threat:* Stolen database passwords or provider API keys.
   - *Mitigation:*
     - Stored using Laravel's managed encryption (`Crypt::encryptString`) backed by `APP_KEY`.
     - Secrets are never returned to the frontend after saving (only masked status like `sk-...8921` is shown).
     - Transmission from Laravel to the private Python AI microservice occurs over internal service channels in-memory and is never logged.

---

## 2. Hard Security Invariants

| Invariant | Enforcement Mechanism | Verification Method | Status |
| :--- | :--- | :--- | :--- |
| **No Destructive SQL** | Code-level parameterized builder + AST regex regex scan | `DatabaseSafetyTest::test_forbidden_sql_statements_are_intercepted` | **Enforced** |
| **No Unscoped Updates** | Requires primary key column and value in `executeScopedUpdate` | `SafeExecutorTest` | **Enforced** |
| **Sensitive Table Lock** | Deterministic token matching in `isTableSensitive()` | `DatabaseSafetyTest::test_sensitive_tables_are_classified_as_restricted` | **Enforced** |
| **SSRF Prevention** | `validateConnectionTarget()` IP & port blocklist | `DatabaseSafetyTest::test_ssrf_metadata_ip_is_blocked` | **Enforced** |
| **Tenant Isolation** | Scoped queries `where('user_id', auth()->id())` | `TenantIsolationTest::test_cross_user_connection_access_is_blocked` | **Enforced** |
| **Single-Use Approval** | `used_at` timestamp timestamp check + token invalidation | `ApprovalFlowTest::test_approval_review_and_single_use_token_lifecycle` | **Enforced** |
| **Credential Encryption** | Laravel `Crypt::encryptString` cast | Verified in MySQL raw column inspection (`encrypted_password`) | **Enforced** |
