# UX Redesign Specification — Cohesive B2B SaaS Design System

**Date:** October 9, 2026  
**Audience:** Product Engineering & Frontend Design  

---

## 1. Design Direction & Visual Foundations

The platform uses a modern, confident B2B SaaS aesthetic:
- **Typography:** Modern clean sans-serif stack (`Inter`, `system-ui`, `-apple-system`) with distinct hierarchy:
  - Page Titles: `text-xl font-extrabold tracking-tight text-slate-900`
  - Section Headings: `text-sm font-bold text-slate-800`
  - Field Labels: `text-xs font-semibold text-slate-700`
  - Body Text: `text-xs text-slate-600`
  - Metadata / IDs: `font-mono text-[11px] text-slate-400`
- **Color Roles:**
  - Primary / Brand: Indigo (`bg-indigo-600`, `text-indigo-600`, `focus:ring-indigo-500/20`)
  - Surface Background: Light neutral slate canvas (`bg-slate-50/50`) with pure white elevated cards (`bg-white border-slate-200 shadow-xs`)
  - Recommended / Safe: Emerald (`bg-emerald-50 text-emerald-700 border-emerald-200`)
  - Review Required: Amber (`bg-amber-50 text-amber-700 border-amber-200`)
  - Restricted / Prohibited: Rose (`bg-rose-50 text-rose-700 border-rose-200`)
  - Dark Mode elements (Code / JSON output): Rich slate-950 container (`bg-slate-950 text-emerald-300 font-mono text-xs border-slate-800`)

---

## 2. Screen-by-Screen Interaction Patterns

### 2.1 Public Landing & Service Page (`LandingPage.tsx`)
- Clear headline explaining self-service database automation with local Ollama or cloud models.
- Interactive interactive architecture diagram showing Laravel control plane, Python AI microservice, and customer database.
- Actionable CTAs routing to `/register` and `/login`.
- Security banner highlighting parameterized operations, encrypted credentials at rest, and zero arbitrary SQL.

### 2.2 Dashboard Overview (`DashboardPage.tsx`)
- Derived statistics from persisted database queries:
  - Connected Databases (`db_connections`)
  - Active Pipelines (`automations`)
  - Published Records (`automation_executions` where `status = PUBLISHED`)
  - Pending Approvals (`content_versions` where `status = PENDING_APPROVAL`)
- Clean empty onboarding state with "Connect your first database" CTA when 0 connections exist.
- Recent execution activity table with status badges and execution IDs.

### 2.3 Schema Explorer (`SchemaExplorerPage.tsx`)
- 4-Tier Table Classification:
  1. **Recommended for Automation:** Tables containing title, slug, content, or description fields.
  2. **Review Before Enabling:** Tables with foreign keys or complex constraints.
  3. **Restricted / Read-Only:** Security-critical tables (users, payments, credentials, logs).
  4. **All Discovered Tables:** Full metadata inventory.
- AI Semantic Explanation card for selected table:
  - Probable Business Purpose
  - Confidence Score & Structural Evidence
  - Editable User Annotation field with "Save Workspace Note" button.

### 2.4 Automation Builder (`AutomationBuilderPage.tsx`)
- **Natural Language Quick-Start:**
  - Input: *"Create daily engineering articles on database indexing, assign to Architecture category, preview at 8 AM, publish at 9 AM."*
  - "AI Propose Configuration" button: calls AI service to pre-populate target table, fields, relation rules, schedule, and approval policy.
- **Relational Field Resolution Selector:**
  - Option A: Pick existing database record from real lookup query.
  - Option B: Dynamic AI Lookup + "Auto-create category if missing" toggle.
- **Preview & Test:** Live AI structured payload generation with schema validation feedback before saving.

### 2.5 Executions & Observability (`ExecutionsPage.tsx`)
- Chronological execution history with search and status filters (`PUBLISHED`, `PENDING_APPROVAL`, `FAILED`).
- Detailed drawer / modal showing **Execution Event Timeline**:
  - `[08:00:01]` Trigger received by background worker
  - `[08:00:02]` Schema snapshot validated (target table: `posts`)
  - `[08:00:03]` RAG context retrieved (2 passages from indexed knowledge docs)
  - `[08:00:05]` Draft generated via Ollama (`llama3:latest`)
  - `[08:00:06]` Relational foreign key resolved: Category "Databases" (ID #3)
  - `[08:00:07]` Approval notification sent to reviewer
  - `[09:00:00]` Target write committed to MySQL `posts` table (Record ID #28)

---

## 3. Accessibility & Fit-and-Finish Invariants

1. All interactive inputs have explicit label associations.
2. Focus states use clear Indigo focus rings (`focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600`).
3. Skeletons for content during asynchronous loads; no jarring layout shifts.
4. Mobile responsiveness with collapsing navigation drawer.
5. Respect `prefers-reduced-motion` for animations.
