# Interruption and Plan Revisions Specification

## 1. User Control & Interruptability
The user must never feel trapped while the assistant operates. The agent supports instant, multi-modal interruption:
- Spoken voice command: *"Stop"*, *"Pause"*, *"Cancel that"*, *"Wait, change the database to 3306"*.
- Prominent UI interrupt control on the compact HUD (Stop / Pause buttons).
- Global keyboard escape: `Escape` key immediately triggers pause/stop request.

## 2. Task State Model & Fencing Protocol
Tasks transition through explicit lifecycle states:
- `READY` -> `RUNNING` -> `PAUSE_REQUESTED` -> `PAUSED`
- `RUNNING` -> `INTERRUPT_REQUESTED` -> `CANCELLED`
- `RUNNING` -> `COMMITTING` -> `SUCCEEDED`

### Fencing Tokens & Plan Versioning:
- Every task maintains an integer `plan_version` and unique `idempotency_key`.
- Before executing any step, the backend checks:
  ```php
  $task->refresh();
  if (in_array($task->status, ['INTERRUPT_REQUESTED', 'CANCELLED', 'PAUSED'])) {
      // Step execution halted immediately
      return;
  }
  ```
- If a user issues a voice correction while a step is executing:
  1. The running task is immediately marked with `interrupted_at = now()`.
  2. Future steps from the old plan version are invalidated and fenced from execution.
  3. The Python AI service evaluates the new correction prompt alongside current state.
  4. If the active step has not crossed its commit boundary, it is cleanly rolled back or aborted.
  5. A revised plan version is created for remaining work, and execution safely resumes.

## 3. Commit Boundaries & Compensating Updates
- **Read-Only Steps** (e.g. testing connection, schema inspection, looking up values):
  - Can be aborted at any microsecond with zero side effects.
- **Transactional Mutation Steps** (e.g. saving an automation, creating a draft):
  - Executed inside a database transaction (`DB::transaction(...)`).
  - If cancelled before commit, transaction is rolled back cleanly.
- **Already Committed Steps**:
  - The assistant never pretends it can undo an irreversible committed action.
  - It speaks truthfully: *"The database connection was already saved, but I have cancelled the subsequent schema scan as requested."*
  - If a compensating update is safe and supported (e.g. updating an existing automation schedule or renaming), the assistant applies a safe scoped `UPDATE` operation.
  - Prohibits target database `DELETE` under all circumstances.
