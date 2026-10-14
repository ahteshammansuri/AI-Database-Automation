import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { ToastProvider } from "./context/ToastContext";
import { LiveEventsProvider } from "./context/LiveEventsContext";
import { AssistantProvider } from "./context/AssistantContext";
import { ProtectedRoute } from "./components/common/ProtectedRoute";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { Layout } from "./components/layout/Layout";
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
import { useNavigate } from "react-router-dom";

const NavigationBridge: React.FC = () => {
  const navigate = useNavigate();

  React.useEffect(() => {
    return actionBridge.on("navigation.navigate", (payload: { route: string }) => {
      if (payload?.route) {
        navigate(payload.route);
      }
    });
  }, [navigate]);

  return null;
};

export const App: React.FC = () => {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <ToastProvider>
          <LiveEventsProvider>
            <AssistantProvider>
              <BrowserRouter>
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
        </BrowserRouter>
            </AssistantProvider>
          </LiveEventsProvider>
        </ToastProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
};

export default App;
