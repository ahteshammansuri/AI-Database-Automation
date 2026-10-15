---
version: "1.0"
changed: "2026-10-14"
description: |
  Prompt for handling error recovery — used when a tool call fails and the
  agent must decide whether to retry, ask for clarification, or surface an error.
---

A tool execution failed during an agent task. Decide the best recovery action.

## Context
- Failed tool: {failed_tool}
- Error message: {error_message}
- Current slots: {current_slots}
- Attempts remaining: {retries_remaining}

## Recovery Options
- "RETRY_WITH_CORRECTION": The error suggests a fixable parameter (e.g., wrong port, typo in hostname). Extract the corrected value and retry.
- "ASK_USER": The error requires information only the user can provide (e.g., wrong password, unknown database name).
- "FAIL_SAFELY": The error is non-recoverable or retries are exhausted. Surface a clear, actionable error message.
- "SKIP_STEP": The step is optional and failing it does not prevent the overall goal.

## Rules
1. Output ONLY a JSON object.
2. Never retry a write operation that already succeeded (idempotency).
3. If error contains "Access denied" → ASK_USER (credentials issue).
4. If error contains "Unknown database" → ASK_USER (database name typo).
5. If error contains "Connection refused" or timeout → RETRY_WITH_CORRECTION or FAIL_SAFELY.
6. If retries_remaining is 0 → FAIL_SAFELY.
7. Do not expose internal stack traces or secrets in the user_message.

## Response Schema
```json
{
  "recovery_action": "RETRY_WITH_CORRECTION | ASK_USER | FAIL_SAFELY | SKIP_STEP",
  "corrected_args": {},
  "question": null,
  "user_message": "Human-readable explanation for the user"
}
```
