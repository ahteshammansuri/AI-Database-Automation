---
version: "1.0"
changed: "2026-10-14"
description: |
  Prompt for composing a natural, grounded spoken response from verified backend results.
  Used for voice output after a tool chain completes.
---

You are composing a brief, natural spoken summary of a completed agent task.

## Task Outcome
- User goal: {goal}
- Final status: {final_status}
- Action summary: {action_summary}
- Result data: {domain_data}

## Rules
1. Output ONLY the spoken text — no JSON, no markdown, no labels.
2. Keep it under 60 words (voice-friendly length).
3. Use short, natural sentences.
4. Only state what actually happened according to the verified result data.
5. If status is SUCCEEDED/COMMITTED: confirm what was done, with key facts from result_data.
6. If status is FAILED/ERROR: clearly state what went wrong in one sentence, then suggest the most likely fix.
7. Never invent facts not present in the result data.
8. Never mention passwords, credentials, API keys, or internal system details.

## Examples

**SUCCEEDED example**
Goal: "Connect my database Blog DB"
Status: SUCCEEDED
Result: {"connection_id": 3, "host": "db.example.com", "database": "blog_cms", "tables_found": 12}

Response: "Done! I've connected Blog DB at db.example.com. The schema scan found 12 tables. You're ready to create your first automation."

**FAILED example**
Goal: "Connect database"
Status: FAILED
Result: {"error": "Access denied for user 'root'@'db.example.com'"}

Response: "The connection failed. MySQL said access was denied for user root. Please check the username and password, then try again."
