import React, { createContext, useContext } from "react";
import { widthAt } from "./skeletonWidth";

/**
 * Skeleton loaders: placeholders in the shape of the content on its way, in the portal's design language
 * (rounded-3xl cards, pill chips and buttons, indigo-tinted icon tiles). Colours are tokens (index.css), so the
 * same markup works on white cards and on dark ink surfaces. Use them where data loads; actions keep their
 * spinners, and long server work keeps WorkProgress (it reports real steps).
 */

/** One placeholder block; size and shape come from className (h-*, w-*, rounded-*). */
export const Skeleton: React.FC<{ className?: string; accent?: boolean; delay?: number; style?: React.CSSProperties }> = ({
  className = "", accent = false, delay, style,
}) => (
  <span
    aria-hidden
    className={`da-skel ${accent ? "da-skel-accent" : ""} ${className}`}
    style={delay ? ({ ...style, "--skel-delay": `${delay}s` } as React.CSSProperties) : style}
  />
);

/** Lines of text; the last one is shorter, like the end of a real paragraph. */
export const SkeletonText: React.FC<{ lines?: number; className?: string; lineClassName?: string; last?: string }> = ({
  lines = 3, className = "", lineClassName = "h-3", last = "w-3/5",
}) => (
  <span className={`block space-y-2 ${className}`}>
    {Array.from({ length: lines }, (_, i) => (
      <Skeleton key={i} className={`${lineClassName} ${lines > 1 && i === lines - 1 ? last : "w-full"}`} />
    ))}
  </span>
);

const InGroup = createContext(false);

/**
 * Wraps a placeholder: tells screen readers what is loading, fades in, and picks light or dark tokens when the
 * surface underneath does not decide. A group inside another group stays silent, so a page is announced once.
 */
export const SkeletonGroup: React.FC<{
  label: string;
  children: React.ReactNode;
  className?: string;
  tone?: "light" | "dark";
  /** Off when this placeholder replaces an identical one (e.g. the app shell), so it does not blink. */
  fade?: boolean;
}> = ({ label, children, className = "", tone, fade = true }) => {
  const nested = useContext(InGroup);
  const toneCls = tone === "dark" ? "da-skel-dark" : tone === "light" ? "da-skel-light" : "";
  return (
    <InGroup.Provider value>
      <div
        {...(nested ? {} : { role: "status", "aria-live": "polite" as const, "aria-busy": true })}
        className={`${fade && !nested ? "da-skel-root" : ""} ${toneCls} ${className}`}
      >
        {!nested && <span className="sr-only">{label}</span>}
        {children}
      </div>
    </InGroup.Provider>
  );
};

/* ---- Building blocks, each the shape of a kit component ----------------------------------------------- */

/** IconTile (kit) / the gradient tiles on cards. */
export const SkeletonTile: React.FC<{ size?: "sm" | "md" | "lg" | "xl"; className?: string }> = ({ size = "md", className = "" }) => {
  const box = size === "sm" ? "h-8 w-8 rounded-xl" : size === "lg" ? "h-11 w-11 rounded-2xl" : size === "xl" ? "h-12 w-12 rounded-2xl" : "h-10 w-10 rounded-2xl";
  return <Skeleton accent className={`shrink-0 ${box} ${className}`} />;
};

/** A da-chip or StatusPill. */
export const SkeletonChip: React.FC<{ className?: string }> = ({ className = "w-16" }) => (
  <Skeleton className={`h-[22px] shrink-0 rounded-full ${className}`} />
);

/** A pill button (da-btn); `sm` matches da-btn-sm. */
export const SkeletonButton: React.FC<{ className?: string; size?: "sm" | "md" | "lg" }> = ({ className = "w-28", size = "md" }) => (
  <Skeleton className={`shrink-0 rounded-full ${size === "sm" ? "h-[30px]" : size === "lg" ? "h-11" : "h-9"} ${className}`} />
);

/** A labelled form field (da-label + da-input). */
export const SkeletonField: React.FC<{ className?: string; label?: string; tall?: boolean }> = ({ className = "", label = "w-24", tall = false }) => (
  <span className={`block ${className}`}>
    <Skeleton className={`mb-2 h-3 ${label}`} />
    <Skeleton className={`w-full rounded-xl ${tall ? "h-28" : "h-[42px]"}`} />
  </span>
);

/** PageHeader (kit): eyebrow, title, description and action buttons. */
export const SkeletonPageHeader: React.FC<{ actions?: number; description?: boolean; className?: string }> = ({
  actions = 1, description = true, className = "",
}) => (
  <div className={`mb-7 sm:mb-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between ${className}`}>
    <div className="min-w-0 flex-1">
      <span className="flex items-center gap-2">
        <span className="h-px w-5 bg-indigo-500/40" />
        <Skeleton accent className="h-2.5 w-20 rounded-full" />
      </span>
      <Skeleton className="mt-3 h-8 w-56 rounded-xl sm:h-9 sm:w-72" />
      {description && <SkeletonText lines={2} className="mt-3.5 max-w-2xl" lineClassName="h-3.5" last="w-2/3" />}
    </div>
    {actions > 0 && (
      <div className="flex flex-wrap items-center gap-2 lg:shrink-0">
        {Array.from({ length: actions }, (_, i) => <SkeletonButton key={i} className={i === 0 ? "w-32" : "w-28"} />)}
      </div>
    )}
  </div>
);

/** CardHeader (kit): small tile, title and description, optional actions on the right. */
export const SkeletonCardHeader: React.FC<{ description?: boolean; actions?: React.ReactNode; title?: string; className?: string }> = ({
  description = true, actions, title = "w-36", className = "",
}) => (
  <div className={`flex flex-wrap items-start justify-between gap-3 ${className}`}>
    <div className="flex min-w-0 flex-1 items-start gap-3">
      <SkeletonTile size="sm" />
      <div className="min-w-0 flex-1 pt-0.5">
        <Skeleton className={`h-4 ${title}`} />
        {description && <Skeleton className="mt-2 h-3 w-full max-w-[16rem]" />}
      </div>
    </div>
    {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
  </div>
);

/** A card section heading as used in forms: icon + bold title (+ a line of help). */
export const SkeletonSectionTitle: React.FC<{ width?: string; help?: boolean; className?: string }> = ({ width = "w-52", help = false, className = "" }) => (
  <div className={className}>
    <span className="flex items-center gap-2.5">
      <Skeleton accent className="h-4 w-4 rounded-md" />
      <Skeleton className={`h-[18px] ${width}`} />
    </span>
    {help && <Skeleton className="mt-2.5 h-3.5 w-full max-w-md" />}
  </div>
);

/** StatCard (kit). */
export const SkeletonStatCard: React.FC<{ delay?: number }> = ({ delay }) => (
  <div className="h-full rounded-3xl border border-slate-200/80 bg-white p-5 shadow-soft">
    <div className="flex items-start justify-between gap-3">
      <SkeletonTile />
      <Skeleton className="h-3.5 w-3.5 rounded" />
    </div>
    <Skeleton className="mt-5 h-[30px] w-16 rounded-lg" delay={delay} />
    <Skeleton className="mt-2.5 h-3.5 w-28" delay={delay} />
    <Skeleton className="mt-2 h-3 w-20" delay={delay} />
  </div>
);

/** Rows of a list card: optional leading tile or dot, two lines of text, something on the right. */
export const SkeletonListRows: React.FC<{
  rows?: number;
  lead?: "tile" | "dot" | "none";
  trailing?: "pill" | "button" | "text" | "none";
  className?: string;
  rowClassName?: string;
}> = ({ rows = 4, lead = "none", trailing = "pill", className = "divide-y divide-slate-100 px-2 pb-2", rowClassName = "px-3 py-3" }) => (
  <ul className={className}>
    {Array.from({ length: rows }, (_, i) => (
      <li key={i} className={`flex items-center justify-between gap-3 ${rowClassName}`}>
        <span className="flex min-w-0 flex-1 items-center gap-3">
          {lead === "tile" && <SkeletonTile size="sm" />}
          {lead === "dot" && <Skeleton accent className="h-2.5 w-2.5 shrink-0 rounded-full" />}
          <span className="min-w-0 flex-1">
            <Skeleton className={`h-3.5 ${widthAt(i)}`} delay={i * 0.08} />
            <Skeleton className={`mt-2 h-3 ${widthAt(i + 3)} max-w-[12rem]`} delay={i * 0.08} />
          </span>
        </span>
        {trailing === "pill" && <SkeletonChip className="w-20" />}
        {trailing === "button" && <SkeletonButton size="sm" className="w-24" />}
        {trailing === "text" && <Skeleton className="h-3 w-12 shrink-0" />}
      </li>
    ))}
  </ul>
);

/**
 * A table: real column headings when given (they never change), placeholder cells below. `cols` are the cell
 * widths of one row; `hide` the responsive classes of a column (the same as the real table's).
 */
export const SkeletonTable: React.FC<{
  headings?: string[];
  cols: string[];
  hide?: (string | undefined)[];
  rows?: number;
  className?: string;
  cellClassName?: string;
  headClassName?: string;
}> = ({ headings, cols, hide = [], rows = 6, className = "", cellClassName = "px-4 py-3.5", headClassName = "px-4 py-3" }) => (
  <table className={`w-full text-left text-[13px] ${className}`} aria-hidden>
    <thead className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
      <tr>
        {cols.map((_, c) => (
          <th key={c} className={`${headClassName} ${hide[c] ?? ""} ${c === cols.length - 1 && headings ? "text-right" : ""}`}>
            {headings ? headings[c] : <Skeleton className={`h-2.5 ${c % 2 ? "w-14" : "w-20"}`} />}
          </th>
        ))}
      </tr>
    </thead>
    <tbody className="divide-y divide-slate-100">
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r}>
          {cols.map((w, c) => (
            <td key={c} className={`${cellClassName} ${hide[c] ?? ""}`}>
              <Skeleton className={`h-3 ${w} ${c === cols.length - 1 && headings ? "ml-auto" : ""}`} delay={r * 0.06} />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  </table>
);
