import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, ChevronRight, Home, LogOut, UserCog, Menu, Plus, RefreshCw, ShieldCheck } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useLiveEvents } from "../../context/LiveEventsContext";
import { api } from "../../services/api";
import { navFor } from "./navConfig";
import { RemoteNavButton } from "../remote/RemoteNavButton";
import { usePlatform } from "../../context/PlatformContext";

interface NavbarProps {
  onRefresh?: () => void;
  isRefreshing?: boolean;
  onOpenMenu?: () => void;
  menuOpen?: boolean;
}

/** Glass top bar: where you are, live status, refresh, create, and your account. */
export const Navbar: React.FC<NavbarProps> = ({ onRefresh, isRefreshing = false, onOpenMenu, menuOpen = false }) => {
  const { user, logout } = useAuth();
  const { status: liveStatus } = useLiveEvents();
  const navigate = useNavigate();
  const { orbit } = usePlatform().config;
  const location = useLocation();
  const here = navFor(location.pathname);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!accountOpen) return;
    const onDown = (e: MouseEvent) => {
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) setAccountOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setAccountOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [accountOpen]);

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const live =
    liveStatus === "connected"
      ? { label: "Live", tone: "border-emerald-200 bg-emerald-50 text-emerald-700", dot: "bg-emerald-500", ping: true }
      : liveStatus === "reconnecting" || liveStatus === "connecting"
        ? { label: "Reconnecting", tone: "border-amber-200 bg-amber-50 text-amber-700", dot: "bg-amber-500", ping: true }
        : { label: "Offline", tone: "border-slate-200 bg-slate-50 text-slate-500", dot: "bg-slate-400", ping: false };

  const initials = (user?.name || user?.email || "?")
    .split(/\s+/)
    .map((p) => p.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <header className="relative z-30 flex h-16 shrink-0 items-center justify-between gap-2 border-b border-slate-200/70 bg-white/75 px-3 backdrop-blur-xl sm:px-6">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <button
          type="button"
          onClick={onOpenMenu}
          className="da-icon-btn -ml-1 lg:hidden"
          aria-label="Open menu"
          aria-controls="portal-sidebar"
          aria-expanded={menuOpen}
        >
          <Menu className="h-5 w-5" />
        </button>
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[13px]">
          <Link to="/dashboard" className="hidden sm:grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Dashboard">
            <Home className="h-4 w-4" />
          </Link>
          {here && (
            <>
              <ChevronRight className="hidden sm:block h-3.5 w-3.5 shrink-0 text-slate-300" />
              <span className="hidden md:inline text-slate-400">{here.group.label}</span>
              <ChevronRight className="hidden md:block h-3.5 w-3.5 shrink-0 text-slate-300" />
              <span className="truncate font-semibold text-slate-900">{here.item.label}</span>
            </>
          )}
        </nav>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2.5">
        <span
          className={`hidden sm:inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-semibold ${live.tone}`}
          title={`Live updates: ${liveStatus}`}
        >
          <span className="relative flex h-1.5 w-1.5">
            {live.ping && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${live.dot}`} />}
            <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${live.dot}`} />
          </span>
          {live.label}
        </span>

        {onRefresh && (
          <button
            type="button"
            onClick={() => {
              api.clearCache();
              onRefresh();
            }}
            disabled={isRefreshing}
            className="da-icon-btn"
            title="Refresh data"
            aria-label="Refresh data"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin text-indigo-600" : ""}`} />
          </button>
        )}

        {orbit.enabled && orbit.remote_enabled && <RemoteNavButton />}

        <Link to="/automations/new" className="da-btn da-btn-primary px-3 sm:px-4" aria-label="Create automation">
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">New automation</span>
        </Link>

        {user && (
          <div ref={accountRef} className={`relative pl-1 sm:pl-2 ${accountOpen ? "z-50" : ""}`}>
            <button
              type="button"
              onClick={() => setAccountOpen((o) => !o)}
              className="flex items-center gap-2 rounded-full border border-transparent p-0.5 pr-1.5 transition-colors hover:border-slate-200 hover:bg-white"
              aria-haspopup="menu"
              aria-expanded={accountOpen}
            >
              <span className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-indigo-500 via-violet-500 to-cyan-400 text-[12px] font-bold text-white shadow-[0_6px_16px_-6px_rgba(99,102,241,0.8)]">
                {initials}
              </span>
              <span className="hidden max-w-[140px] truncate text-[13px] font-semibold text-slate-800 md:inline">{user.name}</span>
              <ChevronDown className={`hidden h-3.5 w-3.5 text-slate-400 transition-transform md:block ${accountOpen ? "rotate-180" : ""}`} />
            </button>
            <AnimatePresence>
              {accountOpen && (
                <motion.div
                  role="menu"
                  initial={{ opacity: 0, y: -6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.98 }}
                  transition={{ duration: 0.18 }}
                  className="absolute right-0 top-full mt-2 w-64 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-lift z-[100]"
                >
                  <div className="border-b border-slate-100 px-4 py-3">
                    <div className="truncate text-[13.5px] font-semibold text-slate-900">{user.name}</div>
                    <div className="truncate text-[12px] text-slate-500">{user.email}</div>
                  </div>
                  <div className="p-1.5">
                    <Link
                      to="/account"
                      role="menuitem"
                      onClick={() => setAccountOpen(false)}
                      className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <UserCog className="h-4 w-4 text-slate-400" /> Account settings
                    </Link>
                    <Link
                      to="/security"
                      role="menuitem"
                      onClick={() => setAccountOpen(false)}
                      className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <ShieldCheck className="h-4 w-4 text-slate-400" /> Security & guardrails
                    </Link>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={handleLogout}
                      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] font-medium text-rose-600 hover:bg-rose-50"
                    >
                      <LogOut className="h-4 w-4" /> Sign out
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
    </header>
  );
};
