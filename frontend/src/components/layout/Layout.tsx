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
    <div className="flex h-screen bg-slate-50 text-slate-800 overflow-hidden font-sans relative">
      <Sidebar pendingApprovalsCount={pendingCount} />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Navbar onRefresh={fetchGlobalStats} isRefreshing={isRefreshing} />
        <main className="flex-1 overflow-y-auto p-6 md:p-8 bg-slate-50/70">
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
