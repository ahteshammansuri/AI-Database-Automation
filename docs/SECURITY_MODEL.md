# Security Model: AI-Powered Database Automation Platform

## 1. Threat Model & Security Posture

The platform treats both user inputs and AI outputs as untrusted entities. Because users connect external relational databases and configure automated publishing pipelines, the architecture incorporates defense-in-depth controls at every boundary.

```mermaid
flowchart TD
    subgraph Boundary1 ["Boundary 1: Network & Connection"]
        SSRF["SSRF Interceptor (Blocks metadata 169.254.169.254, loopback in production)"]
        EncRest["At-Rest Encryption (Crypt::encryptString for DB passwords & API keys)"]
        EphemeralConn["Ephemeral PDO Instances (Cleaned in finally, zero global state leakage)"]
    end

    subgraph Boundary2 ["Boundary 2: Multi-Tenant Authorization"]
        SanctumAuth["Sanctum Token Authentication"]
        ScopeCheck["Strict Model Scoping (where user_id = auth->id)"]
        IDORDefense["IDOR Prevention on every Route & Action"]
    end

    subgraph Boundary3 ["Boundary 3: AI Output & Schema Validation"]
        JSONOnly["Structured JSON Only (Never Raw SQL)"]
        SchemaReval["Laravel Schema Validator (Types, Lengths, Enums, FKs, Unique Constraints)"]
    end

    subgraph Boundary4 ["Boundary 4: Target Database Execution"]
        BlockedTables["Default-Deny Policy (Blocked: users, auth, tokens, payments, orders, audits)"]
        AllowlistColumns["Strict Column Allowlist Verification"]
        ParamOnly["Parameterized INSERT & Scoped UPDATE Only"]
        ForbiddenSQL["Hard AST Interceptor (Blocks DELETE, DROP, TRUNCATE, ALTER, DDL)"]
        AtomicTx["Atomic Transactions with Rollback"]
    end
```

---

## 2. Dynamic Database Security

### 2.1 SSRF & Network Protections
- **Host Validation:** IP addresses and hostnames are validated.
- **Prohibited Destinations:** Hard blocks on AWS/GCP/Azure link-local metadata endpoints (`169.254.169.254`, `fd00::/8`).
- **Port Allowlist:** Restricts connections to standard relational database ports (e.g. 3306, 3307, 3308).
- **Environment Awareness:** Localhost and private subnet addresses (`127.0.0.1`, `192.168.x.x`, `10.x.x.x`) are permitted strictly when `APP_ENV=local` or `ALLOW_LOCAL_TARGET_CONNECTIONS=true`. In production environments, private subnets are blocked unless explicitly routed via an egress connector.

### 2.2 Credential Protection
- Stored credentials (passwords, cloud API keys) are encrypted using AES-256-CBC via Laravel's `Crypt::encryptString()`.
- API endpoints return only masked secrets (e.g. `********`).
- Passwords and connection strings are excluded from system logs and exception stack traces.

### 2.3 Ephemeral Scoped Connections
- Never modifies the global Laravel `config(['database.connections...'])` in a persistent manner.
- Creates temporary PDO connections per execution request and immediately closes them inside `finally` blocks.

---

## 3. Absolute Target Database Execution Guardrails

### 3.1 Hard Forbidden Operations
The platform will NEVER execute the following on customer target databases:
- `DELETE`
- `DROP`
- `TRUNCATE`
- `ALTER`
- `CREATE TABLE` / `CREATE DATABASE` / `CREATE VIEW`
- `RENAME`
- `GRANT` / `REVOKE`
- Arbitrary SQL console / Raw SQL execution

### 3.2 Allowed Operations
1. **Read-only Schema Introspection:**
   - Queries `information_schema.tables`, `information_schema.columns`, `information_schema.key_column_usage`, and `information_schema.table_constraints`.
2. **Parameterized `INSERT`:**
   - Into explicitly allowlisted, non-sensitive tables.
3. **Scoped `UPDATE`:**
   - Restricted to allowlisted fields on an explicitly verified primary key (`WHERE id = ?`). Mass updates (`UPDATE ...` without precise primary key condition) are rejected.

### 3.3 Default-Deny Sensitive Tables
Tables matching any of the following patterns are classified as **Restricted** and blocked from selection in the automation builder:
- Authentication & users: `users`, `user`, `accounts`, `auth`, `passwords`, `sessions`, `tokens`, `oauth`
- Permissions & roles: `roles`, `permissions`, `user_roles`
- Financial: `payments`, `transactions`, `billing`, `credit_cards`, `invoices`, `wallets`
- System & auditing: `audit_logs`, `logs`, `migrations`

---

## 4. Email Approval Security & Crawler Protection

### 4.1 Token Security
- Approval links utilize cryptographically signed tokens generated with HMAC-SHA256.
- Tokens expire after 24 hours and are strictly single-use.
- Bound to specific `automation_id`, `version_id`, and `user_id`.

### 4.2 Crawler Neutralization
- To prevent enterprise email filters (such as Microsoft Defender and Google Workspace) from automatically clicking links and approving content, email links navigate to a confirmation page:
  `http://localhost:5173/approvals/{token}`
- The user must explicitly view the draft preview and click **Approve** or **Reject**, submitting an HTTP `POST` request.

---

## Orbit agent security

- **Identity:** the user, workspace and every resource ID are checked server-side (`ToolPolicyGate`) right before each side effect. A model-supplied ID that belongs to another user returns `NOT_FOUND`.
- **Only registered tools:** the model's tool name is constrained to the available registry (schema enum) and re-validated. Arguments are validated against the same schema (types, enums, no extra properties). No tool runs SQL, DDL or deletes against customer databases.
- **Secrets:** passwords and API keys go to `SecretVault` (`agent_secure_inputs`, encrypted cast, per task and user, 30-minute TTL, consumed after a verified save). They come from the masked field, or are redacted out of utterances by both the browser and the server. They are injected into tool arguments only at execution time and scrubbed from tool output. They never appear in task plans or slots, messages, tool-call records, UI actions, timeline, live events or model requests; `AgentAutonomousActionTest::assertSecretNowhere` checks this.
- **Confirmation:** `always_confirm` tools (profile/automation/document removal, published-record edits) always wait for an explicit user confirmation. A spoken "yes" counts only for the exact pending call and only after Orbit asked.
- **Retrieved content is untrusted:** RAG passages and database text are delimited as reference data in the model request and cannot change policy. Retrieval is limited to product docs plus the requesting user's own partition.
- **Browser actions** are allowlisted (`UiActionCoordinator::ALLOWED_ACTIONS`, registered routes only). The model cannot send code or selectors. Visible "press" actions never call the API themselves.
