import React, { useEffect, useRef, useState } from "react";
import { animate, motion, useInView, useReducedMotion } from "framer-motion";
import { EASE } from "./motion";


/** Fades and lifts its children into place the first time they scroll into view. */
export const Reveal: React.FC<{ children: React.ReactNode; delay?: number; y?: number; className?: string }> = ({
  children, delay = 0, y = 24, className,
}) => {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduced ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.8, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
};

/** Section eyebrow + title + subtitle, centred or left aligned, on light or dark backgrounds. */
export const SectionHeading: React.FC<{
  eyebrow: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  dark?: boolean;
  align?: "center" | "left";
  className?: string;
}> = ({ eyebrow, title, subtitle, dark = false, align = "center", className = "" }) => (
  <Reveal className={`${align === "center" ? "text-center mx-auto" : ""} max-w-3xl ${className}`}>
    <span
      className={`inline-flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.16em] ${
        dark ? "text-indigo-300" : "text-indigo-600"
      }`}
    >
      <span className={`h-px w-6 ${dark ? "bg-indigo-400/60" : "bg-indigo-500/50"}`} />
      {eyebrow}
    </span>
    <h2
      className={`mt-4 text-[2rem] sm:text-[2.6rem] lg:text-[3.1rem] leading-[1.08] font-extrabold tracking-[-0.035em] ${
        dark ? "text-white" : "text-slate-950"
      }`}
    >
      {title}
    </h2>
    {subtitle && (
      <p className={`mt-5 text-base sm:text-lg leading-relaxed ${dark ? "text-slate-400" : "text-slate-600"}`}>{subtitle}</p>
    )}
  </Reveal>
);

/** A card with a soft light that follows the pointer (hover), and a gentle lift. */
export const SpotlightCard: React.FC<{
  children: React.ReactNode;
  className?: string;
  dark?: boolean;
  glow?: string;
}> = ({ children, className = "", dark = false, glow }) => {
  const ref = useRef<HTMLDivElement>(null);
  const onMove = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  };
  const light = glow ?? (dark ? "rgba(129, 140, 248, 0.16)" : "rgba(99, 102, 241, 0.10)");
  return (
    <div
      ref={ref}
      onPointerMove={onMove}
      className={`group relative overflow-hidden rounded-3xl border transition-[transform,box-shadow,border-color] duration-500 ease-out hover:-translate-y-1 ${
        dark
          ? "border-white/10 bg-white/[0.035] hover:border-white/20 hover:shadow-[0_30px_80px_-30px_rgba(99,102,241,0.45)]"
          : "border-slate-200/80 bg-white hover:border-indigo-200 hover:shadow-[0_30px_70px_-35px_rgba(79,70,229,0.35)]"
      } ${className}`}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        style={{ background: `radial-gradient(420px circle at var(--mx, 50%) var(--my, 50%), ${light}, transparent 45%)` }}
      />
      <div className="relative h-full">{children}</div>
    </div>
  );
};

/** Counts up to `to` the first time it is visible (instantly with reduced motion). */
export const Counter: React.FC<{ to: number; suffix?: string; className?: string }> = ({ to, suffix = "", className }) => {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const reduced = useReducedMotion();
  const [value, setValue] = useState(reduced ? to : 0);
  useEffect(() => {
    if (!inView || reduced) return;
    const controls = animate(0, to, { duration: 1.6, ease: EASE, onUpdate: (v) => setValue(Math.round(v)) });
    return () => controls.stop();
  }, [inView, reduced, to]);
  return (
    <span ref={ref} className={className}>
      {reduced ? to : value}
      {suffix}
    </span>
  );
};

/** Gradient headline accent. */
export const Accent: React.FC<{ children: React.ReactNode; dark?: boolean }> = ({ children, dark = false }) => (
  <span
    className={`bg-clip-text text-transparent bg-gradient-to-r ${
      dark ? "from-indigo-300 via-violet-300 to-cyan-300" : "from-indigo-600 via-violet-600 to-cyan-600"
    }`}
  >
    {children}
  </span>
);
