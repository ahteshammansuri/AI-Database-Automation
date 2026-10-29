import React from "react";
import { Database, ShieldCheck } from "lucide-react";
import { NAV_GROUPS } from "../layout/navConfig";
import { Skeleton, SkeletonButton, SkeletonField, SkeletonGroup, SkeletonPageHeader, SkeletonSectionTitle, SkeletonText } from "./Skeleton";
import { lineAt, widthAt } from "./skeletonWidth";
import {
  AccountSettingsSkeleton, ApprovalListSkeleton, AuditListSkeleton, AutomationListSkeleton, BuilderStartSkeleton,
  ConnectionCardsSkeleton, DashboardSkeleton, DataPageSkeleton, DocumentListSkeleton, ExecutionsTableSkeleton, InkAurora,
  ManualScheduleSkeleton, ProviderCardsSkeleton, SchemaExplorerSkeleton,
} from "./PageSkeletons";

/**
 * Whole-screen placeholders for the first load, before the platform settings and the session are known (so
 * they read neither: no router hooks, no settings). Each one is the frame of the screen that is opening.
 */

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

/** The brand mark, as in the sidebar and on the landing page (decoration, not data). */
const BrandMark: React.FC<{ icon?: React.ElementType; className?: string }> = ({ icon: I = Database, className = "h-9 w-9 rounded-xl" }) => (
  <span aria-hidden className={`grid shrink-0 place-items-center bg-gradient-to-br from-indigo-500 via-violet-500 to-cyan-400 text-white shadow-[0_8px_24px_-8px_rgba(99,102,241,0.8)] ${className}`}>
    <I className="h-[18px] w-[18px]" />
  </span>
);

/* ---- Portal -------------------------------------------------------------------------------------- */

/** The content of a portal page while the app opens, in the layout of the page at `path`. */
const portalPage = (path: string): React.ReactNode => {
  const header = (actions = 1) => <SkeletonPageHeader actions={actions} />;
  switch (path) {
    case "/dashboard":
      return <DashboardSkeleton />;
    case "/connections":
      return <>{header()}<ConnectionCardsSkeleton /></>;
    case "/explorer":
      return <>{header(2)}<SchemaExplorerSkeleton /></>;
    case "/data":
      return <>{header()}<DataPageSkeleton /></>;
    case "/automations":
      return <>{header()}<AutomationListSkeleton /></>;
    case "/automations/new":
      return (
        <>
          {header()}
          <div className="da-card space-y-6 p-5 sm:p-8">
            <SkeletonSectionTitle width="w-72" help />
            <BuilderStartSkeleton />
          </div>
        </>
      );
    case "/manual-schedule":
      return <>{header()}<ManualScheduleSkeleton /></>;
    case "/approvals":
      return <>{header()}<ApprovalListSkeleton /></>;
    case "/knowledge":
      return (
        <>
          {header(0)}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="da-card space-y-4 p-6">
              <SkeletonSectionTitle width="w-32" />
              <Skeleton className="h-36 w-full rounded-2xl" />
              <SkeletonField label="w-12" />
              <SkeletonButton className="w-full" />
            </div>
            <div className="da-card p-6 lg:col-span-2">
              <SkeletonSectionTitle width="w-44" />
              <div className="mt-5"><DocumentListSkeleton /></div>
            </div>
          </div>
        </>
      );
    case "/ai-providers":
      return (
        <>
          {header()}
          <section className="da-ink mb-6 p-6 sm:p-8">
            <InkAurora a="bg-emerald-500/20" b="bg-indigo-600/30" />
            <div className="relative grid gap-6 lg:grid-cols-[1.1fr_1fr] lg:items-center">
              <div>
                <Skeleton className="h-[26px] w-40 rounded-full" />
                <Skeleton className="mt-4 h-6 w-4/5 rounded-lg" />
                <SkeletonText lines={2} className="mt-3 max-w-xl" lineClassName="h-3.5" />
              </div>
              <Skeleton className="h-36 w-full rounded-2xl" />
            </div>
          </section>
          <ProviderCardsSkeleton />
        </>
      );
    case "/executions":
      return <>{header(2)}<ExecutionsTableSkeleton /></>;
    case "/audit-logs":
      return <>{header(2)}<div className="da-card overflow-hidden"><AuditListSkeleton /></div></>;
    case "/account":
      return <div className="mx-auto max-w-4xl">{header(0)}<AccountSettingsSkeleton /></div>;
    default:
      return (
        <>
          {header(0)}
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {range(4).map((i) => (
              <div key={i} className="da-card space-y-4 p-6">
                <SkeletonSectionTitle width={widthAt(i)} />
                <SkeletonText lines={3} lineClassName="h-3" />
              </div>
            ))}
          </div>
        </>
      );
  }
};

/** The ink sidebar: brand, the real navigation groups as placeholders (the page opening is highlighted), guardrails. */
const SidebarSkeleton: React.FC<{ path: string }> = ({ path }) => (
  <aside className="relative hidden w-[264px] shrink-0 flex-col overflow-hidden bg-ink lg:flex">
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <div className="landing-blob absolute -top-24 -left-24 h-72 w-72 rounded-full bg-indigo-600/30" />
      <div className="landing-blob absolute bottom-10 -right-28 h-72 w-72 rounded-full bg-violet-600/20" style={{ animationDelay: "-8s" }} />
      <div className="absolute inset-0 landing-grid opacity-60" />
    </div>
    <div className="relative flex items-center gap-2.5 px-5 pt-5 pb-4">
      <BrandMark />
      <span>
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="mt-2 h-2.5 w-32" />
      </span>
    </div>
    <nav className="relative flex-1 space-y-5 overflow-hidden px-3 pb-4 pt-2">
      {NAV_GROUPS.map((group, g) => (
        <div key={group.label}>
          <Skeleton className="mx-3 mb-3 h-2 w-16 rounded-full" />
          <div className="space-y-0.5">
            {group.items.map((item, i) => (
              <div
                key={item.to}
                className={`relative flex items-center gap-3 rounded-xl border px-3 py-2.5 ${
                  item.to === path ? "border-white/10 bg-white/[0.07]" : "border-transparent"
                }`}
              >
                {item.to === path && <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-gradient-to-b from-indigo-400 via-violet-400 to-cyan-300" />}
                <Skeleton accent={item.to === path} className="h-[17px] w-[17px] shrink-0 rounded-md" />
                <Skeleton className={`h-3 ${widthAt(i + g * 2)}`} delay={(g * 4 + i) * 0.04} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </nav>
    <div className="relative p-3">
      <div className="flex items-center gap-2.5 rounded-2xl border border-white/10 bg-white/[0.04] p-3.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-emerald-500/15 text-emerald-300">
          <ShieldCheck className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-2 h-2.5 w-36" />
        </span>
      </div>
    </div>
  </aside>
);

/** The glass top bar: breadcrumb on the left; live status, refresh, create and account on the right. */
const NavbarSkeleton: React.FC = () => (
  <header className="relative z-20 flex h-16 shrink-0 items-center justify-between gap-2 border-b border-slate-200/70 bg-white/75 px-3 backdrop-blur-xl sm:px-6">
    <div className="flex min-w-0 items-center gap-2 sm:gap-3">
      <Skeleton className="h-9 w-9 rounded-full lg:hidden" />
      <Skeleton className="hidden h-7 w-7 rounded-lg sm:block" />
      <Skeleton className="hidden h-3 w-20 md:block" />
      <Skeleton className="h-3.5 w-28" />
    </div>
    <div className="flex shrink-0 items-center gap-1.5 sm:gap-2.5">
      <Skeleton className="hidden h-[26px] w-16 rounded-full sm:block" />
      <Skeleton className="h-9 w-9 rounded-full" />
      <Skeleton className="h-9 w-11 rounded-full sm:w-40" />
      <Skeleton accent className="h-8 w-8 rounded-full" />
      <Skeleton className="hidden h-3 w-24 md:block" />
    </div>
  </header>
);

/** The signed-in portal while the app opens: the layout's frame around the placeholder of the page at `path`. */
export const PortalShellSkeleton: React.FC<{ path: string; fade?: boolean }> = ({ path, fade = true }) => (
  <SkeletonGroup label="Opening your workspace…" fade={fade} className="flex h-screen overflow-hidden bg-canvas">
    <SidebarSkeleton path={path} />
    <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-80 portal-canvas-grid" />
      <div aria-hidden className="pointer-events-none absolute -top-40 right-0 h-80 w-[36rem] rounded-full bg-indigo-400/10 blur-3xl" />
      <NavbarSkeleton />
      <main className="relative flex-1 overflow-hidden px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10">
        <div className="mx-auto max-w-7xl space-y-6">{portalPage(path)}</div>
      </main>
    </div>
  </SkeletonGroup>
);

/* ---- Public pages -------------------------------------------------------------------------------- */

/** The landing page: navigation, hero and the product stage, on ink. */
export const LandingSkeleton: React.FC = () => (
  <SkeletonGroup label="Loading…" tone="dark" className="relative min-h-screen overflow-hidden bg-[#060914]">
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <div className="landing-blob absolute -top-40 -left-32 h-[42rem] w-[42rem] rounded-full bg-indigo-600/35" />
      <div className="landing-blob absolute top-20 -right-40 h-[36rem] w-[36rem] rounded-full bg-violet-600/30" style={{ animationDelay: "-6s" }} />
      <div className="absolute inset-0 landing-grid" />
    </div>
    <nav className="relative mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
      <span className="flex items-center gap-2.5">
        <BrandMark />
        <Skeleton className="h-4 w-24" />
      </span>
      <span className="hidden items-center gap-7 md:flex">
        {range(5).map((i) => <Skeleton key={i} className="h-3 w-16" />)}
      </span>
      <span className="flex items-center gap-2">
        <Skeleton className="hidden h-9 w-20 rounded-full sm:block" />
        <Skeleton accent className="h-9 w-28 rounded-full" />
      </span>
    </nav>
    <div className="relative mx-auto max-w-7xl px-4 pb-24 pt-16 text-center sm:px-6 sm:pt-24">
      <Skeleton className="mx-auto h-9 w-72 max-w-full rounded-full" />
      <Skeleton className="mx-auto mt-7 h-11 w-[78%] max-w-3xl rounded-2xl sm:h-16 lg:h-20" />
      <Skeleton accent className="mx-auto mt-3 h-11 w-[62%] max-w-2xl rounded-2xl sm:h-16 lg:h-20" />
      <div className="mx-auto mt-7 max-w-2xl space-y-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="mx-auto h-4 w-3/4" />
      </div>
      <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Skeleton accent className="h-[52px] w-full rounded-full sm:w-48" />
        <Skeleton className="h-[52px] w-full rounded-full sm:w-44" />
      </div>
      <div className="mt-9 flex flex-wrap items-center justify-center gap-x-7 gap-y-3">
        {range(3).map((i) => <Skeleton key={i} className="h-3.5 w-36" />)}
      </div>
      <div className="relative mx-auto mt-16 max-w-6xl overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.03] p-3 text-left sm:mt-20">
        <div className="flex items-center gap-1.5 px-2 pb-3 pt-1">
          {range(3).map((i) => <span key={i} className="h-2.5 w-2.5 rounded-full bg-white/10" />)}
          <Skeleton className="ml-3 h-5 w-64 max-w-[60%] rounded-full" />
        </div>
        <div className="grid h-[22rem] gap-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 sm:h-[26rem] sm:grid-cols-[180px_1fr]">
          <div className="hidden space-y-2.5 sm:block">
            {range(7).map((i) => <Skeleton key={i} className={`h-7 rounded-lg ${i === 0 ? "w-full" : widthAt(i)}`} accent={i === 0} />)}
          </div>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              {range(3).map((i) => <Skeleton key={i} className="h-20 rounded-2xl" delay={i * 0.1} />)}
            </div>
            <Skeleton accent className="h-40 rounded-2xl" />
            <div className="grid grid-cols-2 gap-3">
              <Skeleton className="h-16 rounded-2xl" />
              <Skeleton className="h-16 rounded-2xl" />
            </div>
          </div>
        </div>
      </div>
    </div>
  </SkeletonGroup>
);

/** Sign-in and registration: the ink brand panel beside the light form. */
export const AuthSkeleton: React.FC<{ fields?: number }> = ({ fields = 2 }) => (
  <SkeletonGroup label="Loading…" className="flex min-h-screen bg-canvas">
    <aside className="relative hidden w-[46%] max-w-[640px] overflow-hidden bg-ink p-10 lg:flex lg:flex-col">
      <InkAurora />
      <span className="relative flex items-center gap-2.5">
        <BrandMark className="h-10 w-10 rounded-xl" />
        <Skeleton className="h-4 w-28" />
      </span>
      <div className="relative mt-auto">
        <Skeleton accent className="h-28 w-28 rounded-full" />
        <Skeleton className="mt-7 h-8 w-4/5 rounded-xl" />
        <Skeleton accent className="mt-3 h-8 w-3/5 rounded-xl" />
        <SkeletonText lines={2} className="mt-5 max-w-md" lineClassName="h-3.5" last="w-2/3" />
        <ul className="mt-8 space-y-3.5">
          {range(3).map((i) => (
            <li key={i} className="flex items-center gap-3">
              <Skeleton accent className="h-4 w-4 rounded" />
              <Skeleton className={`h-3.5 ${lineAt(i + 1)}`} />
            </li>
          ))}
        </ul>
      </div>
    </aside>
    <main className="relative flex flex-1 items-center justify-center px-5 py-12 sm:px-10">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-80 portal-canvas-grid" />
      <div className="relative w-full max-w-[420px]">
        <Skeleton className="h-9 w-56 rounded-xl" />
        <Skeleton className="mt-3.5 h-4 w-72 max-w-full" />
        <div className="mt-8 space-y-5">
          {range(fields).map((i) => <SkeletonField key={i} label={i % 2 ? "w-20" : "w-14"} />)}
          <Skeleton className="h-[46px] w-full rounded-full" />
        </div>
        <Skeleton className="mx-auto mt-8 h-3.5 w-52" />
      </div>
    </main>
  </SkeletonGroup>
);

/** The emailed review link: ink header with the automation's name, then the draft and the decision. */
export const ApprovalReviewSkeleton: React.FC = () => (
  <SkeletonGroup label="Opening the draft…" className="min-h-screen bg-canvas">
    <div className="relative overflow-hidden bg-ink px-4 pb-24 pt-8 sm:px-6">
      <InkAurora />
      <div className="relative mx-auto max-w-3xl">
        <span className="flex items-center gap-2.5">
          <BrandMark icon={ShieldCheck} />
          <Skeleton className="h-4 w-24" />
        </span>
        <div className="mt-8 flex flex-wrap gap-2">
          <Skeleton className="h-[26px] w-44 rounded-full" />
          <Skeleton className="h-[26px] w-20 rounded-full" />
        </div>
        <Skeleton className="mt-5 h-8 w-2/3 rounded-xl sm:h-9" />
      </div>
    </div>
    <div className="relative mx-auto -mt-16 max-w-3xl space-y-4 px-4 pb-12 sm:px-6">
      <div className="da-card grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
        {range(2).map((i) => (
          <div key={i} className="flex items-start gap-3 rounded-2xl bg-slate-50/80 p-3.5">
            <Skeleton accent className="mt-0.5 h-4 w-4 shrink-0 rounded" />
            <span className="min-w-0 flex-1">
              <Skeleton className="h-3.5 w-4/5" />
              <Skeleton className="mt-2 h-3 w-3/5" />
            </span>
          </div>
        ))}
      </div>
      <div className="da-card p-5 sm:p-6">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="mt-4 h-7 w-3/4 rounded-lg" />
        <Skeleton className="mt-5 h-48 w-full rounded-2xl" />
        <SkeletonText lines={6} className="mt-5" lineClassName="h-3" last="w-2/5" />
      </div>
      <div className="da-card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-7">
        <span>
          <Skeleton className="h-5 w-32" />
          <Skeleton className="mt-2.5 h-3 w-60" />
        </span>
        <span className="flex gap-2">
          <SkeletonButton size="lg" className="w-36" />
          <SkeletonButton size="lg" className="w-40" />
        </span>
      </div>
    </div>
  </SkeletonGroup>
);

/** Orbit Remote on a phone. */
const RemoteSkeleton: React.FC = () => (
  <SkeletonGroup label="Loading…" className="grid min-h-screen place-items-center bg-ink px-6">
    <div className="flex flex-col items-center">
      <Skeleton accent className="h-36 w-36 rounded-full" />
      <Skeleton className="mt-8 h-5 w-40 rounded-lg" />
      <Skeleton className="mt-3 h-3.5 w-56" />
    </div>
  </SkeletonGroup>
);

/** The first screen while the platform settings load, chosen from the address being opened. */
export const BootSkeleton: React.FC<{ path: string }> = ({ path }) => {
  if (path === "/") return <LandingSkeleton />;
  if (path === "/login") return <AuthSkeleton />;
  if (path === "/register") return <AuthSkeleton fields={4} />;
  if (path.startsWith("/approvals/")) return <ApprovalReviewSkeleton />;
  if (path.startsWith("/orbit/remote")) return <RemoteSkeleton />;
  return <PortalShellSkeleton path={path} />;
};
