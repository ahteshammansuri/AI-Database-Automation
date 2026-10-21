import React from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { Database, ShieldCheck, X } from "lucide-react";
import { orbitTargets } from "../../services/orbitTargets";
import { NAV_GROUPS } from "./navConfig";

interface SidebarProps {
  pendingApprovalsCount?: number;
  /** Below the lg breakpoint the sidebar is a slide-in drawer controlled by the layout. */
  mobileOpen?: boolean;
  onClose?: () => void;
}

/** Dark "ink" navigation, the same surface as the landing page hero. Every link is an Orbit target. */
export const Sidebar: React.FC<SidebarProps> = ({ pendingApprovalsCount = 0, mobileOpen = false, onClose }) => {
  const location = useLocation();

  return (
    <>
      {/* Mobile overlay */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className={`fixed inset-0 z-30 bg-slate-950/50 backdrop-blur-[2px] transition-opacity lg:hidden ${
          mobileOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <aside
        id="portal-sidebar"
        className={`fixed inset-y-0 left-0 z-40 flex w-72 max-w-[85vw] shrink-0 flex-col overflow-hidden bg-ink text-slate-300 shadow-2xl transition-transform duration-300 ease-out
          lg:static lg:z-20 lg:w-[264px] lg:max-w-none lg:translate-x-0 lg:shadow-none ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        {/* Aurora + grid, as on the landing page */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="landing-blob absolute -top-24 -left-24 h-72 w-72 rounded-full bg-indigo-600/30" />
          <div className="landing-blob absolute bottom-10 -right-28 h-72 w-72 rounded-full bg-violet-600/20" style={{ animationDelay: "-8s" }} />
          <div className="absolute inset-0 landing-grid opacity-60" />
        </div>

        {/* Brand */}
        <div className="relative flex items-center gap-3 px-5 pt-5 pb-4">
          <Link to="/dashboard" className="group flex items-center gap-2.5" aria-label="DataAuto dashboard">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 via-violet-500 to-cyan-400 shadow-[0_8px_24px_-8px_rgba(99,102,241,0.8)] transition-transform duration-500 group-hover:rotate-[8deg] group-hover:scale-105">
              <Database className="h-[18px] w-[18px] text-white" />
            </span>
            <span>
              <span className="block text-[16px] font-bold tracking-tight text-white">DataAuto</span>
              <span className="block text-[11px] font-medium text-slate-500">Database automation</span>
            </span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto -mr-2 rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white lg:hidden"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="relative flex-1 space-y-5 overflow-y-auto px-3 pb-4 pt-2">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="px-3 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-slate-500">{group.label}</div>
              <div className="space-y-0.5">
                {group.items.map((link) => {
                  const Icon = link.icon;
                  const isActive = location.pathname === link.to;
                  const badge = link.badgeKey === "approvals" && pendingApprovalsCount > 0 ? pendingApprovalsCount : undefined;
                  return (
                    <NavLink
                      key={link.to}
                      to={link.to}
                      end={link.to === "/dashboard"}
                      className="relative block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/50"
                      ref={(el: HTMLAnchorElement | null) =>
                        el ? orbitTargets.register(`nav:${link.to}`, el) : orbitTargets.unregister(`nav:${link.to}`)
                      }
                    >
                      {isActive && (
                        <motion.span
                          layoutId="activeSidebarIndicator"
                          className="absolute inset-0 rounded-xl border border-white/10 bg-white/[0.07] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                          transition={{ type: "spring", stiffness: 380, damping: 32 }}
                        >
                          <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-gradient-to-b from-indigo-400 via-violet-400 to-cyan-300" />
                        </motion.span>
                      )}
                      <span
                        className={`group relative flex items-center justify-between rounded-xl px-3 py-2.5 lg:py-2 text-[14px] lg:text-[13.5px] font-medium transition-colors ${
                          isActive ? "text-white" : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-100"
                        }`}
                      >
                        <span className="flex items-center gap-3">
                          <Icon
                            className={`h-[17px] w-[17px] shrink-0 transition-colors ${
                              isActive ? "text-cyan-300" : "text-slate-500 group-hover:text-slate-300"
                            }`}
                          />
                          <span>{link.label}</span>
                        </span>
                        {badge !== undefined && (
                          <motion.span
                            initial={{ scale: 0.8 }}
                            animate={{ scale: 1 }}
                            className="rounded-full bg-amber-400 px-2 py-px text-[10.5px] font-bold text-slate-950 shadow-[0_0_14px_rgba(251,191,36,0.55)]"
                          >
                            {badge}
                          </motion.span>
                        )}
                      </span>
                    </NavLink>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Guardrails status */}
        <div className="relative p-3">
          <Link
            to="/security"
            className="group block rounded-2xl border border-white/10 bg-white/[0.04] p-3.5 transition-colors hover:border-white/20 hover:bg-white/[0.07]"
          >
            <div className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-emerald-500/15 text-emerald-300">
                <ShieldCheck className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-white">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  </span>
                  Guardrails on
                </div>
                <div className="truncate text-[11px] text-slate-500 group-hover:text-slate-400">Enforced by the server, not the model</div>
              </div>
            </div>
          </Link>
        </div>
      </aside>
    </>
  );
};
