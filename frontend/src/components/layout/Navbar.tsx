import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { PlusCircle, RefreshCw, LogOut, Menu } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useLiveEvents } from "../../context/LiveEventsContext";
import { api } from "../../services/api";

interface NavbarProps {
  onRefresh?: () => void;
  isRefreshing?: boolean;
  onOpenMenu?: () => void;
  menuOpen?: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({ onRefresh, isRefreshing = false, onOpenMenu, menuOpen = false }) => {
  const { user, logout } = useAuth();
  const { status: liveStatus } = useLiveEvents();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <header className="h-16 bg-white border-b border-slate-200 px-3 sm:px-6 flex items-center justify-between gap-2 shrink-0 shadow-xs">
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMenu}
          className="p-2 -ml-1 rounded-lg text-slate-600 hover:bg-slate-100 lg:hidden"
          aria-label="Open menu"
          aria-controls="portal-sidebar"
          aria-expanded={menuOpen}
        >
          <Menu className="w-5 h-5" />
        </button>
        <span className="hidden xl:inline-flex px-2.5 py-1 text-xs font-medium rounded-full bg-slate-100 text-slate-700 border border-slate-200">
          Control Plane: Laravel 11
        </span>
        <span className="hidden md:flex px-2.5 py-1 text-xs font-medium rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 animate-pulse" />
          AI Microservice: Python / Ollama
        </span>
        <span
          className={`px-2.5 py-1 text-xs font-medium rounded-full border flex items-center gap-1.5 whitespace-nowrap ${
            liveStatus === "connected"
              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
              : liveStatus === "reconnecting" || liveStatus === "connecting"
              ? "bg-amber-50 text-amber-700 border-amber-200"
              : "bg-slate-100 text-slate-500 border-slate-200"
          }`}
          title={`SSE Live Stream: ${liveStatus}`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              liveStatus === "connected"
                ? "bg-emerald-500 animate-pulse"
                : liveStatus === "reconnecting" || liveStatus === "connecting"
                ? "bg-amber-500 animate-ping"
                : "bg-slate-400"
            }`}
          />
          {liveStatus === "connected" ? "Live Stream" : liveStatus === "reconnecting" ? "Reconnecting" : "Offline"}
        </span>
      </div>

      <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
        {onRefresh && (
          <button
            onClick={() => {
              api.clearCache();
              onRefresh();
            }}
            disabled={isRefreshing}
            className="p-2 text-slate-500 hover:text-slate-800 rounded-lg hover:bg-slate-100 transition"
            title="Refresh Data (Bypass Cache)"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin text-indigo-600" : ""}`} />
          </button>
        )}

        <Link
          to="/automations/new"
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-2.5 sm:px-3.5 py-2 rounded-lg shadow-sm transition"
          aria-label="Create automation"
        >
          <PlusCircle className="w-4 h-4" />
          <span className="hidden sm:inline">Create Automation</span>
        </Link>

        {user && (
          <div className="flex items-center space-x-2 sm:space-x-3 pl-2 sm:pl-3 border-l border-slate-200">
            <div className="flex items-center space-x-2 text-xs text-slate-700">
              <div className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 border border-indigo-200 flex items-center justify-center font-bold text-xs">
                {user.name.charAt(0).toUpperCase()}
              </div>
              <span className="hidden sm:inline font-semibold">{user.name}</span>
            </div>
            <button
              onClick={handleLogout}
              className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition"
              title="Sign Out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
};
