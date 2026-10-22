# Admin panel (Filament) for the whole platform (2026-10-21)

## Goal
A separate, high-end Filament admin panel at `/admin` where platform staff manage everything: customers and their
usage (connections, automations, success rates, Orbit activity), platform settings that today live in `.env`,
config files or code constants, website content, Orbit's settings and its knowledge of the website, and the admin
team itself with role-based access (a super admin creates admins and roles). Nothing is committed (user's request).

## Key decisions
- **Filament v5** (latest; supports Laravel 11.28+) + **spatie/laravel-permission** (v6 for Laravel 11).
- **Separate `admins` table and `admin` guard** (session). Customers (`users`) can never sign in to `/admin`, and an admin
  is not a customer. No default account: the first super admin is created with `php artisan admin:create`
  (AGENTS.md: no seeded demo account).
- **Roles**: `super_admin` (everything, via Gate::before) + any roles the super admin defines from a permission matrix
  (per area: view / create / update / delete / special actions). Guard rails: at least one super admin always remains,
  admins cannot change their own roles, only super admins grant `super_admin`.
- **Dynamic settings**: `platform_settings` table + a code registry of every setting (type, default from today's
  config/env/constant, validation, help). Saved values are cached and applied over `config()` at boot, so existing code
  that reads config picks them up; hard-coded constants are moved to config first. The portal reads public values from
  `GET /api/platform/config`; the landing page reads content from `GET /api/site/content` (today's text is the default).
- **Stays in the server environment (shown read-only in the panel, with the reason)**: values needed before the database
  is reachable or shared with another process: APP_KEY, platform DB credentials, queue/cache drivers, Reverb app
  keys, the AI service shared token, mail transport credentials.
- **Customer secrets are never shown** (connection passwords, provider keys): only "set / not set". Admins cannot read
  customer target data. Admin powers over customers are safe ones: suspend/reactivate, sign out everywhere, set a
  connection to read-only, pause automations, end phone sessions, delete an account (super admin, typed confirmation).
- **Everything an admin changes is audited** (who, what, which fields; never secret values).
- **Orbit's website knowledge**: the guides in `docs/orbit-agent/*.md` become admin-managed records; publishing sends
  them to the AI service (internal, service-token) which re-indexes the product knowledge partition.

## Phases
| # | Step | Status |
|---|------|--------|
| A1 | Install Filament v5 + permissions; `admins` + `admin` guard; panel provider (portal design: Plus Jakarta Sans, indigo/violet, ink sidebar); `admin:create`; permission registry + sync; Admins + Roles resources; super-admin rules; admin activity log | DONE |
| A2 | Settings system (table, registry, cache, apply to config, constants -> config), settings pages (General, Registration & security, Mail, AI, Automations, Data assistant, Orbit, Orbit Remote, Feature flags), `/api/platform/config` | DONE |
| A3 | Website content (announcement, hero, sections, FAQs, closing, footer, SEO) + `/api/site/content` | DONE |
| A4 | Customers (usage, suspend, sign out, delete), connections, automations, executions, AI providers, knowledge docs, Orbit tasks, phone sessions, customer audit log | DONE |
| A5 | Orbit knowledge guides (CRUD, import from docs, publish -> AI service re-index) | DONE |
| A6 | Overview dashboard (KPIs, charts, success rates, recent signups/failures) + System health (services, queues, failed jobs, environment read-only) | DONE |
| A7 | Portal + landing use platform config and site content (announcement, registration closed, min gap, brand, flags) | DONE |
| A8 | Verify: Laravel tests (auth separation, permissions, settings applied, suspension, registration toggle, endpoints), frontend tests, tsc, lint, real browser screenshots of the panel | DONE |
