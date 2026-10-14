# INTERRUPTION_AND_RECOVERY.md
## Interruption, Plan Versioning, and Fault Recovery Specification

**Objective:** Ensure task safety, idempotency, and clean recovery when the user interrupts mid-task or an external service fails.

---

### 1. Plan Versioning & Cancellation Model

Every `AgentTask` record in the database maintains:
- `plan_version`: Integer incremented whenever the plan or slots are altered.
- `idempotency_key`: UUID uniquely identifying the planned execution.
- `status`: State machine transition (`READY` -> `RUNNING` -> `COMMITTING` -> `SUCCEEDED` / `CANCELLED` / `FAILED`).

When a user interrupts or issues a correction:
1. `POST /api/agent/tasks/{id}/interrupt` or `/correct` is invoked.
2. The orchestrator checks if the current step is already committed (e.g. database write transaction committed).
   - If committed, it does **not** pretend to roll back. It records `COMPENSATING_UPDATE` if applicable, or explains that the change was already committed.
   - If uncommitted (e.g. pending save or waiting for confirmation), the pending step is cancelled immediately.
3. The `plan_version` is bumped. Any worker job or frontend action carrying an outdated `plan_version` is rejected with `STALE_PLAN_VERSION`.

---

### 2. Error Recovery Strategies

| Failure Scenario | Recovery Path |
|---|---|
| **Database connection refused (e.g. bad port)** | Return structured `CONNECTION_REFUSED`. Retain all valid slots (`host`, `database`, `username`). Ask user to verify port or host without wiping other fields. |
| **Authentication failed (bad password)** | Return `AUTHENTICATION_FAILED`. Retain host/database/username. Prompt only for corrected password via secure masked input. |
| **Ollama process offline** | Return `PROVIDER_UNAVAILABLE` with guidance: "Ollama is currently offline at http://127.0.0.1:11434. Please start Ollama or configure a cloud provider." |
| **Network timeout / disconnection** | Client reconnects via SSE (`/api/live/stream`) and re-synchronizes active task state from `/api/agent/conversations/{id}`. |
