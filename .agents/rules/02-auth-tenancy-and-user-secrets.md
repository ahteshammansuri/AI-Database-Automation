---
trigger: always_on
description: Registration, login, tenant isolation, user-managed integrations, and secret handling requirements.
---
# Authentication, Ownership, and Per-User Settings

## Authentication and onboarding
- Implement real registration, login, logout, validation, password hashing, session/token security appropriate to the chosen Laravel API setup, and protected routes.
- Do not rely on a default demo user or hardcoded credentials.
- After registration, take the user to a first-run dashboard/onboarding state with a clear action to connect a database.
- Unauthenticated visitors can access only the public landing, login, registration, and explicitly public routes.
- Return safe, actionable errors and prevent account enumeration where practical.

## Ownership isolation
The following resources must be scoped to the authenticated owner/workspace: DB connections, AI providers and keys, local model endpoints, knowledge sources, automations, mappings, versions, schedules, generated content, approval links, executions, logs and settings.

- Enforce ownership via Laravel policies/service authorization and database query scoping.
- Every background job must carry an immutable owner/resource identity and re-check ownership/status before operating.
- Never trust an owner ID supplied by the frontend.
- Prevent insecure direct object reference (IDOR) when a user changes a resource ID in a URL or request body.
- Add automated cross-user access tests for read, update, delete-of-platform-record, run, approval, logs and credentials. Platform record deletion is distinct from prohibited target-database DELETE.

## Per-user integrations
- A user adds and edits customer database credentials from the portal.
- A user configures Ollama endpoint/model or their own OpenAI/Gemini/Claude credentials from provider settings.
- API keys and target DB passwords are encrypted at rest with a managed application encryption mechanism. Prefer Laravel encrypted casts or an equivalent field-level encryption abstraction.
- Only show a masked key/status after saving; never return plaintext secrets to the browser again.
- Never log secrets, full connection strings, auth tokens, SMTP passwords, prompts that contain sensitive user context, or full database records.
- Provide safe update/rotation and disconnect/delete integration workflows; deleting a saved connection must not delete anything from its target database.

## Configuration boundary
`.env` contains only installation/runtime secrets and settings required to run the application and its internal services (e.g., Laravel APP_KEY, platform DB, queue/mail settings, internal Python service URL). It must not be used as the storage mechanism for customer-specific database credentials, user AI keys, or per-user model preferences.

## Key lifecycle and failures
- Validate provider settings before saving where possible.
- Do not silently fall back to a shared or paid provider when a user's configured provider fails.
- Redact secrets from validation errors, exceptions, telemetry and API responses.
- Document that local encryption depends on protecting the application encryption key and deployment backups.
