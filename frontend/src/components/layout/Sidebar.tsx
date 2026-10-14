import React from "react";
import { NavLink, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  Database,
  TableProperties,
  Workflow,
  PlusCircle,
  FileEdit,
  CheckCircle2,
  BookOpen,
  Cpu,
  History,
  ShieldCheck,
  FileText
} from "lucide-react";

interface SidebarProps {
  pendingApprovalsCount?: number;
}

export const Sidebar: React.FC<SidebarProps> = ({ pendingApprovalsCount = 0 }) => {
  const location = useLocation();

  const links = [
    { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/connections", label: "Connections", icon: Database },
    { to: "/explorer", label: "Schema Explorer", icon: TableProperties },
    { to: "/automations", label: "Automations", icon: Workflow },
    { to: "/automations/new", label: "New Automation", icon: PlusCircle },
    { to: "/manual-schedule", label: "Manual Publishing", icon: FileEdit },
    {
      to: "/approvals",
      label: "Approvals",
      icon: CheckCircle2,
      badge: pendingApprovalsCount > 0 ? pendingApprovalsCount : undefined,
    },
    { to: "/knowledge", label: "Knowledge Base", icon: BookOpen },
    { to: "/ai-providers", label: "AI Providers", icon: Cpu },
    { to: "/executions", label: "Execution History", icon: History },
    { to: "/audit-logs", label: "Audit Logs", icon: FileText },
    { to: "/security", label: "Security & Guardrails", icon: ShieldCheck },
  ];

  return (
    <aside className="w-64 bg-white border-r border-slate-200/90 flex flex-col shrink-0 shadow-xs relative z-20">
      {/* Brand Header */}
      <div className="p-5 border-b border-slate-100 flex items-center gap-3">
        <motion.div
          whileHover={{ rotate: 5, scale: 1.05 }}
          transition={{ type: "spring", stiffness: 400, damping: 15 }}
          className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-indigo-500 flex items-center justify-center text-white shadow-sm"
        >
          <Database className="w-5 h-5" />
        </motion.div>
        <div>
          <h1 className="font-bold text-slate-900 text-sm tracking-tight flex items-center gap-1.5">
            <span>DataAuto</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-indigo-50 text-indigo-700 font-bold uppercase tracking-wider">
              PRO
            </span>
          </h1>
          <p className="text-[11px] text-slate-400 font-medium">Database Automation</p>
        </div>
      </div>

      {/* Nav Links */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {links.map((link) => {
          const Icon = link.icon;
          const isActive = location.pathname === link.to;

          return (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.to === "/dashboard"}
              className="relative block"
            >
              {isActive && (
                <motion.div
                  layoutId="activeSidebarIndicator"
                  className="absolute inset-0 bg-indigo-50/90 rounded-lg border border-indigo-200/60 shadow-xs"
                  transition={{ type: "spring", stiffness: 350, damping: 30 }}
                />
              )}

              <motion.div
                whileHover={{ x: 2 }}
                transition={{ duration: 0.15 }}
                className={`relative flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  isActive
                    ? "text-indigo-700 font-bold"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Icon
                    className={`w-4 h-4 shrink-0 transition-colors ${
                      isActive ? "text-indigo-600" : "text-slate-400"
                    }`}
                  />
                  <span>{link.label}</span>
                </div>

                {link.badge !== undefined && (
                  <motion.span
                    initial={{ scale: 0.8 }}
                    animate={{ scale: 1 }}
                    className="bg-amber-100 text-amber-800 border border-amber-300/80 text-[10px] font-bold px-2 py-0.2 rounded-full shadow-2xs"
                  >
                    {link.badge}
                  </motion.span>
                )}
              </motion.div>
            </NavLink>
          );
        })}
      </nav>

      {/* Safe Execution Footer */}
      <div className="p-4 border-t border-slate-100 bg-slate-50/70 text-xs">
        <div className="flex items-center gap-2 mb-1">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <span className="text-slate-800 font-bold text-[11px]">Safe Execution Engine</span>
        </div>
        <p className="text-[10px] text-slate-500">Parameterized MySQL Writes Only</p>
      </div>
    </aside>
  );
};
