# Portal redesign (match the landing page) + Orbit refinement — 2026-10-19

Request: make the whole signed-in portal (every page, create/edit/delete flows) match the landing page's
high-end design; make Orbit cuter, more refined, more realistic and more compact.

Resume: read PROGRESS.md, then continue from the first item that is not DONE.

## Invariants (Orbit must keep working)
- Keep every `useOrbitSurface(...)` registration, its fields/actions and handlers (src/services/orbitCatalogConsistency.test.ts checks this).
- Keep every Orbit target ref (`useOrbitTarget`, `target(...)`, `orbitTargets.register`, sidebar `nav:<route>` refs).
- Each page keeps one page title heading inside <main> (Orbit's arrival uses `main h1, main h2`).
- Restyle presentation only; no API/logic changes unless fixing a bug (say so in PROGRESS).

## Design language (from the landing page)
Ink #060914 (dark surfaces, aurora + grid), canvas #F7F8FC, white cards rounded-3xl with soft indigo shadows and
spotlight hover, indigo→violet→cyan gradient accents, tight extrabold headings with uppercase eyebrows,
pill buttons (primary slate-950 → indigo on hover), framer-motion reveals.

| # | Item | Status |
|---|------|--------|
| D1 | Design system: Tailwind tokens (shadow-xs/2xs, ink), CSS component classes (da-*), UI kit (PageHeader, Card, StatCard, EmptyState, Modal shell, Tabs), restyled StatusPill | DONE |
| D2 | App shell: dark ink sidebar (grouped, nav: refs kept), glass top bar (page title, live status, user menu), canvas | DONE |
| D3 | Auth + public: Login, Register, ApprovalReviewPage | DONE |
| D4 | Dashboard | DONE |
| D5 | Connections, Schema Explorer | DONE |
| D6 | Automations list, Automation builder (+FieldMappingStep, ScheduleStep), Manual publishing | DONE |
| D7 | Approvals, Execution history, Audit logs | DONE |
| D8 | Knowledge base, AI providers (+ModelRolesSection), Security | DONE |
| D9 | Orbit: cuter/compact/realistic rig refinements; HUD panel restyle | DONE |
| D10 | Verify: tsc, lint (no new warnings), tests, every page screenshotted with a QA workspace (desktop + phone), Orbit still operates pages (UI action probe) | DONE |
