import React, { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Sidebar } from "./Sidebar";
import { Navbar } from "./Navbar";
import { api } from "../../services/api";
import { ActiveTaskGuardBanner } from "../agent/ActiveTaskGuardBanner";
import { FloatingMascot } from "../agent/FloatingMascot";

export const Layout: React.FC = () => {
  const location = useLocation();
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [mobileNavOpen, setMobileNavOpen] = useState<boolean>(false);

  // Close the mobile drawer on navigation and on Escape
  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);
  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMobileNavOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileNavOpen]);

  const fetchGlobalStats = async () => {
    try {
      setIsRefreshing(true);
      const stats = await api.getStats();
      setPendingCount(stats.pending_approvals_count ?? stats.pending_approvals ?? 0);
    } catch {
      // Ignore background poll error
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchGlobalStats();
    const interval = setInterval(fetchGlobalStats, 20000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex h-screen bg-canvas text-slate-800 overflow-hidden font-sans relative">
      <Sidebar pendingApprovalsCount={pendingCount} mobileOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
      <div className="relative flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Soft grid + glow behind the top of every page, as on the landing page */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-80 portal-canvas-grid" />
        <div aria-hidden className="pointer-events-none absolute -top-40 right-0 h-80 w-[36rem] rounded-full bg-indigo-400/10 blur-3xl" />
        <Navbar onRefresh={fetchGlobalStats} isRefreshing={isRefreshing} onOpenMenu={() => setMobileNavOpen(true)} menuOpen={mobileNavOpen} />
        <main className="relative flex-1 overflow-y-auto overflow-x-hidden px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10">
          <div className="max-w-7xl mx-auto">
            {/* Active task guard banner during write operations */}
            <ActiveTaskGuardBanner />

            <AnimatePresence mode="wait">
              <motion.div
                key={location.pathname}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              >
                <Outlet />
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>

      {/* Voice-First Floating Autonomous Mascot AI Agent */}
      <FloatingMascot />
    </div>
  );
};
