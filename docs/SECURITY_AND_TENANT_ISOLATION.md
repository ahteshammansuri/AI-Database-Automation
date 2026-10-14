# Security Model & Tenant Isolation Architecture

**Security Philosophy:** Zero Trust on AI Output, Zero Destructive SQL, Strict Multi-Tenant Scoping

---

## 1. Absolute Query Restrictions on Target Databases

Customer target databases connect via ephemeral PDO connections managed exclusively by `SafeDatabaseExecutor`.

### Prohibited Operations
Under no circumstances will the platform execute:
- `DELETE`
- `DROP`
- `TRUNCATE`
- `ALTER`
- `CREATE TABLE` / DDL
- `RENAME`
- `GRANT` / `REVOKE`
- Arbitrary SQL consoles or raw AI-generated SQL strings.

Every query passes through `DatabaseSafetyService::assertQueryIsSafe()` which uses AST and keyword token inspection to reject forbidden SQL verbs.

### Permitted Operations
Only two write operations are permitted:
1. Parameterized `INSERT` into allowlisted tables with sanitized, coerced column values.
2. Scoped, single-record parameterized `UPDATE` (`WHERE id = :target_record_id`) on allowlisted tables, with primary key and system column protections.

---

## 2. Table-Level Sensitivity & Four-Tier Classification

When schema is introspected by `SchemaIntrospectionService`, tables are classified into four distinct tiers:
1. **Recommended for Automation:** User content, blogs, products, articles, FAQs, metadata.
2. **Review Recommended:** Mixed-purpose tables or customer-facing tables requiring explicit operator confirmation.
3. **Restricted (Default Deny):** Tables containing authentication, tokens, passwords, sessions, permissions, financial data, cards, orders, wallets, or audit logs (e.g., `users`, `payments`, `sessions`, `password_resets`, `audit_logs`). These tables are strictly forbidden from automated writes.
4. **All Tables:** Complete read-only schema inventory.

---

## 3. Multi-Tenant Ownership & Isolation

- **Sanctum Authentication:** Authenticated sessions are bound to a verified `User` record.
- **Strict Query Scoping:** Every Eloquent query for connections, automations, executions, knowledge documents, and content versions includes `->where('user_id', $request->user()->id)`.
- **IDOR Defense:** Attempts to access or mutate another tenant's resource ID return `404 Not Found`. Cross-tenant IDOR attacks are verified and prevented by `TenantIsolationTest.php`.
- **Credential Encryption:** All customer database passwords and provider API keys are encrypted at rest using Laravel AES-256-CBC encryption (`Crypt::encryptString`) and never returned in plaintext to the frontend.
