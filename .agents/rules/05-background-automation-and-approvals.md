---
trigger: always_on
description: Persisted background jobs, scheduling, manual publishing, email approvals, versioning, and retries.
---
# Background Automation, Scheduling, and Approval

## Real background processing
- Generation and publication must run independently of an open browser tab.
- Use Laravel's queue and scheduler with persisted jobs/schedule state. Document and provide commands/scripts to start web server, queue worker and scheduler in local development. An optional Docker Compose setup may start them together.
- Do not use frontend timers or process-memory-only schedules for durable work.
- Scheduled runs must survive restart and distinguish due, running, completed, failed, cancelled and retryable states.
- Use timezones (IANA IDs such as `Asia/Kolkata`), explicit generation time and publication time, job locks, idempotency, bounded retries and useful logs.

## AI automation
1. Claim an eligible scheduled execution.
2. Check owner, automation status, connection status and policy.
3. Retrieve authorized schema/context and run generation via the AI service.
4. Validate structured output and relationships.
5. Save an immutable content/data version.
6. If approval is required, set `PENDING_APPROVAL` and send an email preview.
7. At publish time, re-check eligibility and atomically perform allowed writes.
8. Record exact outcome and audit event.

## Manual scheduling
- Manual content must be schedulable with AI disabled and no model/provider call.
- Validate it with the same schema and execution policies as AI output.
- Support one-time and daily/weekly scheduling at MVP scale. Clearly show configured timezone and next run.

## Approval workflow
- Email must identify the exact automation and immutable content version, include a readable preview and publication time, and provide signed, expiring, one-time approval/rejection actions.
- Approval/rejection must be authenticated by a secure token or signed action; bind token to user/workspace, automation and exact version. Prevent replay.
- On rejection, preserve the rejected version, store feedback, generate a new version with feedback as context, revalidate, and send a new preview.
- Use a configurable retry limit (default three regeneration attempts). After limit, require manual intervention.
- A rejected/invalid/stale version must never publish.
- If regeneration is not ready at the publication deadline, fail safely rather than publishing rejected or invalid content.
- The no-response default may auto-publish the latest valid, eligible, unrejected pending version only if the user configured that policy. Make the policy visible and editable. Alternatives should include keep-as-draft/cancel.
- Revalidate automation active status, version identity, approval/timeout policy, schema, ownership, connection status and idempotency immediately before write.

## Email and operational errors
- Configure SMTP/provider transport as platform runtime configuration, but email recipients, approval policy and automation preferences are user-specific app data.
- Email failure must be recorded; offer bounded retry and visible error state. Never pretend email was sent when delivery was not confirmed by the configured transport.
- Keep approval history and execution logs tenant-scoped. Do not expose signed action tokens in logs.
