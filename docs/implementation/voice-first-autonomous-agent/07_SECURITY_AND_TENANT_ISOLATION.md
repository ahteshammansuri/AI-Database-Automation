# Security & Tenant Isolation Specification

## 1. Absolute Database Safety Policy
The agent strictly adheres to platform security rules:
- **Zero Raw SQL Execution**: The agent cannot run arbitrary SQL, AI-generated SQL, or use a raw SQL console.
- **Forbidden DDL & Destruction**:
  - `DELETE`, `DROP`, `TRUNCATE`, `ALTER`, `CREATE TABLE`, `RENAME`, `GRANT`, `REVOKE` are blocked deterministically in `DatabaseSafetyService.php` and `AgentToolRegistry.php`.
  - No prompt injection or LLM output can bypass these hard limits.
- **Restricted Tables Default-Deny**:
  - Sensitive tables (`users`, `passwords`, `tokens`, `sessions`, `permissions`, `payments`, `orders`, `wallets`, `audit_logs`) are automatically classified as `RESTRICTED`.
  - The agent is prevented from generating writes or viewing sensitive credential records.

## 2. Multi-Tenant Scoping & IDOR Prevention
- Every database connection, automation, generated version, approval token, execution, knowledge document, and agent conversation is strictly scoped to the authenticated user ID (`user_id`).
- All tool execution handlers verify tenant ownership prior to reading or mutating records:
  ```php
  $connection = DbConnection::where('user_id', $user->id)->findOrFail($connectionId);
  ```
- Submitting an arbitrary ID belonging to another user returns a strict `403 Forbidden` or `404 Not Found`.

## 3. Secret Protection at Rest & In Flight
- **Encryption at Rest**:
  - Target database passwords and AI provider API keys are encrypted with AES-256 via Laravel encrypted casts (`Crypt::encryptString`).
  - Stored secrets are NEVER returned plaintext to the frontend or included in logs.
- **Masking & UI Display**:
  - Passwords and API keys appear only as masked tokens (`••••••••••••`).
- **Voice & Speech Redaction**:
  - Plaintext passwords and API keys are NEVER spoken aloud via TTS.
  - Plaintext passwords are NEVER stored in task goals, transcripts, or execution timeline event messages.
  - Dedicated `SecureCredentialCard` collects secrets directly via masked password inputs.

## 4. SSRF & Network Protection
- Connection hosts are validated before network calls.
- Private cloud metadata endpoints (`169.254.169.254`, `metadata.google.internal`) and AWS IMDSv2 addresses are strictly blocked.
- Port numbers are constrained to standard database ports (default 3306).
