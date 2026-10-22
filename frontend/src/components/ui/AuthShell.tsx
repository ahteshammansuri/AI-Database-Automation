import React from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Database, Lock, ServerCog, ShieldCheck } from "lucide-react";
import { OrbitMascotCharacter } from "../agent/OrbitMascotCharacter";
import { BrandName, usePlatform } from "../../context/PlatformContext";

/** Icon and colour for each point beside the form, in order (points are edited in the admin panel). */
const POINT_ICONS = [
  { Icon: ServerCog, color: "text-cyan-300" },
  { Icon: Lock, color: "text-violet-300" },
  { Icon: ShieldCheck, color: "text-emerald-300" },
];

/**
 * Split-screen frame for sign-in and registration: the landing page's ink panel (brand, live Orbit,
 * statements set in the admin panel) beside a light form panel.
 */
export const AuthShell: React.FC<{ title: string; subtitle: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }> = ({
  title, subtitle, children, footer,
}) => {
  const { content } = usePlatform();
  return (
    <div className="flex min-h-screen bg-canvas">
      {/* Brand panel */}
      <aside className="relative hidden w-[46%] max-w-[640px] overflow-hidden bg-ink p-10 text-white lg:flex lg:flex-col">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="landing-blob absolute -left-24 -top-32 h-[30rem] w-[30rem] rounded-full bg-indigo-600/35" />
          <div className="landing-blob absolute -bottom-32 -right-24 h-[28rem] w-[28rem] rounded-full bg-violet-600/25" style={{ animationDelay: "-7s" }} />
          <div className="absolute inset-0 landing-grid" />
        </div>
        <Link to="/" className="group relative flex items-center gap-2.5" aria-label="Home">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 via-violet-500 to-cyan-400 shadow-[0_8px_24px_-8px_rgba(99,102,241,0.8)] transition-transform duration-500 group-hover:rotate-[8deg]">
            <Database className="h-5 w-5" />
          </span>
          <span className="text-[18px] font-bold tracking-tight"><BrandName /></span>
        </Link>
        <div className="relative mt-auto">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}>
            <OrbitMascotCharacter state="greeting" size="lg" />
          </motion.div>
          <h2 className="mt-6 text-[34px] font-extrabold leading-[1.08] tracking-[-0.04em]">
            {content.auth_title} <span className="landing-shimmer-text">{content.auth_highlight}</span>
          </h2>
          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-slate-400">
            {content.auth_subtitle}
          </p>
          <ul className="mt-8 space-y-3 text-[14px] text-slate-300">
            {content.auth_points.map((point, i) => {
              const { Icon, color } = POINT_ICONS[i % POINT_ICONS.length];
              return <li key={i} className="flex items-center gap-3"><Icon className={`h-4 w-4 ${color}`} /> {point.text}</li>;
            })}
          </ul>
        </div>
      </aside>

      {/* Form panel */}
      <main className="relative flex flex-1 items-center justify-center px-5 py-12 sm:px-10">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-80 portal-canvas-grid" />
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="relative w-full max-w-[420px]"
        >
          <Link to="/" className="mb-10 flex items-center gap-2.5 lg:hidden" aria-label="Home">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 via-violet-500 to-cyan-400 text-white">
              <Database className="h-[18px] w-[18px]" />
            </span>
            <span className="text-[17px] font-bold tracking-tight text-slate-950"><BrandName /></span>
          </Link>
          <h1 className="text-[30px] font-extrabold leading-tight tracking-[-0.035em] text-slate-950">{title}</h1>
          <p className="mt-2 text-[15px] text-slate-600">{subtitle}</p>
          <div className="mt-8">{children}</div>
          {footer && <div className="mt-8 text-center text-[14px] text-slate-600">{footer}</div>}
        </motion.div>
      </main>
    </div>
  );
};
