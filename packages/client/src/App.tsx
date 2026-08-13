import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { useSessionContext } from 'supertokens-auth-react/recipe/session';
import { useAuthStore } from './lib/authStore';
import { getRoleHomePath } from './lib/roleHome';
import { pickPrimaryRole } from '@m1/shared-validation';
import { useEffectiveSessionRole } from './lib/sessionRole';
import { AnalyticErrorBoundary } from './components/shared/AnalyticErrorBoundary';
import { preferPrimaryMachine } from './lib/machineRouting';
import { RouteSpinner } from './components/RouteSpinner';
import { RoleHomeRedirect } from './components/RoleHomeRedirect';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AdminShell } from './components/layout/admin/AdminShell';
import { UserRole } from '@m1/shared-validation';
import { AdminRoute, PlantRoute, MachineHeadRoute, QualityRoute, RoleRoute } from './components/RoleRoute';
import { UnifiedShell } from './components/layout/UnifiedShell';
import { UserScopeShell, UserScopeCatchAll } from './components/UserScopeShell';
import { LegacyMillRedirect } from './components/LegacyMillRedirect';

const Login = lazy(() => import('./pages/Login').then((m) => ({ default: m.Login })));
const SetupPage = lazy(() => import('./pages/SetupPage').then((m) => ({ default: m.SetupPage })));
const SixHiQueuePage = lazy(() =>
  import('./pages/sixHi/SixHiQueuePage').then((m) => ({ default: m.SixHiQueuePage })),
);
const SixHiOrderPage = lazy(() =>
  import('./pages/sixHi/SixHiOrderPage').then((m) => ({ default: m.SixHiOrderPage })),
);
const ProcessCapturePage = lazy(() =>
  import('./pages/process/ProcessCapturePage').then((m) => ({ default: m.ProcessCapturePage })),
);
const PklChartPage = lazy(() =>
  import('./pages/process/PklChartPage').then((m) => ({ default: m.PklChartPage })),
);
const AnnChargePage = lazy(() =>
  import('./pages/process/AnnChargePage').then((m) => ({ default: m.AnnChargePage })),
);
const AnnOperatorBatchingPage = lazy(() =>
  import('./pages/process/AnnOperatorBatchingPage').then((m) => ({ default: m.AnnOperatorBatchingPage })),
);
const AnnOperatorOrdersPage = lazy(() =>
  import('./pages/process/AnnOperatorOrdersPage').then((m) => ({ default: m.AnnOperatorOrdersPage })),
);
const AnnOperatorStoppagePage = lazy(() =>
  import('./pages/process/AnnOperatorStoppagePage').then((m) => ({ default: m.AnnOperatorStoppagePage })),
);
const ProcessOperatorHistoryPage = lazy(() =>
  import('./pages/process/ProcessOperatorHistoryPage').then((m) => ({
    default: m.ProcessOperatorHistoryPage,
  })),
);
const AnnMhChargeDetailPage = lazy(() =>
  import('./pages/machinehead/ann/AnnMhChargeDetailPage').then((m) => ({
    default: m.AnnMhChargeDetailPage,
  })),
);
const AnnMhReportPage = lazy(() =>
  import('./pages/machinehead/ann/AnnMhReportPage').then((m) => ({ default: m.AnnMhReportPage })),
);
const PklMhLiveDashboard = lazy(() =>
  import('./pages/machinehead/pkl/PklMhLiveDashboard').then((m) => ({
    default: m.PklMhLiveDashboard,
  })),
);
const PklMhCoilDetailPage = lazy(() =>
  import('./pages/machinehead/pkl/PklMhCoilDetailPage').then((m) => ({
    default: m.PklMhCoilDetailPage,
  })),
);
const HrsMhLiveDashboard = lazy(() =>
  import('./pages/machinehead/hrs/HrsMhLiveDashboard').then((m) => ({
    default: m.HrsMhLiveDashboard,
  })),
);
const HrsMhCoilDetailPage = lazy(() =>
  import('./pages/machinehead/hrs/HrsMhCoilDetailPage').then((m) => ({
    default: m.HrsMhCoilDetailPage,
  })),
);
const RwdMhLiveDashboard = lazy(() =>
  import('./pages/machinehead/RwdMhLiveDashboard').then((m) => ({ default: m.RwdMhLiveDashboard })),
);
const RwdMhCoilDetailPage = lazy(() =>
  import('./pages/machinehead/rwd/RwdMhCoilDetailPage').then((m) => ({
    default: m.RwdMhCoilDetailPage,
  })),
);
const TwoHiRewindingCapturePage = lazy(() =>
  import('./pages/sixHi/TwoHiRewindingCapturePage').then((m) => ({
    default: m.TwoHiRewindingCapturePage,
  })),
);
const ScopeCaptureRoute = lazy(() =>
  import('./components/ScopeCaptureRoute').then((m) => ({ default: m.ScopeCaptureRoute })),
);
const ScopeHandoverRoute = lazy(() =>
  import('./components/ScopeHandoverRoute').then((m) => ({ default: m.ScopeHandoverRoute })),
);
const ExportHistory = lazy(() =>
  import('./pages/reports/ExportHistory').then((m) => ({ default: m.ExportHistory })),
);
const PlantDprExport = lazy(() =>
  import('./pages/reports/PlantDprExport').then((m) => ({ default: m.PlantDprExport })),
);
const MachineDprExport = lazy(() =>
  import('./pages/reports/MachineDprExport').then((m) => ({ default: m.MachineDprExport })),
);
const PlantHeadDashboard = lazy(() =>
  import('./pages/reports/PlantHeadDashboard').then((m) => ({ default: m.PlantHeadDashboard })),
);
const PlantProduction = lazy(() =>
  import('./pages/reports/PlantProduction').then((m) => ({ default: m.PlantProduction })),
);
const PlantOrderTracking = lazy(() =>
  import('./pages/reports/PlantOrderTracking').then((m) => ({ default: m.PlantOrderTracking })),
);
const PlantDefects = lazy(() =>
  import('./pages/reports/PlantDefects').then((m) => ({ default: m.PlantDefects })),
);
const PlantStoppages = lazy(() =>
  import('./pages/reports/PlantStoppages').then((m) => ({ default: m.PlantStoppages })),
);
const PlantAlerts = lazy(() =>
  import('./pages/reports/PlantAlerts').then((m) => ({ default: m.PlantAlerts })),
);
const AuditTrailView = lazy(() =>
  import('./pages/audit/AuditTrailView').then((m) => ({ default: m.AuditTrailView })),
);
const MasterDataAdmin = lazy(() =>
  import('./pages/admin/MasterDataAdmin').then((m) => ({ default: m.MasterDataAdmin })),
);
const MachineMasterAdmin = lazy(() =>
  import('./pages/admin/MachineMasterAdmin').then((m) => ({ default: m.MachineMasterAdmin })),
);
const MachineSpecAdmin = lazy(() =>
  import('./pages/admin/MachineSpecAdmin').then((m) => ({ default: m.MachineSpecAdmin })),
);
const PklSpecAdmin = lazy(() =>
  import('./pages/admin/PklSpecAdmin').then((m) => ({ default: m.PklSpecAdmin })),
);
const AnnSpecAdmin = lazy(() =>
  import('./pages/admin/AnnSpecAdmin').then((m) => ({ default: m.AnnSpecAdmin })),
);
const PlanningAdmin = lazy(() =>
  import('./pages/admin/PlanningAdmin').then((m) => ({ default: m.PlanningAdmin })),
);
const UsersAdmin = lazy(() =>
  import('./pages/admin/UsersAdmin').then((m) => ({ default: m.UsersAdmin })),
);
const SystemAdmin = lazy(() =>
  import('./pages/admin/SystemAdmin').then((m) => ({ default: m.SystemAdmin })),
);
const ValidationRulesAdmin = lazy(() =>
  import('./pages/admin/ValidationRulesAdmin').then((m) => ({ default: m.ValidationRulesAdmin })),
);
const QualitySpecsPage = lazy(() =>
  import('./pages/quality/QualitySpecsPage').then((m) => ({ default: m.QualitySpecsPage })),
);
const QualitySpecEditorPage = lazy(() =>
  import('./pages/quality/QualitySpecEditorPage').then((m) => ({
    default: m.QualitySpecEditorPage,
  })),
);
const MachineAssignmentPage = lazy(() =>
  import('./pages/admin/MachineAssignmentPage').then((m) => ({ default: m.MachineAssignmentPage })),
);
const RollingImportPage = lazy(() =>
  import('./pages/import/RollingImportPage').then((m) => ({ default: m.RollingImportPage })),
);
const PlanningImportHub = lazy(() =>
  import('./pages/planning/PlanningImportHub').then((m) => ({ default: m.PlanningImportHub })),
);
const OrderAssignmentPage = lazy(() =>
  import('./pages/orderAssignment/OrderAssignmentPage').then((m) => ({
    default: m.OrderAssignmentPage,
  })),
);
const CrsAssignmentPage = lazy(() =>
  import('./pages/process/CrsAssignmentPage').then((m) => ({ default: m.CrsAssignmentPage })),
);
const MachineComingSoon = lazy(() =>
  import('./pages/MachineComingSoon').then((m) => ({ default: m.MachineComingSoon })),
);
const GenericCapturePage = lazy(() =>
  import('./pages/capture/GenericCapturePage').then((m) => ({ default: m.GenericCapturePage })),
);
const UserScopeIndex = lazy(() =>
  import('./pages/UserScopeIndex').then((m) => ({ default: m.UserScopeIndex })),
);
const MachineHeadCrewPage = lazy(() =>
  import('./pages/machinehead/MachineHeadCrewPage').then((m) => ({
    default: m.MachineHeadCrewPage,
  })),
);
const MhLiveEntry = lazy(() =>
  import('./pages/machinehead/ann/MhLiveEntry').then((m) => ({ default: m.MhLiveEntry })),
);
const AnnMhLiveDashboard = lazy(() =>
  import('./pages/machinehead/ann/AnnMhLiveDashboard').then((m) => ({
    default: m.AnnMhLiveDashboard,
  })),
);
const AnnMhBatchingPage = lazy(() =>
  import('./pages/machinehead/ann/AnnMhBatchingPage').then((m) => ({
    default: m.AnnMhBatchingPage,
  })),
);
const AnnMhTrendsPage = lazy(() =>
  import('./pages/machinehead/ann/AnnMhTrendsPage').then((m) => ({ default: m.AnnMhTrendsPage })),
);
const AnnMhImportPage = lazy(() =>
  import('./pages/machinehead/ann/AnnMhImportPage').then((m) => ({ default: m.AnnMhImportPage })),
);
const HrsMhImportPage = lazy(() =>
  import('./pages/machinehead/LineMhImportPage').then((m) => ({ default: m.HrsMhImportPage })),
);
const PklMhImportPage = lazy(() =>
  import('./pages/machinehead/LineMhImportPage').then((m) => ({ default: m.PklMhImportPage })),
);
const RwdMhImportPage = lazy(() =>
  import('./pages/machinehead/LineMhImportPage').then((m) => ({ default: m.RwdMhImportPage })),
);
const RollingSkinMhImportPage = lazy(() =>
  import('./pages/machinehead/LineMhImportPage').then((m) => ({ default: m.RollingSkinMhImportPage })),
);
const LiveDashboard = lazy(() =>
  import('./pages/live/LiveDashboard').then((m) => ({ default: m.LiveDashboard })),
);
const PlantShiftReviewPage = lazy(() =>
  import('./pages/plant/PlantShiftReviewPage').then((m) => ({ default: m.PlantShiftReviewPage })),
);

function UnknownRouteRedirect() {
  const session = useSessionContext();
  const { role, lineAccess, machineAccess, username, token } = useAuthStore();
  if (!token) return <Navigate to="/login" replace />;
  if (!session.loading && session.doesSessionExist) {
    const payload = session.accessTokenPayload as Record<string, unknown>;
    const jwtRole = pickPrimaryRole(Array.isArray(payload.roles) ? (payload.roles as string[]) : []);
    if (jwtRole && role !== jwtRole) {
      return null;
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
      <Suspense fallback={<RouteSpinner />}>
        <Routes>
          <Route path="/login" element={<Login />} />

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

          <Route path="/" element={<ProtectedRoute><RoleHomeRedirect /></ProtectedRoute>} />
          <Route path="/station" element={<ProtectedRoute><RoleHomeRedirect /></ProtectedRoute>} />

          <Route path="/coming-soon/:machineCode" element={<ProtectedRoute><MachineComingSoon /></ProtectedRoute>} />
          <Route path="/capture/:machineCode" element={<ProtectedRoute><GenericCapturePage /></ProtectedRoute>} />

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
          <Route
            path="/planning/import"
            element={(
              <RoleRoute minRole={UserRole.ADMIN} allow={[UserRole.PLANNER]}>
                <PlanningImportHub />
              </RoleRoute>
            )}
          />
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
          <Route path="/machine-head/ann/report" element={<MachineHeadRoute><AnnMhReportPage /></MachineHeadRoute>} />
          <Route path="/machine-head/ann/import" element={<MachineHeadRoute><AnnMhImportPage /></MachineHeadRoute>} />
          <Route path="/machine-head/hrs/import" element={<MachineHeadRoute><HrsMhImportPage /></MachineHeadRoute>} />
          <Route path="/machine-head/pkl/import" element={<MachineHeadRoute><PklMhImportPage /></MachineHeadRoute>} />
          <Route path="/machine-head/rwd/import" element={<MachineHeadRoute><RwdMhImportPage /></MachineHeadRoute>} />
          <Route path="/machine-head/rolling/import" element={<MachineHeadRoute><RollingSkinMhImportPage /></MachineHeadRoute>} />
          <Route path="/machine-head/6hi/import" element={<Navigate to="/machine-head/rolling/import" replace />} />
          <Route path="/machine-head/4hi/import" element={<Navigate to="/machine-head/rolling/import" replace />} />
          <Route path="/machine-head/2hi/import" element={<Navigate to="/machine-head/rolling/import" replace />} />
          <Route path="/machine-head/pkl/live" element={<MachineHeadRoute><PklMhLiveDashboard /></MachineHeadRoute>} />
          <Route path="/machine-head/pkl/coil/:coilNo" element={<MachineHeadRoute><PklMhCoilDetailPage /></MachineHeadRoute>} />
          <Route path="/machine-head/pkl/specs" element={<MachineHeadRoute><PklSpecAdmin /></MachineHeadRoute>} />
          <Route path="/machine-head/hrs/live" element={<MachineHeadRoute><HrsMhLiveDashboard /></MachineHeadRoute>} />
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

          <Route path="/:userScope" element={<ProtectedRoute><UserScopeShell /></ProtectedRoute>}>
            <Route index element={<UserScopeIndex />} />
            <Route path="capture" element={<ScopeCaptureRoute />} />
            <Route path="capture/:coilNo" element={<ProcessCapturePage />} />
            <Route path="chart" element={<PklChartPage />} />
            <Route path="charge/:chargeNo" element={<AnnChargePage />} />
            <Route path="batching" element={<AnnOperatorBatchingPage />} />
            <Route path="orders" element={<AnnOperatorOrdersPage />} />
            <Route path="stoppage" element={<AnnOperatorStoppagePage />} />
            <Route path="history" element={<ProcessOperatorHistoryPage />} />
            <Route path="handover" element={<ScopeHandoverRoute />} />
            <Route path="shift-summary" element={<Navigate to="../handover" replace />} />
            <Route path="rolling" element={<SixHiQueuePage />} />
            <Route path="skinpass" element={<SixHiQueuePage />} />
            <Route path="rolling/order/:batchNo" element={<SixHiOrderPage />} />
            <Route path="skinpass/order/:batchNo" element={<SixHiOrderPage />} />
            <Route path="rewinding/:coilNo" element={<TwoHiRewindingCapturePage />} />
            <Route path="*" element={<UserScopeCatchAll />} />
          </Route>

          <Route path="*" element={<UnknownRouteRedirect />} />
        </Routes>
      </Suspense>
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
