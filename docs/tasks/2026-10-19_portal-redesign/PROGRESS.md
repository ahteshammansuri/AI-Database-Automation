# Progress — portal redesign

## 2026-10-19
- Audit: 15 pages (~11k lines); one <h2> title per page; shadow-xs/2xs used 158x but undefined in Tailwind 3;
  10-11 px text ~270x; Orbit hooks per page inventoried (surfaces 1-5 per page).
- D1 DONE: tokens as CSS utilities in src/index.css (bg-ink, bg-canvas, shadow-2xs/xs/soft/lift/glow/ink). Note: the
  running Vite dev server kept a stale Tailwind config (bg-canvas unknown), so tokens live in CSS @layer utilities,
  not tailwind.config.js (reverted to HEAD). da-* component classes; src/components/ui/kit.tsx (PageHeader [h1],
  Card, CardHeader, IconTile, StatCard, EmptyState, Spinner, Loading, ModalShell); StatusPill shows readable labels.
- D2 DONE: navConfig.ts (grouped nav + navFor), dark ink Sidebar (nav:<route> refs kept), glass Navbar (breadcrumb,
  live pill, refresh, New automation, account menu), Layout canvas grid.
- QA workspace for screenshots: user 77 (qa.visual+…@example.test), connection 41 -> shopfx on 3317 (read-only,
  autofx_scratch no longer exists), 3 automations, execution 205 pending approval. Delete with qa_cleanup.php at the end.
- D4 DONE: Dashboard (ink hero with greeting h1 + Next up card, onboarding checklist, StatCards, reliability card,
  automations / recent runs / live activity). dashboard.page surface unchanged.
- D5 DONE: Connections (PageHeader, spotlight cards, ModalShell form with panelRef = connections.form target; engine
  badges made honest: "Supported"/"Not yet", PostgreSQL needs the driver), Schema Explorer (tabs, list, detail card,
  da-table). Fixed: ModalShell backdrop stacked above the panel (backdrop z-0, panel z-10 inside the container).
- D6 (part): Automations list (state summary chips, spotlight rows, ModalShell editor) and Automation builder
  (PageHeader, gradient stepper, da-card steps, da-input/da-label, ModalShell doc upload) + FieldMappingStep/ScheduleStep
  classes. Catalog consistency test 4/4 after each page.
- NOTE: the owner's stack (run_all.sh) went down during the session (all ports closed, not caused by this work); I
  started ./run_all.sh in the background (log: scratchpad/stack/run_all_restart.log) to keep verifying.
- D6/D7/D8 DONE: Manual publishing, Approvals, Execution history, Audit log, Knowledge base, AI providers
  (+ModelRolesSection), Security (PageHeader, da-card, ModalShell modals, da-table, pill buttons). Honesty fixes on the
  way: Knowledge retrieval test showed a made-up 85% match when a result had no score (now "no score"); the Ollama
  helper suggested `ollama run llama3` (now the README's qwen2.5:3b + nomic-embed-text); vague "100% on-prem" claims
  replaced with what actually happens. SchemaFieldControl inputs use da-input.
- D3 DONE: AuthShell (ink brand panel with live Orbit + form panel) for Login/Register (logic unchanged; register
  shows a password strength meter), public ApprovalReviewPage (ink header + da-cards).
- D9 DONE: Orbit refinement. Compact chibi proportions (slimmer, shorter body; shorter arms/legs; smaller ears; tighter
  SVG frame), realism (rim highlight + cool bounce light on the helmet, diagonal glass sheen on the screen, face glow),
  cuter eyes (bigger, breathing catchlights, twinkling sparkle), lifelike idle: micro-saccades (createSaccades) and an
  occasional happy smile beat in the idle personality (calm states only). Tests: rigPersonality 4/4 (+smile, +saccades).
- D10 DONE: tsc clean; frontend tests 59/59; vite build OK; lint on every touched file <= HEAD (touched files 144 -> 96
  warnings, incl. 41 unused imports removed); catalog consistency 4/4. Real browser: every portal page renders its
  <h1>, no console errors; phone width 390: no horizontal overflow on all 12 portal pages (dashboard needed min-w-0
  + overflow-x-clip on the chart), drawer opens. Orbit drove the redesigned UI over the live channel (task 220):
  11/11 UI actions ok (nav, open connection form via the new header button, fill 5 fields, point at password, cancel,
  approvals/executions/knowledge show_me). Landing page unchanged. QA user 77 and its index deleted.
