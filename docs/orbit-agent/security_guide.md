# Security — what the platform enforces

Product knowledge for Orbit's retrieval. Every rule here is enforced by the Laravel backend, not by the AI model. The Security & Guardrails page (`/security`) shows the same rules.

## Never possible

No prompt, setting or request can run these against a connected database: DROP, TRUNCATE, ALTER, CREATE, RENAME, GRANT, REVOKE or any other DDL; a raw SQL console; AI-written SQL for writes. Orbit has no tool for them and says so plainly.

## Reads

A question about the data (in any language) is answered with ONE SELECT written by the user's own model from the live schema. Before it runs, the read gate checks it: a single SELECT statement, only readable tables, only allow-listed functions, every column resolved against the live schema (secret columns are not even shown to the model, so they cannot be referenced), joins that would inflate counts or sums are corrected or refused, a plain list that joins an unused child table (repeating rows) is refused, and a LIMIT is forced. The query is also compared with the question's own words: a filter the question never mentions, or a ranking question answered without ranking, gets one rewrite; if a filter stays, the answer says exactly which rows were counted. It then runs in a read-only transaction with a statement timeout. If the gate or the database rejects it, the model gets the exact error and may correct it (at most three attempts); if it still cannot be answered, Orbit says so — it never shows a different query's result instead. Blocked tables cannot be read. Every read is written to the audit log, including whether personal data was unmasked. Orbit itself cannot unmask personal data; only the user can, in the data assistant.

## Access mode (data assistant)

Each connection has an access mode set by its owner; the default is read-only.

- **Read only** — the data assistant only reads.
- **Read & write** — also row UPDATEs: a before → after preview of the exact rows, the user's confirmation, and the update is pinned to the previewed primary keys (an unscoped update is impossible). An executed change can be undone from its saved, encrypted before-image.
- **Read, write & delete** — also row DELETEs: impact analysis first, then the user types the exact phrase shown (voice alone is not accepted); it runs in a transaction, the deleted rows are saved first (encrypted) so it can be undone, and it is audited.

The access mode governs the data assistant. Automations and Manual Publishing are separate: they only insert the new rows the user configured, into eligible tables, and they need INSERT permission on those tables.

## Sensitive tables

- **Always blocked** for the data assistant: credential, token and session tables (names like tokens, sessions, password_resets, personal_access_tokens, oauth_*, credentials). No setting opens them.
- **Read-only by default** for the data assistant: payments, invoices, transactions, financial*, roles, permissions, user_roles and audit_* tables. The connection owner can change this per table.
- **Never written by automations or Manual Publishing:** tables whose name is, or contains as a whole word (split on `_`, `-` or spaces), user(s), account(s), auth, password(s), credential(s), session(s), token(s), oauth, role(s), permission(s), payment(s), transaction(s), billing, invoice(s), wallet(s), financial, audit(s), log(s) or migration(s); also `credit_card(s)` and `audit_log(s)` as full names. So `user_profiles` is restricted, but `blog_posts` and `blog_categories` are not.

## Sensitive columns

- **Secret columns** (password hashes, tokens, API keys, card numbers, national IDs and similar) are never returned, never sent to an AI model and never written.
- **Personal data** (emails, phone numbers) is masked in results unless the owner reveals it; the reveal is recorded in the audit log.

## Stored secrets

Database passwords and AI provider API keys are encrypted at rest and never sent back to the browser after saving. Orbit never types, reads or repeats them: it points at the real password or key box and the user types it there. Secrets typed into chat by mistake are redacted before anything is stored or sent to a model.

## Connection test guard

Connection tests, saving, schema scans, reads and writes all refuse the cloud metadata address (169.254.169.254), 0.0.0.0, and well-known non-database ports: SSH (22), Telnet (23), SMTP (25), POP3 (110), IMAP (143), Docker (2375, 2376), etcd (2379), Redis (6379), Kubernetes API (6443), Consul (8500), Elasticsearch (9200) and Memcached (11211).

## Writes by automations

Rows are inserted with parameterized statements inside one transaction, after the AI output has been validated against the live table: required fields, types, lengths, allowed values, uniqueness and relationships. AI output is treated as untrusted. Linked parent rows are created first in the same transaction only when allowed. Each scheduled occurrence gets one idempotency key, so it creates one run, and the insert itself is keyed so a retried publish does not write the row twice.

## Email approval links

Each link carries a random 48-character token for one draft version. It works once and expires after 24 hours. Opening it shows the preview only; approving or rejecting needs an explicit button press. The portal itself never receives these tokens.

## Ownership

Every connection, automation, run, approval, document and provider key belongs to one user. Ownership is checked on the server for every request and again inside background jobs; another user's id is treated as not found.

## Orbit's own limits

- The backend decides what Orbit may do, never the model.
- Consequential steps need the user's confirmation. Removals and cancellations need the Confirm button in Orbit's panel; a typed or spoken "yes" does not count for them. Then Orbit presses the page's own button and confirmation popup in front of the user.
- Orbit reports only verified results and says when it is not sure.

## Audit log

Security-relevant actions are recorded per user: connections created, tested, changed or removed; schema scans; automations created, changed, deleted, run; previews; approvals, rejections and publications; data reads and changes; refused attempts. Orbit can search it by words, action, resource and date range, with totals and first/last time.
