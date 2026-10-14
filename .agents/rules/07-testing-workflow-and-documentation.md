---
trigger: always_on
description: Test strategy, local independent setup, iterative coding-agent workflow, documentation, and Git hygiene.
---
# Testing, Local Setup, Agent Workflow, and Delivery

## Test the real architecture
- Laravel: PHPUnit/Pest tests for registration/login, authorization/tenant isolation, connection profile encryption, connection ownership, automation configuration, queue jobs, schedules, approval tokens, email behavior, safe execution and audit logs.
- Python: pytest tests for provider adapters, input/output schemas, chunking, embeddings/indexing, retrieval, model-unavailable errors and structured-output validation.
- Frontend: test key registration/login, onboarding, database form, automation wizard, loading/error states and approval actions.
- Integration: use synthetic MySQL fixtures and deterministic mocked provider responses. Add a separately labelled Ollama smoke test when local Ollama/model is installed.
- Prove no customer-target destructive query is possible at the executor boundary. Test cross-user IDOR scenarios.
- Tests must not connect to or mutate real customer databases.

## Local independent setup
- Provide `.env.example` with runtime configuration needed to start the application, not customer connection credentials or user API keys.
- Provide migrations and clear setup commands for the platform database.
- On normal startup do not seed user accounts, target database profiles, provider keys, automations or user content.
- A separate opt-in synthetic demo/test setup may be provided, clearly isolated and never required for self-service onboarding.
- Document local model setup, model download requirements, Python AI service setup, Laravel queue worker, scheduler, frontend, and email testing (e.g. local mail catcher).
- The portal must let each test user register and configure their own integration through the UI.

## Agent work method
1. Inspect repository and installed rules first.
2. Write/update the implementation plan and note existing work before changing files.
3. Work in small vertical slices and keep the app runnable.
4. Run affected tests/linters/builds after changes; report actual outcomes.
5. Fix regressions instead of hiding/skipping them. If a test cannot run due to a missing service, state that accurately and provide reproducible instructions.
6. Maintain `docs/PROJECT_SPEC.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY_MODEL.md`, `docs/API_CONTRACT.md`, `docs/TEST_PLAN.md`, `docs/DECISIONS.md`, and `docs/IMPLEMENTATION_PLAN.md`.
7. Never claim features are complete unless tested. List remaining gaps and limitations honestly.
8. Do not remove user work, reset history, push to remote, or run destructive commands without authorization.
