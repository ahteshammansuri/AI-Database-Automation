import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { PlatformProvider } from "./context/PlatformContext";
import { ToastProvider } from "./context/ToastContext";
import { LiveEventsProvider } from "./context/LiveEventsContext";
import { AssistantProvider } from "./context/AssistantContext";
import { ProtectedRoute } from "./components/common/ProtectedRoute";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { Layout } from "./components/layout/Layout";
import { OrbitRemotePage } from "./pages/OrbitRemotePage";
import { LandingPage } from "./pages/LandingPage";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ConnectionsPage } from "./pages/ConnectionsPage";
import { SchemaExplorerPage } from "./pages/SchemaExplorerPage";
import { AutomationsListPage } from "./pages/AutomationsListPage";
import { AutomationBuilderPage } from "./pages/AutomationBuilderPage";
import { ApprovalsPage } from "./pages/ApprovalsPage";
import { ApprovalReviewPage } from "./pages/ApprovalReviewPage";
import { ManualSchedulePage } from "./pages/ManualSchedulePage";
import { KnowledgeBasePage } from "./pages/KnowledgeBasePage";
import { AIProvidersPage } from "./pages/AIProvidersPage";
import { ExecutionsPage } from "./pages/ExecutionsPage";
import { AuditLogsPage } from "./pages/AuditLogsPage";
import { SecuritySettingsPage } from "./pages/SecuritySettingsPage";
import { actionBridge } from "./services/actionBridge";
import { orbitTargets } from "./services/orbitTargets";
import { orbitSurfaces } from "./services/orbitSurfaces";
import { api } from "./services/api";

// The surface catalog is owned by the server; pages register handlers against it.
orbitSurfaces.setLoader(() => api.getAgentSurfaces());
import { useNavigate } from "react-router-dom";

/**
 * Portal routes Orbit may navigate to: the pages of the server's surface catalog (the server
 * already refuses any other route). One source of truth, so a new page cannot be forgotten here.
 */
async function orbitRoutes(): Promise<Set<string>> {
  const catalog = orbitSurfaces.getCatalog() ?? (await orbitSurfaces.loadCatalog());
  return new Set((catalog?.pages ?? []).map((p) => p.route));
}

const NavigationBridge: React.FC = () => {
  const navigate = useNavigate();

  React.useEffect(() => {
    if (localStorage.getItem("auth_token")) void orbitSurfaces.loadCatalog();
    const offNav = actionBridge.on("navigation.navigate", async (payload: { route?: string }) => {
      const route = payload?.route || "";
      if (!(await orbitRoutes()).has(route)) return { status: "error", error: `Route '${route}' is not a portal page.` };
      navigate(route);
      return { status: "ok" };
    });
    const offFocus = actionBridge.on("ui.focus_target", async (payload: { target?: string }) => {
      const el = payload?.target ? await orbitTargets.waitFor(payload.target, 1500) : null;
      if (!el) return { status: "not_mounted", error: `Target '${payload?.target}' is not on screen.` };
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      if (typeof (el as HTMLInputElement).focus === "function") (el as HTMLInputElement).focus({ preventScroll: true });
      return { status: "ok" };
    });
    return () => {
      offNav();
      offFocus();
    };
  }, [navigate]);

  return null;
};

/**
 * The portal and its public pages, with the signed-in providers (live events, Orbit). Orbit Remote's phone page is
 * routed outside them: a phone must never run Orbit's on-screen actions or heartbeat as a portal tab, even when the
 * same browser is also signed in to the portal.
 */
const PortalApp: React.FC = () => {
  return (
      <AuthProvider>
        <ToastProvider>
          <LiveEventsProvider>
            <AssistantProvider>
                <NavigationBridge />
                <Routes>
            {/* Public Routes */}
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            
            {/* Public email review token route */}
            <Route path="/approvals/:token" element={<ApprovalReviewPage />} />

            {/* Protected Portal Routes */}
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route path="dashboard" element={<DashboardPage />} />
              <Route path="connections" element={<ConnectionsPage />} />
              <Route path="explorer" element={<SchemaExplorerPage />} />
              <Route path="automations" element={<AutomationsListPage />} />
              <Route path="automations/new" element={<AutomationBuilderPage />} />
              <Route path="manual-schedule" element={<ManualSchedulePage />} />
              <Route path="approvals" element={<ApprovalsPage />} />
              <Route path="knowledge" element={<KnowledgeBasePage />} />
              <Route path="ai-providers" element={<AIProvidersPage />} />
              <Route path="executions" element={<ExecutionsPage />} />
              <Route path="audit-logs" element={<AuditLogsPage />} />
              <Route path="security" element={<SecuritySettingsPage />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
            </AssistantProvider>
          </LiveEventsProvider>
        </ToastProvider>
      </AuthProvider>
  );
};

export const App: React.FC = () => {
  return (
    <ErrorBoundary>
      <PlatformProvider>
        <BrowserRouter>
          <Routes>
            {/* Orbit Remote on a paired phone (opened from the QR code) */}
            <Route path="/orbit/remote" element={<OrbitRemotePage />} />
            <Route path="*" element={<PortalApp />} />
          </Routes>
        </BrowserRouter>
      </PlatformProvider>
    </ErrorBoundary>
  );
};

export default App;
