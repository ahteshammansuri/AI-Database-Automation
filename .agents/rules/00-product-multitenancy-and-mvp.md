---
trigger: always_on
description: Product scope, independent user onboarding, multi-user isolation, and MVP constraints.
---
# Product, Multi-Tenancy, and MVP Rules

## Core experience
Implement the complete dynamic journey:
1. Public landing/service page explains the product, value, workflow, security posture, and local/cloud AI choices.
2. Visitor can register or log in.
3. A newly registered user enters their own empty dashboard and onboarding flow.
4. User adds database connection details in the portal and tests the connection.
5. The platform discovers that connection's schema and displays its tables, fields, constraints and relationships.
6. User configures their own model/provider, knowledge sources and automation.
7. Work is executed by persisted background workers, with visible status and audit history.

## No static demo dependencies
- Do not create a fixed user login, shared customer database, hardcoded connection, fixed provider key, or preconfigured customer automation.
- Do not require customers to modify `.env` to add their own database or AI credentials.
- New users must be able to onboard independently after a clean installation.
- Do not automatically seed sample customer connections/content on normal startup. Synthetic data and seeded records are allowed only in explicit test fixtures or a clearly documented, opt-in demo-seed command.
- Platform runtime configuration still belongs in `.env`; user-specific integrations belong in the database, encrypted and associated with the owning user/workspace.

## Multi-user scope
Every connection, provider credential, knowledge source, automation, generated content version, approval, schedule, execution, and log must belong to the correct user/workspace. Query scoping and authorization must be enforced by the backend at every access and in queue jobs. Never trust a submitted `user_id` or workspace ID from the client without deriving/authorizing it from the authenticated session.

## MVP priorities
First working slice: public landing page → registration/login → empty dashboard → add and test MySQL connection → schema scan → configure local provider → create/test blog automation → validate output → approve/reject/version → background publication → audit log.

Target ~80 engineering hours. Keep future features (billing, enterprise SSO, multiple target database engines, advanced teams/RBAC, hosted agent fleet) outside MVP unless the vertical slice is complete. Prefer reliable, demonstrable depth over many incomplete screens.
