import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect, type ReactNode } from 'react';
import { useSessionContext } from 'supertokens-auth-react/recipe/session';
import { useAuthStore } from './lib/authStore';
import { getRoleHomePath } from './lib/roleHome';
import { pickPrimaryRole } from '@m1/shared-validation';
import { useEffectiveSessionRole } from './lib/sessionRole';
import { AnalyticErrorBoundary } from './components/shared/AnalyticErrorBoundary';
import { preferPrimaryMachine } from './lib/machineRouting';

import { Login } from './pages/Login';
import { SetupPage } from './pages/SetupPage';
import { RoleHomeRedirect } from './components/RoleHomeRedirect';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AdminShell } from './components/layout/admin/AdminShell';
import { UserRole } from '@m1/shared-validation';
import { AdminRoute, PlantRoute, MachineHeadRoute, QualityRoute } from './components/RoleRoute';
// SixHi Hub & Routes
import { SixHiQueuePage } from './pages/sixHi/SixHiQueuePage';
import { SixHiOrderPage } from './pages/sixHi/SixHiOrderPage';
import { CrmOutgoingHandoverPage } from './pages/sixHi/CrmOutgoingHandoverPage';
import { ProcessHubPage } from './pages/process/ProcessHubPage';
import { ProcessCapturePage } from './pages/process/ProcessCapturePage';
import { ProcessHandoverPage } from './pages/process/ProcessHandoverPage';
import { PklChartPage } from './pages/process/PklChartPage';
import { AnnChargePage } from './pages/process/AnnChargePage';
import { ProcessOperatorHistoryPage } from './pages/process/ProcessOperatorHistoryPage';
import { AnnMhChargeDetailPage } from './pages/machinehead/ann/AnnMhChargeDetailPage';
import { PklMhLiveDashboard, ProcessLineLiveDashboard } from './pages/machinehead/pkl/PklMhLiveDashboard';
import { PklMhCoilDetailPage } from './pages/machinehead/pkl/PklMhCoilDetailPage';
import { HrsMhCoilDetailPage } from './pages/machinehead/hrs/HrsMhCoilDetailPage';
import { RwdMhLiveDashboard } from './pages/machinehead/RwdMhLiveDashboard';
import { RwdMhCoilDetailPage } from './pages/machinehead/rwd/RwdMhCoilDetailPage';
import { SixHiCapturePage } from './pages/sixHi/SixHiCapturePage';
import { TwoHiRewindingCapturePage } from './pages/sixHi/TwoHiRewindingCapturePage';
import { ScopeCaptureRoute } from './components/ScopeCaptureRoute';
import { ScopeHandoverRoute } from './components/ScopeHandoverRoute';

// Reports & Admin
import { ExportHistory } from './pages/reports/ExportHistory';
import { PlantDprExport } from './pages/reports/PlantDprExport';
import { MachineDprExport } from './pages/reports/MachineDprExport';
import { PlantHeadDashboard } from './pages/reports/PlantHeadDashboard';
import { PlantProduction } from './pages/reports/PlantProduction';
import { PlantOrderTracking } from './pages/reports/PlantOrderTracking';
import { PlantDefects } from './pages/reports/PlantDefects';
import { PlantStoppages } from './pages/reports/PlantStoppages';
import { PlantAlerts } from './pages/reports/PlantAlerts';
import { AuditTrailView } from './pages/audit/AuditTrailView';

// Admin
import { MasterDataAdmin } from './pages/admin/MasterDataAdmin';
import { MachineMasterAdmin } from './pages/admin/MachineMasterAdmin';
import { MachineSpecAdmin } from './pages/admin/MachineSpecAdmin';
import { PklSpecAdmin } from './pages/admin/PklSpecAdmin';
import { AnnSpecAdmin } from './pages/admin/AnnSpecAdmin';
import { PlanningAdmin } from './pages/admin/PlanningAdmin';
import { UsersAdmin } from './pages/admin/UsersAdmin';
import { SystemAdmin } from './pages/admin/SystemAdmin';
import { ValidationRulesAdmin } from './pages/admin/ValidationRulesAdmin';
import { QualitySpecsPage } from './pages/quality/QualitySpecsPage';
import { QualitySpecEditorPage } from './pages/quality/QualitySpecEditorPage';
import { MachineAssignmentPage } from './pages/admin/MachineAssignmentPage';
import { RollingImportPage } from './pages/import/RollingImportPage';
import { OrderAssignmentPage } from './pages/orderAssignment/OrderAssignmentPage';
import { CrsAssignmentPage } from './pages/process/CrsAssignmentPage';
import { MachineComingSoon } from './pages/MachineComingSoon';
import { GenericCapturePage } from './pages/capture/GenericCapturePage';
import { UserScopeShell } from './components/UserScopeShell';
import { UserScopeIndex } from './pages/UserScopeIndex';
import { LegacyMillRedirect } from './components/LegacyMillRedirect';
import { MachineHeadCrewPage } from './pages/machinehead/MachineHeadCrewPage';
import { MhLiveEntry } from './pages/machinehead/ann/MhLiveEntry';
import { AnnMhLiveDashboard } from './pages/machinehead/ann/AnnMhLiveDashboard';
import { AnnMhBatchingPage } from './pages/machinehead/ann/AnnMhBatchingPage';
import { AnnMhTrendsPage } from './pages/machinehead/ann/AnnMhTrendsPage';
import { AnnMhImportPage } from './pages/machinehead/ann/AnnMhImportPage';
import { HrsMhImportPage, PklMhImportPage, RwdMhImportPage } from './pages/machinehead/LineMhImportPage';
import { LiveDashboard } from './pages/live/LiveDashboard';
import { UnifiedShell } from './components/layout/UnifiedShell';
import { PlantShiftReviewPage } from './pages/plant/PlantShiftReviewPage';

function UnknownRouteRedirect() {
  const session = useSessionContext();
  const { role, lineAccess, machineAccess, username, token } = useAuthStore();
  if (!token) return <Navigate to="/login" replace />;
  if (!session.loading && session.doesSessionExist) {
    const payload = session.accessTokenPayload as Record<string, unknown>;
    const jwtRole = pickPrimaryRole(Array.isArray(payload.roles) ? (payload.roles as string[]) : []);
    if (jwtRole && role !== jwtRole) {
      return null; // SuperTokensSync still catching up
    }
    if (jwtRole) {
      const jwtLines = Array.isArray(payload.lineAccess) ? (payload.lineAccess as string[]) : lineAccess;
      const jwtMachines = Array.isArray(payload.machineAccess)
        ? (payload.machineAccess as string[])
        : machineAccess;
      const jwtUsername = typeof payload.username === 'string' ? payload.username : username;
      return <Navigate to={getRoleHomePath(jwtRole, jwtLines, jwtMachines, jwtUsername)} replace />;
    }
  }
  return <Navigate to={getRoleHomePath(role, lineAccess, machineAccess, username)} replace />;
}

/** Supervisor home is /live — never leave them on the MH URL. */
function RedirectSupervisorFromMachineHeadHome({ children }: { children: ReactNode }) {
  const { role, sessionLoading } = useEffectiveSessionRole();
  if (sessionLoading) return null;
  if (role === 'SUPERVISOR') return <Navigate to="/live" replace />;
  return <>{children}</>;
}

function SuperTokensSync() {
  const session = useSessionContext();
  const { login, logout, token, setActiveMachine } = useAuthStore();
  
  useEffect(() => {
    if (session.loading) return;
    
    if (session.doesSessionExist) {
      const payload = session.accessTokenPayload as Record<string, unknown>;
      const roles = Array.isArray(payload.roles) ? (payload.roles as string[]) : [];
      const role = (pickPrimaryRole(roles) ?? 'OPERATOR') as import('./lib/authStore').Role;
      const lines = Array.isArray(payload.lineAccess) ? (payload.lineAccess as string[]) : [];
      const machines = Array.isArray(payload.machineAccess)
        ? (payload.machineAccess as string[])
        : [];
      const username = typeof payload.username === 'string' ? payload.username : undefined;

      // Always re-hydrate from the live access-token claims (stale sessionStorage
      // role alone was enough to open MH UI while /live/* returned 403).
      const store = useAuthStore.getState();
      const same =
        token === 'st-session' &&
        store.role === role &&
        JSON.stringify(store.lineAccess) === JSON.stringify(lines) &&
        JSON.stringify(store.machineAccess) === JSON.stringify(machines) &&
        store.username === (username ?? null);
      const preferred = preferPrimaryMachine(role, machines, lines);
      if (!same) {
        login('st-session', role, lines, undefined, machines, username);
      } else {
        // Drop activeMachine that is no longer on the JWT allow-list.
        const active = store.activeMachine?.toUpperCase() ?? null;
        const allowed = new Set(machines.map((m) => m.toUpperCase()));
        if (preferred && (!active || !allowed.has(active))) {
          setActiveMachine(preferred);
        }
      }
    } else {
      const existingLegacy = sessionStorage.getItem('mock_jwt');
      if (!existingLegacy && token) {
        logout();
      }
    }
  }, [session, login, logout, token, setActiveMachine]);
  
  return null;
}

function AppRoutes() {
  const { pathname } = useLocation();

  return (
    <AnalyticErrorBoundary analyticName="Application" resetKey={pathname}>
      <Routes>
        {/* Auth */}
        <Route path="/login" element={<Login />} />
        
        {/* Setup */}
        <Route
          path="/setup"
          element={
            <ProtectedRoute>
              <PlantRoute>
                <Navigate to="/plant/setup" replace />
              </PlantRoute>
            </ProtectedRoute>
          }
        />

        {/* Role-native home */}
        <Route path="/" element={<ProtectedRoute><RoleHomeRedirect /></ProtectedRoute>} />
        <Route path="/station" element={<ProtectedRoute><RoleHomeRedirect /></ProtectedRoute>} />

        <Route path="/coming-soon/:machineCode" element={<ProtectedRoute><MachineComingSoon /></ProtectedRoute>} />
        <Route path="/capture/:machineCode" element={<ProtectedRoute><GenericCapturePage /></ProtectedRoute>} />

        {/* Legacy mill URLs → /username.role */}
        <Route path="/6hi" element={<ProtectedRoute><LegacyMillRedirect machine="6HI" /></ProtectedRoute>} />
        <Route path="/6hi/*" element={<ProtectedRoute><LegacyMillRedirect machine="6HI" /></ProtectedRoute>} />
        <Route path="/4hi" element={<ProtectedRoute><LegacyMillRedirect machine="4HI" /></ProtectedRoute>} />
        <Route path="/4hi/*" element={<ProtectedRoute><LegacyMillRedirect machine="4HI" /></ProtectedRoute>} />
        <Route path="/2hi" element={<ProtectedRoute><LegacyMillRedirect machine="2HI" /></ProtectedRoute>} />
        <Route path="/2hi/*" element={<ProtectedRoute><LegacyMillRedirect machine="2HI" /></ProtectedRoute>} />
        <Route path="/crm" element={<ProtectedRoute><LegacyMillRedirect machine="6HI" /></ProtectedRoute>} />
        <Route path="/crm/*" element={<ProtectedRoute><LegacyMillRedirect machine="6HI" /></ProtectedRoute>} />
        <Route path="/dashboard" element={<ProtectedRoute><RoleHomeRedirect /></ProtectedRoute>} />

        <Route path="/reports/plant-head" element={<PlantRoute><Navigate to="/plant" replace /></PlantRoute>} />
        <Route path="/plant" element={<PlantRoute><UnifiedShell /></PlantRoute>}>
          <Route index element={<PlantHeadDashboard />} />
          <Route path="live" element={<LiveDashboard />} />
          <Route path="production" element={<PlantProduction />} />
          <Route path="orders" element={<PlantOrderTracking />} />
          <Route path="defect-intelligence" element={<PlantDefects />} />
          <Route path="downtime-intelligence" element={<PlantStoppages />} />
          <Route path="audit" element={<AuditTrailView />} />
          <Route path="users" element={<UsersAdmin embedded />} />
          <Route path="defects" element={<Navigate to="/plant/defect-intelligence" replace />} />
          <Route path="stoppages" element={<Navigate to="/plant/downtime-intelligence" replace />} />
          <Route path="alerts" element={<PlantAlerts />} />
          <Route path="setup" element={<SetupPage embedded />} />
          <Route path="dpr-export" element={<PlantDprExport />} />
          <Route path="exports/history" element={<ExportHistory embedded />} />
        </Route>
        <Route path="/audit" element={<PlantRoute><Navigate to="/plant/audit" replace /></PlantRoute>} />
        <Route path="/reports/export" element={<PlantRoute><Navigate to="/plant/dpr-export" replace /></PlantRoute>} />
        <Route path="/reports/exports/history" element={<PlantRoute><Navigate to="/plant/exports/history" replace /></PlantRoute>} />
        <Route path="/reports/dpr" element={<PlantRoute><Navigate to="/plant/dpr-export" replace /></PlantRoute>} />

        <Route path="/import/rolling" element={<MachineHeadRoute allow={[UserRole.SUPERVISOR]}><RollingImportPage /></MachineHeadRoute>} />
        <Route path="/order-assignment" element={<MachineHeadRoute allow={[UserRole.SUPERVISOR]}><OrderAssignmentPage /></MachineHeadRoute>} />
        <Route path="/crs/order-assignment" element={<MachineHeadRoute allow={[UserRole.SUPERVISOR]}><CrsAssignmentPage /></MachineHeadRoute>} />
        <Route path="/admin/machine-assignment" element={<AdminRoute><MachineAssignmentPage /></AdminRoute>} />
        <Route path="/live" element={<MachineHeadRoute allow={[UserRole.SUPERVISOR]}><MhLiveEntry /></MachineHeadRoute>} />
        <Route
          path="/machine-head-dashboard"
          element={(
            <MachineHeadRoute allow={[UserRole.SUPERVISOR]}>
              <RedirectSupervisorFromMachineHeadHome>
                <MhLiveEntry />
              </RedirectSupervisorFromMachineHeadHome>
            </MachineHeadRoute>
          )}
        />
        <Route path="/machine-head/ann/live" element={<MachineHeadRoute><AnnMhLiveDashboard /></MachineHeadRoute>} />
        <Route path="/machine-head/ann/charge/:chargeNo" element={<MachineHeadRoute><AnnMhChargeDetailPage /></MachineHeadRoute>} />
        <Route path="/machine-head/ann/trends" element={<MachineHeadRoute><AnnMhTrendsPage /></MachineHeadRoute>} />
        <Route path="/machine-head/ann/batching" element={<MachineHeadRoute><AnnMhBatchingPage /></MachineHeadRoute>} />
        <Route path="/machine-head/ann/import" element={<MachineHeadRoute><AnnMhImportPage /></MachineHeadRoute>} />
        <Route path="/machine-head/hrs/import" element={<MachineHeadRoute><HrsMhImportPage /></MachineHeadRoute>} />
        <Route path="/machine-head/pkl/import" element={<MachineHeadRoute><PklMhImportPage /></MachineHeadRoute>} />
        <Route path="/machine-head/rwd/import" element={<MachineHeadRoute><RwdMhImportPage /></MachineHeadRoute>} />
        <Route path="/machine-head/pkl/live" element={<MachineHeadRoute><PklMhLiveDashboard /></MachineHeadRoute>} />
        <Route path="/machine-head/pkl/coil/:coilNo" element={<MachineHeadRoute><PklMhCoilDetailPage /></MachineHeadRoute>} />
        <Route path="/machine-head/pkl/specs" element={<MachineHeadRoute><PklSpecAdmin /></MachineHeadRoute>} />
        <Route path="/machine-head/hrs/live" element={<MachineHeadRoute><ProcessLineLiveDashboard line="HRS" /></MachineHeadRoute>} />
        <Route path="/machine-head/hrs/coil/:coilNo" element={<MachineHeadRoute><HrsMhCoilDetailPage /></MachineHeadRoute>} />
        <Route path="/machine-head/rwd/live" element={<MachineHeadRoute allow={[UserRole.SUPERVISOR, UserRole.OPERATOR]}><RwdMhLiveDashboard /></MachineHeadRoute>} />
        <Route path="/machine-head/rwd/coil/:batchNo" element={<MachineHeadRoute allow={[UserRole.SUPERVISOR, UserRole.OPERATOR]}><RwdMhCoilDetailPage /></MachineHeadRoute>} />
        <Route path="/machine-head/shift-review" element={<MachineHeadRoute><PlantShiftReviewPage /></MachineHeadRoute>} />
        <Route path="/machine-head/crew" element={<MachineHeadRoute><MachineHeadCrewPage /></MachineHeadRoute>} />
        <Route path="/machine-head/dpr-export" element={<MachineHeadRoute><MachineDprExport /></MachineHeadRoute>} />
        <Route path="/machine-head/exports/history" element={<MachineHeadRoute><ExportHistory embedded /></MachineHeadRoute>} />
        <Route path="/machine-head/traceability" element={<MachineHeadRoute allow={[UserRole.SUPERVISOR]}><PlantOrderTracking standalone /></MachineHeadRoute>} />

        <Route path="/quality/specs" element={<QualityRoute><QualitySpecsPage /></QualityRoute>} />
        <Route path="/quality/specs/:id" element={<QualityRoute><QualitySpecEditorPage /></QualityRoute>} />

        <Route path="/admin/master-data" element={<AdminRoute><MasterDataAdmin /></AdminRoute>} />
        <Route path="/admin/machines" element={<AdminRoute><MachineMasterAdmin /></AdminRoute>} />
        <Route path="/admin/machine-specs" element={<MachineHeadRoute><MachineSpecAdmin /></MachineHeadRoute>} />
        <Route path="/admin/pkl-specs" element={<Navigate to="/machine-head/pkl/specs" replace />} />
        <Route path="/admin/ann-specs" element={<MachineHeadRoute><AnnSpecAdmin /></MachineHeadRoute>} />
        <Route path="/admin/planning" element={<AdminRoute><PlanningAdmin /></AdminRoute>} />
        <Route path="/admin/users" element={<AdminRoute><UsersAdmin /></AdminRoute>} />
        <Route
          path="/admin/audit"
          element={(
            <AdminRoute>
              <AdminShell title="Audit Trail" subtitle="Search and filter platform change history">
                <AuditTrailView />
              </AdminShell>
            </AdminRoute>
          )}
        />
        <Route path="/admin/system" element={<AdminRoute><SystemAdmin /></AdminRoute>} />
        <Route path="/admin/validation-rules" element={<AdminRoute><ValidationRulesAdmin /></AdminRoute>} />

        {/* User workspace — /username.role (must be last — catches dotted paths only) */}
        <Route path="/:userScope" element={<ProtectedRoute><UserScopeShell /></ProtectedRoute>}>
          <Route index element={<UserScopeIndex />} />
          <Route path="capture" element={<ScopeCaptureRoute />} />
          <Route path="capture/:coilNo" element={<ProcessCapturePage />} />
          <Route path="chart" element={<PklChartPage />} />
          <Route path="charge/:chargeNo" element={<AnnChargePage />} />
          <Route path="history" element={<ProcessOperatorHistoryPage />} />
          <Route path="handover" element={<ScopeHandoverRoute />} />
          <Route path="shift-summary" element={<Navigate to="../handover" replace />} />
          <Route path="rolling" element={<SixHiQueuePage />} />
          <Route path="skinpass" element={<SixHiQueuePage />} />
          <Route path="rolling/order/:batchNo" element={<SixHiOrderPage />} />
          <Route path="skinpass/order/:batchNo" element={<SixHiOrderPage />} />
          <Route path="rewinding/:coilNo" element={<TwoHiRewindingCapturePage />} />
        </Route>

        <Route path="*" element={<UnknownRouteRedirect />} />
      </Routes>
    </AnalyticErrorBoundary>
  );
}

function App() {
  return (
    <BrowserRouter>
      <SuperTokensSync />
      <AppRoutes />
    </BrowserRouter>
  );
}

export default App;
