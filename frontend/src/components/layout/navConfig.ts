import type { ElementType } from "react";
import {
  BookOpen, CheckCircle2, Cpu, Database, FileEdit, FileText, History, LayoutDashboard, PlusCircle, ShieldCheck,
  TableProperties, Workflow,
} from "lucide-react";

export interface NavItem { to: string; label: string; icon: ElementType; badgeKey?: "approvals" }
export interface NavGroup { label: string; items: NavItem[] }

/** The portal's navigation, grouped. Every item is also an Orbit target (`nav:<route>`). */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Workspace",
    items: [
      { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { to: "/connections", label: "Connections", icon: Database },
      { to: "/explorer", label: "Schema Explorer", icon: TableProperties },
    ],
  },
  {
    label: "Automate",
    items: [
      { to: "/automations", label: "Automations", icon: Workflow },
      { to: "/automations/new", label: "New Automation", icon: PlusCircle },
      { to: "/manual-schedule", label: "Manual Publishing", icon: FileEdit },
      { to: "/approvals", label: "Approvals", icon: CheckCircle2, badgeKey: "approvals" },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { to: "/knowledge", label: "Knowledge Base", icon: BookOpen },
      { to: "/ai-providers", label: "AI Providers", icon: Cpu },
    ],
  },
  {
    label: "Operations",
    items: [
      { to: "/executions", label: "Execution History", icon: History },
      { to: "/audit-logs", label: "Audit Logs", icon: FileText },
      { to: "/security", label: "Security & Guardrails", icon: ShieldCheck },
    ],
  },
];

/** Group and item for a path (exact match first, then the longest matching prefix). */
export function navFor(pathname: string): { group: NavGroup; item: NavItem } | null {
  let best: { group: NavGroup; item: NavItem } | null = null;
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (pathname === item.to) return { group, item };
      if (pathname.startsWith(item.to + "/") && (!best || item.to.length > best.item.to.length)) best = { group, item };
    }
  }
  return best;
}
