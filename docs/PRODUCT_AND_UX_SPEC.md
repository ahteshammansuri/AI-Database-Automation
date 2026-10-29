# Product & UX Specification

**Application:** AI-Powered Database Automation Platform  
**Target Audience:** Non-technical content operators, database administrators, marketing teams, SaaS engineering leads  
**Design Ethos:** High-craft SaaS, clear visual hierarchy, accessible interactions, calm color palette, zero fabricated metrics

---

## 1. Information Architecture & Navigation

The platform organizes user operations across a streamlined sidebar navigation:

1. **Dashboard (`/`):** Operational control center displaying system health, KPI telemetry, upcoming execution countdowns, timeseries performance charts, and live activity streams.
2. **Connections (`/connections`):** Database credential management, staged connection diagnostics, schema freshness tracking, and safe deletion dependency checks.
3. **Schema Explorer (`/schema`):** Read-only table inventory with four-tier classification (Recommended, Review Recommended, Restricted, All Tables), field-level constraints, and custom metadata annotations.
4. **Automations (`/automations`):** Configured pipeline registry with active/paused toggles, run-now triggers, and link to the wizard.
5. **Automation Wizard (`/automations/new`):** 5-step guided configuration with pre-built workflow templates, natural-language blueprint proposer, schema-aware field mapping, and preview dry-run.
6. **Executions (`/executions`):** Comprehensive chronological run history, 20-stage process timeline, provenance inspector, and in-portal published record editor.
7. **Approvals (`/approvals`):** Pending editorial review center with side-by-side payload viewer, inline draft editor, and versioned approve/reject actions.
8. **Manual Content (`/manual-schedule`):** Purely deterministic content scheduler with AI disabled, schema validation, and immediate or future publication.
9. **Knowledge Base (`/knowledge`):** Document ingestion (PDF, Markdown, TXT), FAISS chunk indexer, and interactive RAG semantic query tester.
10. **AI Providers (`/ai-providers`):** Local Ollama endpoint configuration, model selector, optional cloud credentials (OpenAI, Gemini, Claude), and live health verification.
11. **Audit Logs (`/audit-logs`):** Tenant-scoped tamper-evident security audit log tracking all configuration changes, runs, and updates.

---

## 2. Design System & Tokens

- **Color System:**
  - Base Neutrals: Slate (`slate-50` through `slate-900`) for crisp contrast and low eye fatigue.
  - Brand Primary: Indigo / Violet (`indigo-600` primary, `violet-600` accents).
  - Semantic Status:
    - Success / Published: Emerald (`emerald-600`, `bg-emerald-50`, `border-emerald-200`)
    - Pending / Warning: Amber (`amber-600`, `bg-amber-50`, `border-amber-200`)
    - Error / Restricted: Rose (`rose-600`, `bg-rose-50`, `border-rose-200`)
    - Queue / Running: Blue / Indigo (`blue-600`, `bg-blue-50`, `border-blue-200`)
- **Typography:**
  - Inter / Modern Sans for interface copy.
  - JetBrains Mono / System Monospace for schema table names, SQL types, timestamps, latency metrics, and JSON payloads.
- **Micro-Interactions & Motion:**
  - Fast, purposeful Framer Motion transitions (duration 180ms–250ms).
  - Subtle hover lift on interactive cards (`whileHover={{ y: -2 }}`).
  - Full support for `prefers-reduced-motion`.
  - Realistic loading skeletons matching exact content dimensions:
    - Portal: building blocks in `frontend/src/components/ui/Skeleton.tsx`, one placeholder per page or section in `PageSkeletons.tsx`, and the first-load screens (portal shell, landing, sign-in, emailed review link) in `ShellSkeletons.tsx`. Colours are tokens in `index.css` (`--skel-*`): they turn dark on ink surfaces (`bg-ink`, `da-ink`, `.dark`) and back to light inside white cards and modals.
    - Admin panel: lazy dashboard widgets render a skeleton of their own kind (stats, chart with its real heading, table) through `App\Filament\Widgets\Concerns\HasSkeletonPlaceholder`; styles and light/dark tokens are in `resources/views/filament/admin/theme.blade.php`.
    - Skeletons stand in for data on its way. Buttons keep their inline spinner while an action runs, and long server work keeps `WorkProgress`, which shows the steps the server reports.

---

## 3. Workflow Specifications

### A. Automation Templates & Wizard
Step 1 of the automation wizard provides instant 1-click SaaS blueprints:
1. **Daily Blog Generator:** Configures AI generation for title, slug, content, excerpt, and published status on a daily 30-minute lead time.
2. **Product Description & SEO:** Enhances catalog items with feature bullets, meta tags, and alt descriptions.
3. **Missing Metadata Completion:** Fills empty excerpts, meta descriptions, or summary fields.
4. **Knowledge Base & FAQ Generator:** Generates structured Q&A articles grounded in uploaded documentation.
5. **Multi-Region Localization:** Translates and adapts existing content for target locales.
6. **Content Rewrite & Polish:** Upgrades tone, fixes grammar, and optimizes readability.
7. **Manual Publication:** Pure editorial workflow with zero AI calls.

### B. Post-Publication In-Portal Editor
When a record has been published to MySQL, operators can inspect the record in `ExecutionsPage.tsx` and click **"Edit Published Record"**:
- Current values in MySQL are displayed in accessible form fields.
- Protected columns (e.g. `id`, `created_at`, password hashes) are locked from edits.
- Operators can modify title, excerpt, content, status, and metadata.
- Unsaved dirty states are clearly marked.
- Clicking **"Save & Update Target MySQL"** invokes parameterized `UPDATE` through `SafeDatabaseExecutor`, records a platform-side version snapshot, logs an audit entry, and confirms the update.

### C. Live Realtime Stream & SSE
- The portal establishes an authenticated Server-Sent Events (SSE) connection to `/api/live/stream`.
- Realtime events update execution statuses, queue progress, and connection health without requiring page reloads.
- An automatic polling fallback operates if SSE is interrupted.
