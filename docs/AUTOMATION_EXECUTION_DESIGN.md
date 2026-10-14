# Automation Execution & Pipeline Design

**Architecture:** Distributed, Asynchronous, Persisted Background Processing  
**Control Plane:** Laravel 11 Queue & Scheduler  
**Target Database:** Parameterized MySQL Connector  

---

## 1. 20-Stage Execution Lifecycle

Every automation run follows a deterministic, 20-stage observable lifecycle recorded in the `timeline_events` JSON array on each `AutomationExecution` record:

1. **TRIGGER_DETECTED:** Scheduled cron event or manual user trigger accepted.
2. **EXECUTION_INITIALIZED:** Execution record persisted with UUID idempotency key, tenant ID, and initial status `QUEUED`.
3. **FAIR_QUEUE_ENQUEUED:** Job placed in tenant-interleaved dispatch queue.
4. **WORKER_ACQUIRED:** Worker claims execution lease with expiration timestamp (preventing duplicate worker processing).
5. **TARGET_CONNECTION_VERIFIED:** Ephemeral PDO connection opened and validated against target host.
6. **SCHEMA_REVALIDATED:** Fresh column and constraint metadata loaded; drift detected if columns changed.
7. **CONTEXT_RETRIEVED:** If RAG enabled, FAISS vector search retrieves top-k relevant chunks.
8. **PROMPT_ASSEMBLED:** Pydantic generation brief prepared with column definitions and tone guidelines.
9. **AI_INFERENCE_STARTED:** Private HTTP request sent to Python AI microservice (`/v1/ai/generate`).
10. **AI_INFERENCE_COMPLETED:** Raw response received and parsed.
11. **STRUCTURED_OUTPUT_PARSED:** JSON validated against target schema fields.
12. **FIELD_CONSTRAINTS_VALIDATED:** Non-nullability, string lengths, and enum values enforced.
13. **RELATIONSHIPS_RESOLVED:** Foreign keys resolved deterministically (searching existing categories or creating parent rows in transaction).
14. **DUPLICATE_CHECK_PASSED:** Unique slug or title constraints verified against existing MySQL records.
15. **ASSET_PIPELINE_RESOLVED:** Image URLs or paths validated against column storage expectations.
16. **APPROVAL_DECISION_HANDLED:**
    - If `requires_approval = false`: directly transitions to `APPROVED`.
    - If `requires_approval = true`: saves immutable version #1, sends preview email, sets status `PENDING_APPROVAL`.
17. **PRE_COMMIT_AUTHORIZATION:** Final permission verification immediately before transaction begins.
18. **TRANSACTION_STARTED:** Atomic `PDO::beginTransaction()` on customer target MySQL.
19. **RECORD_COMMITTED:** Parameterized `INSERT` (or `UPDATE`) executed; generated primary key captured.
20. **PUBLICATION_VERIFIED:** `PDO::commit()` confirmed; status updated to `PUBLISHED`; live event broadcast.

---

## 2. Idempotency & Concurrency Defenses

1. **Unique Idempotency Keys:** Every execution receives a unique key formatted as `{trigger_type}_{automation_id}_{date_hour}_{hash}`. Duplicate trigger requests within the same window return the existing execution.
2. **Worker Lease Locks:** When a worker acquires an execution, it writes `lease_expires_at = now()->addMinutes(15)`. Other workers ignore active leases.
3. **Stale Lease Recovery:** If a worker crashes or restarts, subsequent scheduling ticks identify expired leases (`lease_expires_at < now()` and status in `['GENERATING', 'PUBLISHING']`), increment `retry_count`, and requeue up to the configured retry ceiling (default 3).
4. **Safe Failure & Dead-Letter State:** After 3 failed attempts, status transitions to `FAILED` with an explicit `failure_category` (e.g. `PROVIDER_UNAVAILABLE`, `DATABASE_TIMEOUT`, `SCHEMA_MISMATCH`).

---

## 3. Post-Publication In-Portal Record Updates

When an operator edits an already published record through the portal:
1. `ExecutionController::updateRecord()` validates that the caller owns the execution and that `status === 'PUBLISHED'`.
2. Target table eligibility is confirmed via `DatabaseSafetyService`.
3. Protected columns (`id`, `created_at`, password hashes) are stripped.
4. Parameterized `UPDATE \`table\` SET col = :val WHERE id = :target_id` is executed inside a transaction by `SafeDatabaseExecutor::executeUpdate()`.
5. A new `ContentVersion` record with `version_number = N+1` is recorded to maintain immutable change history.
6. A security audit log entry is written and a live event broadcast to update UI state in real time.
