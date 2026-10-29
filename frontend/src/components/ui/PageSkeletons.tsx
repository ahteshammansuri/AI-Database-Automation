import React from "react";
import {
  Skeleton, SkeletonButton, SkeletonCardHeader, SkeletonChip, SkeletonField, SkeletonGroup, SkeletonListRows,
  SkeletonSectionTitle, SkeletonStatCard, SkeletonTable, SkeletonText, SkeletonTile,
} from "./Skeleton";
import { lineAt, widthAt } from "./skeletonWidth";

/**
 * Page and section placeholders, each in the layout of what it stands in for (same grid, card shapes and
 * spacing), so the content lands where the placeholder was instead of jumping in.
 */

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

/** The aurora + grid of an ink surface (decorative, as on the real ones). */
export const InkAurora: React.FC<{ a?: string; b?: string }> = ({ a = "bg-indigo-600/35", b = "bg-violet-600/25" }) => (
  <div aria-hidden className="pointer-events-none absolute inset-0">
    <div className={`landing-blob absolute -top-32 -left-20 h-96 w-96 rounded-full ${a}`} />
    <div className={`landing-blob absolute -bottom-40 right-10 h-96 w-96 rounded-full ${b}`} style={{ animationDelay: "-7s" }} />
    <div className="absolute inset-0 landing-grid opacity-70" />
  </div>
);

/* ---- Dashboard ------------------------------------------------------------------------------------- */

/** The body of the "Next up" card on the dashboard hero (dark). */
export const NextUpBodySkeleton: React.FC = () => (
  <SkeletonGroup label="Loading the schedule…" tone="dark">
    <Skeleton className="mt-4 h-5 w-3/4 rounded-lg" />
    <Skeleton className="mt-2 h-3 w-1/2" />
    <div className="mt-4 flex items-end justify-between gap-3">
      <div className="space-y-2">
        <Skeleton className="h-3 w-36" />
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-2.5 w-24" />
      </div>
      <div className="flex flex-col items-end gap-2">
        <Skeleton className="h-2.5 w-14" />
        <Skeleton accent className="h-[30px] w-24 rounded-lg" />
      </div>
    </div>
    <ol className="mt-5 grid grid-cols-3 gap-2">
      {range(3).map((i) => (
        <li key={i}>
          <Skeleton className="h-1 w-full rounded-full" delay={i * 0.1} />
          <Skeleton className="mt-2 h-2.5 w-14" />
        </li>
      ))}
    </ol>
  </SkeletonGroup>
);

const BAR_HEIGHTS = [42, 68, 30, 84, 56, 64, 38, 76, 50, 60, 46, 72];

export const DashboardSkeleton: React.FC = () => (
  <SkeletonGroup label="Loading your workspace…" className="space-y-6">
    {/* Hero */}
    <section className="da-ink px-6 py-8 sm:px-10 sm:py-10">
      <InkAurora />
      <div className="relative grid gap-8 lg:grid-cols-[1.35fr_1fr] lg:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-[26px] w-40 rounded-full" />
            <Skeleton className="h-[26px] w-28 rounded-full" />
            <Skeleton className="h-[26px] w-36 rounded-full" />
          </div>
          <Skeleton className="mt-6 h-8 w-3/5 rounded-xl sm:h-10" />
          <Skeleton accent className="mt-3 h-8 w-[85%] rounded-xl sm:h-10" />
          <SkeletonText lines={2} className="mt-5 max-w-xl" lineClassName="h-3.5" last="w-2/3" />
          <div className="mt-7 flex flex-wrap gap-2.5">
            <Skeleton accent className="h-10 w-40 rounded-full" />
            <Skeleton className="h-10 w-40 rounded-full" />
            <Skeleton className="h-10 w-36 rounded-full" />
          </div>
        </div>
        <div className="rounded-3xl border border-white/10 bg-white/[0.05] p-5 backdrop-blur">
          <div className="flex items-center justify-between">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-5 w-28 rounded-full" />
          </div>
          <NextUpBodySkeleton />
        </div>
      </div>
    </section>

    {/* KPIs */}
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
      {range(6).map((i) => <SkeletonStatCard key={i} delay={i * 0.06} />)}
    </div>

    {/* Run reliability */}
    <div className="da-card p-5 sm:p-6">
      <SkeletonCardHeader title="w-32" actions={<Skeleton className="h-10 w-36 rounded-2xl" />} />
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <div className="grid grid-cols-2 gap-3">
          {range(4).map((i) => (
            <div key={i} className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-3 h-7 w-16 rounded-lg" delay={i * 0.08} />
            </div>
          ))}
        </div>
        <div className="flex flex-col">
          <div className="flex items-center justify-between">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-32" />
          </div>
          <div className="mt-3 flex h-44 flex-1 items-end gap-2 overflow-hidden rounded-2xl border border-slate-100 bg-gradient-to-b from-slate-50/40 to-slate-50 px-4 pb-2 pt-6">
            {BAR_HEIGHTS.map((h, i) => (
              <div key={i} className={`flex h-full flex-1 flex-col items-center justify-end ${i > 6 ? "hidden sm:flex" : ""}`}>
                <Skeleton accent className="w-full max-w-[34px] rounded-b-none rounded-t-md" style={{ height: `${h}%` }} delay={i * 0.05} />
                <Skeleton className="mt-2 h-2 w-6 rounded-full" />
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-3 w-28" />
          </div>
        </div>
      </div>
    </div>

    {/* Automations, recent runs, activity */}
    <div className="grid gap-6 lg:grid-cols-3">
      {(["button", "pill", "text"] as const).map((trailing, i) => (
        <div key={trailing} className="da-card flex min-w-0 flex-col">
          <div className="p-5 pb-3">
            <SkeletonCardHeader description={false} title={i === 2 ? "w-24" : "w-28"} actions={<Skeleton className="h-3 w-16" />} />
          </div>
          <SkeletonListRows rows={4} trailing={trailing} lead={i === 2 ? "dot" : "none"} />
        </div>
      ))}
    </div>
  </SkeletonGroup>
);

/* ---- Connections & AI providers (card grids) ---------------------------------------------------------- */

const DetailPanel: React.FC<{ rows: number }> = ({ rows }) => (
  <div className="da-panel mt-4 space-y-2.5 px-4 py-3">
    {range(rows).map((i) => (
      <div key={i} className="flex items-center justify-between gap-3">
        <Skeleton className="h-3 w-14" />
        <Skeleton className={`h-3 ${i % 2 ? "w-20" : "w-28"}`} />
      </div>
    ))}
  </div>
);

export const ConnectionCardsSkeleton: React.FC<{ count?: number }> = ({ count = 3 }) => (
  <SkeletonGroup label="Loading connections…" className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
    {range(count).map((i) => (
      <div key={i} className="da-card flex h-full flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <SkeletonTile size="lg" />
            <div>
              <Skeleton className="h-4 w-32" delay={i * 0.1} />
              <Skeleton className="mt-2 h-2.5 w-12" />
            </div>
          </div>
          <SkeletonChip className="w-20" />
        </div>
        <div className="mt-4 flex items-center gap-1.5">
          <SkeletonChip className="w-20" />
          <SkeletonChip className="w-14" />
          <span className="ml-auto flex gap-1">
            <Skeleton className="h-8 w-8 rounded-full" />
            <Skeleton className="h-8 w-8 rounded-full" />
          </span>
        </div>
        <DetailPanel rows={4} />
        <div className="mt-auto grid grid-cols-3 gap-2 pt-4">
          {range(3).map((b) => <SkeletonButton key={b} size="sm" className="w-full" />)}
        </div>
      </div>
    ))}
  </SkeletonGroup>
);

export const ProviderCardsSkeleton: React.FC<{ count?: number }> = ({ count = 4 }) => (
  <SkeletonGroup label="Loading AI providers…" className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
    {range(count).map((i) => (
      <div key={i} className="da-card flex h-full flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <SkeletonTile size="lg" />
            <div>
              <Skeleton className="h-4 w-28" delay={i * 0.1} />
              <Skeleton className="mt-2 h-3 w-36" />
            </div>
          </div>
          <SkeletonChip className="w-16" />
        </div>
        <SkeletonText lines={2} className="mt-4 min-h-[44px]" lineClassName="h-3" last="w-1/2" />
        <DetailPanel rows={2} />
        <div className="mt-auto grid grid-cols-2 gap-2 pt-4">
          <SkeletonButton className="w-full" />
          <SkeletonButton className="w-full" />
        </div>
      </div>
    ))}
  </SkeletonGroup>
);

/* ---- Automations & approvals (stacked cards) ---------------------------------------------------------- */

export const AutomationListSkeleton: React.FC<{ count?: number }> = ({ count = 3 }) => (
  <SkeletonGroup label="Loading automations…" className="space-y-4">
    {range(count).map((i) => (
      <div key={i} className="da-card flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-1 gap-4">
          <SkeletonTile size="xl" />
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Skeleton className="h-[18px] w-48" delay={i * 0.1} />
              <SkeletonChip className="w-16" />
              <SkeletonChip className="w-14" />
              <SkeletonChip className="w-28" />
            </div>
            <SkeletonText lines={2} className="max-w-3xl" lineClassName="h-3" last="w-2/3" />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-3 w-48" />
              <Skeleton className="h-3 w-32" />
            </div>
            <div className="flex max-w-sm items-center gap-3">
              <Skeleton accent className="h-1.5 flex-1 rounded-full" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <SkeletonButton className="w-28" />
          <SkeletonButton className="w-24" />
          <Skeleton className="h-9 w-9 rounded-full" />
          <Skeleton className="h-9 w-9 rounded-full" />
        </div>
      </div>
    ))}
  </SkeletonGroup>
);

export const ApprovalListSkeleton: React.FC<{ count?: number }> = ({ count = 2 }) => (
  <SkeletonGroup label="Checking for drafts to review…" className="space-y-4">
    {range(count).map((i) => (
      <div key={i} className="da-card flex flex-col gap-5 p-5 sm:p-6 md:flex-row">
        <Skeleton className="hidden h-28 w-40 shrink-0 rounded-2xl md:block" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <SkeletonChip className="w-32" />
            <SkeletonChip className="w-20" />
            <SkeletonChip className="w-24" />
          </div>
          <Skeleton className="mt-4 h-5 w-2/3 rounded-lg" delay={i * 0.1} />
          <SkeletonText lines={2} className="mt-3" lineClassName="h-3" last="w-1/2" />
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            <Skeleton className="h-3 w-44" />
            <Skeleton className="h-3 w-56" />
            <Skeleton className="h-3 w-14" />
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <SkeletonButton className="w-24" />
            <SkeletonButton className="w-44" />
            <SkeletonButton className="w-32" />
            <SkeletonButton className="w-28" />
          </div>
        </div>
      </div>
    ))}
  </SkeletonGroup>
);

/* ---- Executions & audit (tables and logs) ----------------------------------------------------------- */

export const ExecutionsTableSkeleton: React.FC = () => (
  <SkeletonGroup label="Loading runs…" className="da-card overflow-hidden">
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[13px]" aria-hidden>
        <thead className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
          <tr>
            <th className="py-3 px-3 sm:px-4">Run</th>
            <th className="py-3 px-3 sm:px-4">Automation</th>
            <th className="py-3 px-3 sm:px-4">Status</th>
            <th className="py-3 px-3 sm:px-4 hidden md:table-cell">Publishes</th>
            <th className="py-3 px-4 hidden xl:table-cell">Took</th>
            <th className="py-3 px-4 hidden xl:table-cell">Retries</th>
            <th className="py-3 px-4 hidden lg:table-cell">Record</th>
            <th className="py-3 px-3 sm:px-4 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {range(7).map((i) => {
            const d = i * 0.06;
            return (
              <tr key={i}>
                <td className="py-3.5 px-3 sm:px-4"><Skeleton className="h-3.5 w-10" delay={d} /><Skeleton className="mt-1.5 h-2.5 w-16" /></td>
                <td className="py-3.5 px-3 sm:px-4"><Skeleton className={`h-3.5 ${i % 2 ? "w-32" : "w-44"}`} delay={d} /><Skeleton className="mt-1.5 h-2.5 w-20" /></td>
                <td className="py-3.5 px-3 sm:px-4"><SkeletonChip className={i % 3 ? "w-20" : "w-28"} /></td>
                <td className="py-3.5 px-3 sm:px-4 hidden md:table-cell"><Skeleton className="h-3 w-24" delay={d} /><Skeleton className="mt-1.5 h-2.5 w-14" /></td>
                <td className="py-3.5 px-4 hidden xl:table-cell"><Skeleton className="h-3 w-12" /><Skeleton className="mt-1.5 h-2.5 w-14" /></td>
                <td className="py-3.5 px-4 hidden xl:table-cell"><Skeleton className="h-3 w-6" /></td>
                <td className="py-3.5 px-4 hidden lg:table-cell"><Skeleton accent className="h-3 w-10" /></td>
                <td className="py-3.5 px-3 sm:px-4"><SkeletonButton size="sm" className="ml-auto w-20" /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  </SkeletonGroup>
);

/** The audit log, or Orbit's activity, inside its card. */
export const AuditListSkeleton: React.FC<{ variant?: "events" | "orbit"; label?: string }> = ({ variant = "events", label = "Loading the audit log…" }) => (
  <SkeletonGroup label={label}>
    <ul className="divide-y divide-slate-100">
      {range(8).map((i) => (
        <li key={i} className="flex flex-col gap-1.5 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          {variant === "orbit" ? (
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <Skeleton accent className="h-4 w-4 rounded-full" />
                <Skeleton className={`h-3.5 ${i % 2 ? "w-32" : "w-44"}`} delay={i * 0.06} />
                {i % 3 === 0 && <SkeletonChip className="w-24" />}
              </span>
              <Skeleton className={`mt-2 h-3 ${lineAt(i + 2)}`} />
              <Skeleton className="mt-1.5 h-2.5 w-48" />
            </span>
          ) : (
            <span className="flex min-w-0 flex-1 items-center gap-3">
              <SkeletonChip className="w-16" />
              <span className="min-w-0 flex-1">
                <Skeleton className={`h-3.5 ${lineAt(i)}`} delay={i * 0.06} />
                {i % 3 === 1 && <Skeleton className="mt-1.5 h-3 w-48" />}
              </span>
            </span>
          )}
          <Skeleton className="h-3 w-16 shrink-0" />
        </li>
      ))}
    </ul>
  </SkeletonGroup>
);

/* ---- Knowledge base ------------------------------------------------------------------------------ */

export const DocumentListSkeleton: React.FC<{ count?: number }> = ({ count = 4 }) => (
  <SkeletonGroup label="Loading documents…" className="space-y-2.5">
    {range(count).map((i) => (
      <div key={i} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-3.5">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Skeleton accent className="h-10 w-10 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1">
            <Skeleton className={`h-3.5 ${lineAt(i + 4)}`} delay={i * 0.08} />
            <Skeleton className="mt-2 h-2.5 w-full max-w-[16rem]" />
          </div>
        </div>
        <div className="ml-4 flex shrink-0 items-center gap-2">
          <SkeletonChip className="w-16" />
          <Skeleton className="h-8 w-8 rounded-full" />
        </div>
      </div>
    ))}
  </SkeletonGroup>
);

/* ---- Schema explorer ------------------------------------------------------------------------------ */

export const SchemaExplorerSkeleton: React.FC<{ label?: string }> = ({ label = "Reading tables, columns, keys and relationships…" }) => (
  <SkeletonGroup label={label} className="space-y-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap gap-1 rounded-2xl bg-slate-100/90 p-1">
        {["w-20", "w-20", "w-16", "w-14"].map((w, i) => (
          <span key={i} className={`flex h-9 items-center gap-2 rounded-xl px-3.5 ${i === 0 ? "bg-white shadow-xs" : ""}`}>
            <Skeleton className="h-3.5 w-3.5 rounded" />
            <Skeleton className={`h-3 ${w}`} />
            <Skeleton accent className="h-4 w-5 rounded-full" />
          </span>
        ))}
      </div>
      <Skeleton className="h-[42px] w-full rounded-xl sm:w-72" />
    </div>
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
      <div className="da-card p-2.5">
        <div className="flex items-center justify-between px-3 pb-3 pt-2">
          <Skeleton className="h-2.5 w-20" />
          <Skeleton className="h-2.5 w-16" />
        </div>
        <div className="space-y-0.5">
          {range(8).map((i) => (
            <div key={i} className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 ${i === 0 ? "bg-indigo-50/70" : ""}`}>
              <span className="flex min-w-0 flex-1 items-start gap-2">
                <Skeleton className="mt-0.5 h-4 w-4 shrink-0 rounded" />
                <span className="min-w-0 flex-1">
                  <Skeleton className={`h-3 ${widthAt(i + 1)}`} delay={i * 0.05} />
                  <Skeleton className="mt-1.5 h-2.5 w-24" />
                </span>
              </span>
              <SkeletonChip className="w-12" />
            </div>
          ))}
        </div>
      </div>
      <div className="da-card min-w-0 space-y-6 p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <Skeleton className="h-6 w-48 rounded-lg" />
            <SkeletonChip className="w-24" />
          </div>
          <div className="flex flex-wrap gap-2">
            <SkeletonButton className="w-40" />
            <SkeletonButton className="w-32" />
          </div>
        </div>
        <div className="-mt-3 space-y-2.5">
          <div className="flex flex-wrap gap-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 w-24" />
            <SkeletonChip className="w-24" />
          </div>
          <Skeleton className="h-3.5 w-80 max-w-full" />
        </div>
        <div className="overflow-hidden rounded-2xl border border-slate-200">
          <SkeletonTable cols={["w-28", "w-20", "w-12", "w-24"]} hide={[undefined, undefined, "hidden sm:table-cell", "hidden md:table-cell"]} rows={6} />
        </div>
      </div>
    </div>
  </SkeletonGroup>
);

/* ---- Data explorer --------------------------------------------------------------------------------- */

/** The table list in the Data page's sidebar. */
export const DataTablesSkeleton: React.FC = () => (
  <SkeletonGroup label="Reading the tables…" className="space-y-0.5">
    {range(7).map((i) => (
      <div key={i} className="flex items-center justify-between gap-2 rounded-xl px-2.5 py-2">
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <Skeleton className="h-3.5 w-3.5 shrink-0 rounded" />
          <Skeleton className={`h-3 ${widthAt(i)}`} delay={i * 0.05} />
        </span>
        <Skeleton className="h-2.5 w-8 shrink-0" />
      </div>
    ))}
  </SkeletonGroup>
);

/** Rows of a table in the Data page. */
export const DataRowsSkeleton: React.FC<{ columns?: number }> = ({ columns = 5 }) => (
  <SkeletonGroup label="Loading rows…" className="overflow-x-auto">
    <SkeletonTable
      cols={range(columns).map((i) => (i === 0 ? "w-10" : widthAt(i)))}
      hide={range(columns).map((i) => (i >= 4 ? "hidden md:table-cell" : undefined))}
      rows={8}
      cellClassName="px-3 py-3"
      headClassName="px-3 py-3"
    />
  </SkeletonGroup>
);

/** The whole Data page while the connections load. */
export const DataPageSkeleton: React.FC = () => (
  <SkeletonGroup label="Loading your tables…" className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
    <aside className="da-card h-fit p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <Skeleton className="h-9 flex-1 rounded-xl" />
        <Skeleton className="h-9 w-9 rounded-full" />
      </div>
      <DataTablesSkeleton />
    </aside>
    <section className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-10 w-72 rounded-2xl" />
        <div className="flex gap-2">
          <SkeletonButton size="sm" className="w-32" />
          <SkeletonButton size="sm" className="w-24" />
        </div>
      </div>
      <div className="da-card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-slate-100 p-3">
          <Skeleton className="h-9 flex-1 rounded-xl" />
          <Skeleton className="h-9 w-9 rounded-full" />
        </div>
        <DataRowsSkeleton />
      </div>
    </section>
  </SkeletonGroup>
);

/** Autopilot schedules of a table. */
export const AutopilotSkeleton: React.FC = () => (
  <SkeletonGroup label="Loading autopilot…" className="space-y-4">
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <SkeletonText lines={2} className="max-w-xl flex-1" lineClassName="h-3" last="w-1/2" />
      <SkeletonButton size="sm" className="w-32" />
    </div>
    <ul className="space-y-2.5">
      {range(2).map((i) => (
        <li key={i} className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <Skeleton className="h-3.5 w-40" delay={i * 0.1} />
              <SkeletonChip className="w-10" />
            </span>
            <Skeleton className="mt-2 h-3 w-64 max-w-full" />
            <Skeleton className="mt-1.5 h-3 w-48" />
          </div>
          <div className="flex shrink-0 gap-1.5">
            <SkeletonButton size="sm" className="w-20" />
            <SkeletonButton size="sm" className="w-20" />
            <SkeletonButton size="sm" className="w-20" />
          </div>
        </li>
      ))}
    </ul>
  </SkeletonGroup>
);

/* ---- Forms ---------------------------------------------------------------------------------------- */

/** Manual publishing: where, what and when. */
export const ManualScheduleSkeleton: React.FC<{ label?: string }> = ({ label = "Reading the table…" }) => (
  <SkeletonGroup label={label} className="space-y-6">
    <div className="da-card space-y-5 p-6 sm:p-7">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <SkeletonSectionTitle width="w-48" />
        <SkeletonButton size="sm" className="w-32" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SkeletonField label="w-16" />
        <span>
          <SkeletonField label="w-12" />
          <Skeleton className="mt-2.5 h-3 w-4/5" />
        </span>
      </div>
    </div>
    <div className="da-card space-y-7 p-6 sm:p-7">
      <SkeletonSectionTitle width="w-64" help />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {range(4).map((i) => <SkeletonField key={i} label={i % 2 ? "w-20" : "w-28"} />)}
      </div>
      <SkeletonField label="w-24" tall />
    </div>
    <div className="da-card space-y-5 p-6 sm:p-7">
      <SkeletonSectionTitle width="w-56" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {range(2).map((i) => (
          <div key={i} className={`flex items-center gap-3 rounded-2xl border p-4 ${i === 0 ? "border-indigo-200 bg-indigo-50/40" : "border-slate-200"}`}>
            <Skeleton accent={i === 0} className="h-4 w-4 shrink-0 rounded-full" />
            <span className="min-w-0 flex-1">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="mt-2 h-3 w-4/5" />
            </span>
          </div>
        ))}
      </div>
    </div>
    <div className="flex justify-end gap-2">
      <SkeletonButton className="w-52" />
    </div>
  </SkeletonGroup>
);

/** Step 1 of the automation builder while the connections load: templates, then the plan box. */
export const BuilderStartSkeleton: React.FC = () => (
  <SkeletonGroup label="Loading your database connections…" className="space-y-6">
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
      {range(6).map((i) => (
        <div key={i} className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="mb-2.5 flex items-center justify-between">
            <SkeletonChip className="w-16" />
            <Skeleton className="h-3.5 w-3.5 rounded" />
          </div>
          <Skeleton className={`h-3.5 ${widthAt(i)}`} delay={i * 0.06} />
          <SkeletonText lines={2} className="mt-2" lineClassName="h-2.5" last="w-2/3" />
        </div>
      ))}
    </div>
    <div className="space-y-3 rounded-3xl border border-indigo-100 bg-gradient-to-br from-indigo-50/60 via-white to-violet-50/50 p-4 sm:p-5">
      <span className="flex items-center gap-2">
        <Skeleton accent className="h-7 w-7 rounded-lg" />
        <Skeleton className="h-3.5 w-56" />
      </span>
      <Skeleton className="h-16 w-full rounded-xl" />
      <SkeletonButton className="ml-auto w-48" />
    </div>
    <SkeletonField label="w-14" />
  </SkeletonGroup>
);

/* ---- Account & AI settings ---------------------------------------------------------------------- */

/** AI usage totals and the two breakdown tables. */
export const UsageSkeleton: React.FC = () => (
  <SkeletonGroup label="Adding up your AI usage…" className="space-y-4">
    <SkeletonText lines={2} lineClassName="h-3.5" last="w-3/4" />
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {range(2).map((i) => (
        <div key={i} className="overflow-hidden rounded-xl border border-slate-200">
          <SkeletonTable cols={["w-28", "w-8", "w-14"]} rows={3} cellClassName="px-4 py-3" />
        </div>
      ))}
    </div>
  </SkeletonGroup>
);

const FormCard: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="da-card space-y-5 p-6">
    <SkeletonSectionTitle width={title} />
    {children}
  </div>
);

export const AccountSettingsSkeleton: React.FC = () => (
  <SkeletonGroup label="Loading your account…" className="space-y-6">
    <FormCard title="w-20">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SkeletonField label="w-12" />
        <SkeletonField label="w-12" />
        <span className="sm:col-span-2">
          <Skeleton className="mb-2.5 h-3 w-20" />
          <span className="flex items-center gap-2">
            <Skeleton className="h-4 w-4 rounded" />
            <Skeleton className="h-3 w-64" />
          </span>
          <Skeleton className="mt-2.5 h-3 w-4/5" />
        </span>
      </div>
      <SkeletonButton className="ml-auto w-32" />
    </FormCard>
    <FormCard title="w-24">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {["w-28", "w-24", "w-36"].map((w) => <SkeletonField key={w} label={w} />)}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex items-center gap-2">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-3 w-40" />
        </span>
        <SkeletonButton className="w-40" />
      </div>
    </FormCard>
    <div className="da-card p-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <SkeletonSectionTitle width="w-48" />
        <SkeletonButton size="sm" className="w-36" />
      </div>
      <SkeletonListRows rows={2} trailing="button" className="divide-y divide-slate-100" rowClassName="py-3" />
    </div>
    <div className="da-card p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <SkeletonSectionTitle width="w-24" />
        <Skeleton className="h-10 w-56 rounded-2xl" />
      </div>
      <UsageSkeleton />
    </div>
  </SkeletonGroup>
);

/** "Which model does which job" on the AI providers page. */
export const ModelRolesSkeleton: React.FC = () => (
  <SkeletonGroup label="Loading which model does which job…" className="space-y-4">
    <div>
      <span className="flex items-center gap-2">
        <span className="h-px w-5 bg-indigo-500/40" />
        <Skeleton accent className="h-2.5 w-20 rounded-full" />
      </span>
      <Skeleton className="mt-3 h-6 w-72 max-w-full rounded-lg" />
      <Skeleton className="mt-2.5 h-3.5 w-full max-w-xl" />
    </div>
    <Skeleton className="h-[74px] w-full rounded-2xl" />
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {range(2).map((i) => (
        <div key={i} className="da-card space-y-4 p-5">
          <div className="flex items-center gap-3">
            <SkeletonTile size="lg" />
            <Skeleton className="h-4 w-36" delay={i * 0.1} />
          </div>
          <SkeletonText lines={2} lineClassName="h-3" last="w-3/4" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SkeletonField label="w-16" />
            <SkeletonField label="w-12" />
          </div>
          <div>
            <div className="mb-2.5 flex justify-between">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-3 w-8" />
            </div>
            <Skeleton accent className="h-1.5 w-full rounded-full" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <SkeletonButton size="sm" className="w-20" />
            <SkeletonButton size="sm" className="w-24" />
          </div>
        </div>
      ))}
    </div>
  </SkeletonGroup>
);

/* ---- Modals ---------------------------------------------------------------------------------------- */

/** The body of a run's details while the full record loads: the content preview. */
export const ExecutionDetailSkeleton: React.FC = () => (
  <SkeletonGroup label="Opening the run…" className="space-y-4 py-1">
    <div className="rounded-2xl border border-slate-200 p-5">
      <div className="flex flex-wrap gap-1.5">
        <SkeletonChip className="w-20" />
        <SkeletonChip className="w-24" />
      </div>
      <Skeleton className="mt-4 h-6 w-2/3 rounded-lg" />
      <Skeleton className="mt-2.5 h-3 w-1/3" />
      <Skeleton className="mt-5 h-40 w-full rounded-2xl" />
      <SkeletonText lines={5} className="mt-5" lineClassName="h-3" last="w-2/5" />
    </div>
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {range(4).map((i) => (
        <div key={i} className="da-panel p-3">
          <Skeleton className="h-2.5 w-16" />
          <Skeleton className={`mt-2 h-3 ${widthAt(i)}`} />
        </div>
      ))}
    </div>
  </SkeletonGroup>
);

/** Orbit Remote's QR code while a one-time code is being made. */
export const PairingCodeSkeleton: React.FC = () => (
  <SkeletonGroup label="Making a one-time code…" className="grid items-start gap-6 md:grid-cols-[auto_1fr]">
    <div className="mx-auto flex flex-col items-center">
      <div className="rounded-[30px] bg-gradient-to-br from-indigo-500/40 via-violet-500/40 to-cyan-400/40 p-[2px]">
        <div className="relative rounded-[28px] bg-white p-4">
          <Skeleton className="h-[216px] w-[216px] rounded-xl" />
          {/* The three finder squares of a QR code */}
          {["left-7 top-7", "right-7 top-7", "bottom-7 left-7"].map((pos) => (
            <span key={pos} className={`absolute ${pos} grid h-12 w-12 place-items-center rounded-xl border-[5px] border-indigo-200/90`}>
              <span className="h-4 w-4 rounded-md bg-indigo-200/90" />
            </span>
          ))}
        </div>
      </div>
      <Skeleton className="mt-3 h-7 w-40 rounded-full" />
    </div>
    <div className="min-w-0 space-y-4">
      <ol className="space-y-3.5">
        {range(3).map((i) => (
          <li key={i} className="flex items-start gap-3">
            <SkeletonTile size="sm" />
            <span className="min-w-0 flex-1">
              <Skeleton className="h-3.5 w-48" delay={i * 0.08} />
              <Skeleton className="mt-2 h-3 w-full max-w-xs" />
            </span>
          </li>
        ))}
      </ol>
      <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5">
        <div className="flex justify-between">
          <Skeleton className="h-2.5 w-28" />
          <Skeleton className="h-2.5 w-16" />
        </div>
        <Skeleton className="mt-3 h-3.5 w-full" />
      </div>
    </div>
  </SkeletonGroup>
);
