# Admin panel: progress log

- 2026-10-21: Explored. Laravel 11.57 / PHP 8.3 (intl, zip, gd ok), Packagist reachable; Filament v5.10.3 supports
  Laravel 11.28+; spatie/laravel-permission v6 for Laravel 11. Static/env values found: config/orbit.php,
  config/data_agent.php, FeatureFlagService (env-only flags), AiServiceClient + EmailApprovalService (direct env()),
  constants (ScheduleCalculator::MIN_GAP_MINUTES=15, max 3 regenerations in ApprovalController, tenant concurrency 3,
  media 10 MB, Orbit Remote TTLs/limits, data-change row caps). Orbit website knowledge = docs/orbit-agent/*.md indexed
  by the AI service into partition user_0. Landing text is static in frontend/src/components/landing/*. Portal font
  Plus Jakarta Sans + JetBrains Mono, indigo/violet/cyan, ink #060914.
- Installed filament/filament v5.10.3 (Livewire 4.4.8) + spatie/laravel-permission 6.25 (composer.json/lock changed;
  `filament:install --panels` added AdminPanelProvider, public assets are gitignored). composer audit: 4 advisories in
  laravel/framework 11 (fixed only in 12+; pre-existing, not upgraded).
- Migrations applied (additive): permission tables, admins / admin_password_reset_tokens / admin_activity_logs,
  users.suspended_at/suspension_reason/last_active_at, platform_settings.
- A1 core: Admin model (guard admin, HasRoles, MFA app), AdminPermissions registry (23 permissions, preset roles
  support/operations/content_editor), AdminActivity logger, AuthorizesWithPermissions trait (deny by default),
  commands admin:sync-permissions + admin:create (first admin is always super admin), Gate::before super admin,
  admin login listener.
- A2 core: SettingsRegistry (67 settings, 9 groups incl. content), PlatformSettings (cache, apply over config at boot,
  refresh before each queue job, validation, cross checks, reset, public config, content). Wired: min gap
  (ScheduleCalculator::minGapMinutes), max regenerations, tenant concurrency, media + knowledge MB, data write/delete/
  result rows, feature flags (config/features.php), AI service URL/key (config/services.php), frontend URL
  (config/app.php), Orbit Remote limits + off switch, Orbit off switch (EnsureOrbitEnabled), registration open +
  password min, suspended customers (EnsureCustomerActive + login), per-customer connection/automation limits.
  Public: GET /api/platform/config, GET /api/site/content (both verified live).
- A3: Website content page (announcement, hero, sections, FAQ, closing, footer, SEO) on the settings registry;
  served by GET /api/site/content.
- A4: Customers (usage counts, last active, success rate, suspend/reactivate/sign out everywhere/delete with typed
  email; relation tabs), Connections (credentials never shown; force read-only), Automations (pause/resume, success
  rate), Runs (timeline), Orbit requests, Paired phones (disconnect), customer activity log, admin activity log,
  Overview dashboard (8 stats, signups + runs charts, newest customers, recent failed runs). All pages render with the
  dev data (browser-probed).
- A5: Orbit knowledge. AI service: guides published from the panel are stored in its own storage
  (ai_service/storage/product_guides, gitignored) and replace the built-in docs/orbit-agent guides; publishing none
  falls back to the built-in ones. POST /v1/rag/product-guides (slug names only, re-index) and
  GET /v1/rag/product-guides/status, behind the service token. pytest: 5 passed (2 new). Laravel: orbit_knowledge_guides
  table, OrbitKnowledge service (load/restore built-in, publish, live status), Knowledge resource (Markdown editor,
  reorder, live state per guide by content hash, status cards from the AI service, publish/restore actions, activity
  log). Browser-verified: load built-in -> publish (identical text, version unchanged, no re-embed) -> edit in editor ->
  "Not live yet" -> publish (version changed, 65 -> 66 sections, cards refresh) -> restore -> publish (back to the
  original version a20d547ec2f1, 65 sections).
- Bug found and fixed: AdminActivity::diff read getOriginal() after save, which already holds the new values, so
  "from" in admin activity was wrong. It now takes a snapshot of the attributes from beforeSave (Admins, Roles, Knowledge).
- A6: System › Health page (platform DB, AI service, Ollama via the AI service, Reverb socket, scheduler, email,
  storage, failed jobs; per-queue worker last seen / waiting / running / oldest; read-only server environment with
  the reason each value stays in .env; "Check again", "Reload settings"). Heartbeats: queue workers on Looping
  (per queue), scheduler on ScheduledTaskStarting. Workers started before this change report only after a restart
  (verified with a one-pass worker: "Seen 4s ago"). System › Failed jobs (job name + first error line only, never
  payload or trace; retry/delete one or selected, logged). Found: the dev disk has 8.4 GB free (4%), shown in red.
- A7: Frontend reads the panel. PlatformProvider loads /api/platform/config + /api/site/content before rendering
  (spinner only if slow, retry screen if the server does not answer; refresh when the tab comes back after 60 s).
  Wired: brand name + tagline everywhere ({brand} placeholder in website texts, filled by the server), announcement
  bar (website + portal, dismissible per browser), hero / section headings / FAQ / closing / footer / sign-in panel
  texts, page title + meta description, registration closed screen, password minimum, knowledge + media MB limits,
  minimum schedule gap, Orbit off (mascot, phone card, phone button hidden), Orbit Remote off, phone end reasons
  (disabled, suspended, signed out / disconnected by admin, account deleted), session ended by the server
  (401 / suspended 403 -> sign-in page with a notice). Website content got 30 more fields (section headings, hero
  points, sign-in panel). Fixed: /api/platform/config and /api/site/content sent max-age=30, so a reload kept old
  values for 30 s; now no-cache. Browser-verified (admin panel -> site): announcement, brand, hero title,
  registration paused, Orbit off hides Orbit, suspending a customer sends their open tab to sign-in with a notice;
  every changed setting restored to defaults afterwards. tsc clean, lint 0 errors, npm test 73/73.
- A8: tests/Feature/AdminPanelTest.php, 22 tests: admin guard separation (guest, customer token, web user, inactive
  admin), role areas (support, no role, super admin), admin:create, settings applied / validated / defaults not stored /
  reset, public endpoints without secrets and with no-cache, sign-ups closed, password minimum, suspension (tokens
  revoked, login refused, 403 suspended, audit + admin log, reactivate), connection limit, Orbit off (503), Orbit Remote
  off (403), knowledge publish (payload, live state, failure, nothing included, edit -> pending), panel edit with
  before/after log (Livewire), slug validation, activity diff, worker heartbeat, failed job display, environment list.
  Full Laravel suite: 23 failed, 1 skipped, 226 passed; the 23 failures are exactly the earlier baseline (live target
  databases / services), none new. First full run showed 8 more (scheduler + fair queue): ApprovalFlowTest had no
  database isolation and committed a run; the old test order hid it because the first database refresh came later.
  Fixed by giving ApprovalFlowTest RefreshDatabase. AI service: 84 passed, 1 failed
  (test_busy_model_lock_reports_busy_not_crash), which fails the same way on the committed code (HEAD), not related.
  Frontend: tsc clean, lint 0 errors (2 new warnings of patterns already in AuthContext), npm test 73/73.
- Docs: README (section 6 Admin Panel, setup steps, Docker, env note), API_CONTRACT, SECURITY_MODEL,
  IMPLEMENTATION_PLAN.
- Cleanup: Orbit back on the built-in guides (published set removed; the tracked index manifest restored to its
  committed content), the 4 guide rows loaded during testing removed, QA admin and its 35 activity rows removed (no
  admin account exists now: run php artisan admin:create). Test settings restored to defaults. Left: two audit rows
  on the synthetic test customer #69 (ACCOUNT_SUSPENDED / ACCOUNT_REACTIVATED) from the browser check.
