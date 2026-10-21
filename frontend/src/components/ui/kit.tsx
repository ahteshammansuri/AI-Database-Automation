import React, { useEffect } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertCircle, ArrowUpRight, X } from "lucide-react";
import { SpotlightCard } from "../landing/primitives";

/**
 * Portal UI kit, in the same design language as the landing page: ink surfaces, white rounded-3xl
 * cards with soft indigo shadows, uppercase eyebrows, tight extrabold headings and pill buttons.
 */

const EASE = [0.16, 1, 0.3, 1] as const;

const TONES = {
  indigo: "bg-indigo-50 text-indigo-600",
  violet: "bg-violet-50 text-violet-600",
  emerald: "bg-emerald-50 text-emerald-600",
  amber: "bg-amber-50 text-amber-600",
  rose: "bg-rose-50 text-rose-600",
  sky: "bg-sky-50 text-sky-600",
  cyan: "bg-cyan-50 text-cyan-600",
  slate: "bg-slate-100 text-slate-600",
} as const;
export type Tone = keyof typeof TONES;

/** Rounded icon tile used in headers, stats and empty states. */
export const IconTile: React.FC<{ icon: React.ElementType; tone?: Tone; size?: "sm" | "md" | "lg"; className?: string }> = ({
  icon: I, tone = "indigo", size = "md", className = "",
}) => {
  const box = size === "sm" ? "w-8 h-8 rounded-xl" : size === "lg" ? "w-12 h-12 rounded-2xl" : "w-10 h-10 rounded-2xl";
  const ico = size === "sm" ? "w-4 h-4" : size === "lg" ? "w-6 h-6" : "w-5 h-5";
  return (
    <span className={`grid shrink-0 place-items-center ${box} ${TONES[tone]} ${className}`}>
      <I className={ico} />
    </span>
  );
};

/** The page title block. Renders the page's <h1> (Orbit lands beside it when it arrives on a page). */
export const PageHeader: React.FC<{
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}> = ({ eyebrow, title, description, actions, className = "" }) => {
  const reduced = useReducedMotion();
  return (
    <motion.header
      initial={reduced ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease: EASE }}
      className={`mb-7 sm:mb-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between ${className}`}
    >
      <div className="min-w-0">
        {eyebrow && (
          <span className="da-eyebrow">
            <span className="h-px w-5 bg-indigo-500/50" />
            {eyebrow}
          </span>
        )}
        <h1 className="mt-2 text-[26px] sm:text-[32px] font-extrabold leading-[1.1] tracking-[-0.035em] text-slate-950">{title}</h1>
        {description && <p className="mt-2.5 max-w-2xl text-[14.5px] leading-relaxed text-slate-600">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 lg:shrink-0">{actions}</div>}
    </motion.header>
  );
};

/** White card; `interactive` adds the landing page's spotlight + lift on hover. */
export const Card: React.FC<{
  children: React.ReactNode;
  className?: string;
  interactive?: boolean;
  padded?: boolean;
} & React.HTMLAttributes<HTMLDivElement>> = ({ children, className = "", interactive = false, padded = true, ...rest }) =>
  interactive ? (
    <SpotlightCard className={`shadow-soft ${className}`}>
      <div className={padded ? "p-5 sm:p-6" : ""}>{children}</div>
    </SpotlightCard>
  ) : (
    <div {...rest} className={`da-card ${padded ? "p-5 sm:p-6" : ""} ${className}`}>
      {children}
    </div>
  );

/** Header row inside a card: icon + title (+ description) on the left, actions on the right. */
export const CardHeader: React.FC<{
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ElementType;
  tone?: Tone;
  actions?: React.ReactNode;
  className?: string;
}> = ({ title, description, icon, tone = "indigo", actions, className = "" }) => (
  <div className={`flex flex-wrap items-start justify-between gap-3 ${className}`}>
    <div className="flex min-w-0 items-start gap-3">
      {icon && <IconTile icon={icon} tone={tone} size="sm" />}
      <div className="min-w-0">
        <h3 className="da-card-title">{title}</h3>
        {description && <p className="mt-0.5 text-[12.5px] leading-relaxed text-slate-500">{description}</p>}
      </div>
    </div>
    {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
  </div>
);

/** A headline number with an icon; links somewhere when `to` is given. */
export const StatCard: React.FC<{
  label: string;
  value: React.ReactNode;
  icon: React.ElementType;
  tone?: Tone;
  hint?: React.ReactNode;
  to?: string;
  delay?: number;
}> = ({ label, value, icon, tone = "indigo", hint, to, delay = 0 }) => {
  const reduced = useReducedMotion();
  const body = (
    <SpotlightCard className="h-full shadow-soft">
      <div className="flex h-full flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <IconTile icon={icon} tone={tone} />
          {to && <ArrowUpRight className="h-4 w-4 text-slate-300 transition-all duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-indigo-500" />}
        </div>
        <div className="mt-5 text-[30px] font-extrabold leading-none tracking-[-0.04em] text-slate-950">{value}</div>
        <div className="mt-2 text-[13px] font-semibold text-slate-700">{label}</div>
        {hint && <div className="mt-1 text-[12px] text-slate-500">{hint}</div>}
      </div>
    </SpotlightCard>
  );
  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay, ease: EASE }}
      className="h-full"
    >
      {to ? <Link to={to} className="block h-full rounded-3xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-500/20">{body}</Link> : body}
    </motion.div>
  );
};

/** Friendly empty state with an optional call to action. */
export const EmptyState: React.FC<{
  icon: React.ElementType;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}> = ({ icon: I, title, description, action, className = "" }) => (
  <div className={`relative overflow-hidden rounded-3xl border border-dashed border-slate-300/80 bg-white/70 px-6 py-12 text-center ${className}`}>
    <div aria-hidden className="absolute inset-x-0 top-0 h-32 bg-[radial-gradient(50%_80%_at_50%_0%,rgba(99,102,241,0.10),transparent)]" />
    <div className="relative mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-cyan-400 text-white shadow-glow">
      <I className="h-6 w-6" />
    </div>
    <h3 className="relative mt-5 text-[17px] font-bold tracking-[-0.02em] text-slate-950">{title}</h3>
    {description && <p className="relative mx-auto mt-2 max-w-md text-[14px] leading-relaxed text-slate-500">{description}</p>}
    {action && <div className="relative mt-6 flex justify-center gap-2">{action}</div>}
  </div>
);

export const Spinner: React.FC<{ className?: string }> = ({ className = "h-5 w-5" }) => (
  <span className={`inline-block animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600 ${className}`} />
);

/** Centered loading block for a page or a card. */
export const Loading: React.FC<{ label?: string; className?: string }> = ({ label = "Loading…", className = "py-16" }) => (
  <div className={`flex flex-col items-center justify-center gap-3 text-[13px] text-slate-500 ${className}`}>
    <Spinner className="h-7 w-7" />
    {label}
  </div>
);

/**
 * Modal shell: blurred backdrop, rounded-3xl panel, header with icon/title/close, scrollable body and a
 * footer row. Escape and the backdrop close it. Pages keep their own state and handlers.
 */
export const ModalShell: React.FC<{
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ElementType;
  tone?: Tone;
  size?: "sm" | "md" | "lg" | "xl";
  footer?: React.ReactNode;
  children: React.ReactNode;
  closeOnBackdrop?: boolean;
  /** Ref on the panel (e.g. an Orbit target for the whole form). */
  panelRef?: React.Ref<HTMLDivElement>;
}> = ({ open, onClose, title, description, icon, tone = "indigo", size = "md", footer, children, closeOnBackdrop = true, panelRef }) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  const width = size === "sm" ? "max-w-md" : size === "lg" ? "max-w-3xl" : size === "xl" ? "max-w-5xl" : "max-w-xl";
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6" role="dialog" aria-modal="true">
          <motion.div
            className="da-backdrop z-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={closeOnBackdrop ? onClose : undefined}
          />
          <motion.div
            ref={panelRef}
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.35, ease: EASE }}
            className={`da-modal z-10 ${width} max-h-[92vh] sm:max-h-[88vh] flex flex-col rounded-b-none sm:rounded-b-3xl`}
          >
            <div className="flex items-start gap-3 border-b border-slate-100 px-6 py-5">
              {icon && <IconTile icon={icon} tone={tone} />}
              <div className="min-w-0 flex-1">
                <h2 className="text-[18px] font-bold tracking-[-0.02em] text-slate-950">{title}</h2>
                {description && <p className="mt-0.5 text-[13px] leading-relaxed text-slate-500">{description}</p>}
              </div>
              <button type="button" onClick={onClose} className="da-icon-btn -mr-2 -mt-1" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
            {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-6 py-4">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

/**
 * A field's validation message, shown directly below the field. Give the input
 * aria-describedby={`${id}-error`} (see ariaFor in lib/validation) so screen readers announce it.
 */
export const FieldError: React.FC<{ id: string; message?: string | null; className?: string; tone?: "light" | "dark" }> = ({ id, message, className = "", tone = "light" }) => (
  <AnimatePresence initial={false}>
    {message && (
      <motion.p
        key={message}
        id={`${id}-error`}
        role="alert"
        initial={{ opacity: 0, height: 0, y: -4 }}
        animate={{ opacity: 1, height: "auto", y: 0 }}
        exit={{ opacity: 0, height: 0 }}
        transition={{ duration: 0.2 }}
        className={`overflow-hidden ${className}`}
      >
        <span className={`mt-1.5 flex items-start gap-1.5 text-[12.5px] font-medium leading-snug ${tone === "dark" ? "text-rose-300" : "text-rose-600"}`}>
          <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>{message}</span>
        </span>
      </motion.p>
    )}
  </AnimatePresence>
);

/** A form-level problem that is not about one field (e.g. "Could not reach the database"). */
export const FormAlert: React.FC<{ message?: string | null; onClose?: () => void }> = ({ message, onClose }) => (
  <AnimatePresence initial={false}>
    {message && (
      <motion.div
        role="alert"
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        className="flex items-start justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-800"
      >
        <span className="flex items-start gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" /> {message}</span>
        {onClose && (
          <button type="button" onClick={onClose} className="da-icon-btn -my-1 h-7 w-7" aria-label="Dismiss">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </motion.div>
    )}
  </AnimatePresence>
);
