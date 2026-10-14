---
trigger: always_on
description: Public landing/service page, authentication, onboarding, responsive product portal, and honest interactive states.
---
# Landing Page, Dashboard, and UX Rules

## Public website
Build an attractive, trustworthy landing/service page describing the product's purpose and benefits, how it works, key capabilities, security boundaries, AI options, and calls to action. Include working Register and Log In navigation. Avoid fake customer logos, fabricated metrics, testimonials, or claims that are not supported by the implementation.

## Authenticated journey
After registration/login, route users to their own dashboard. A first-time user must see a useful empty state and onboarding CTA to add a database. Do not show another user's data, a hardcoded demo connection, or fake metrics as if real.

## Dashboard pages
Implement functional screens for:
- Dashboard/overview
- Database connections and connection testing
- Schema explorer
- AI provider and model settings
- Knowledge base uploads/indexing
- Automation creation/editing
- Automation details and field mapping
- Generated content and immutable versions
- Approvals and rejection feedback
- Manual scheduled content
- Execution history/logs
- Account/settings

## Visual quality
- Use a coherent design system, responsive layouts, clear hierarchy and readable typography.
- Prefer polished, calm SaaS visuals with consistent spacing, color tokens, reusable components, responsive tables/cards, clear forms and status labels.
- Include skeleton/loading, empty, success, validation, permission-denied, connection-failed and server-error states.
- Make keyboard focus, labels, contrast and error messages accessible.
- Use animation sparingly and avoid distracting motion.
- No inert buttons, fake actions or unconnected controls. If an action is not implemented, label it as unavailable rather than showing false success.
- Do not hardcode dashboard totals or executions. Derive values from APIs and persisted data.
- Do not expose raw secrets, database passwords, full provider keys or sensitive log content in the UI.

## Forms and workflows
Use step-by-step forms for database setup and automation configuration. Validate input on the client for usability and always validate again on the server. Clearly explain required permissions, database write behavior, AI data-sharing mode, scheduling timezone, approval timeout behavior and publication risk before enabling an automation.
