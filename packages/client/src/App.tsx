import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './lib/authStore';
import { getRoleHomePath } from './lib/roleHome';

import { Login } from './pages/Login';
import { SetupPage } from './pages/SetupPage';
import { RoleHomeRedirect } from './components/RoleHomeRedirect';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AdminRoute, PlantRoute, MachineHeadRoute } from './components/RoleRoute';
// SixHi Hub & Routes
import { SixHiQueuePage } from './pages/sixHi/SixHiQueuePage';
import { SixHiOrderPage } from './pages/sixHi/SixHiOrderPage';
import { SixHiShiftSummaryPage } from './pages/sixHi/SixHiShiftSummaryPage';
import { CrmOutgoingHandoverPage } from './pages/sixHi/CrmOutgoingHandoverPage';
import { SixHiCapturePage } from './pages/sixHi/SixHiCapturePage';

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
import { IntelligenceComingSoon } from './pages/reports/IntelligenceComingSoon';
import { AuditTrailView } from './pages/audit/AuditTrailView';

// Admin
import { MasterDataAdmin } from './pages/admin/MasterDataAdmin';
import { MachineMasterAdmin } from './pages/admin/MachineMasterAdmin';
import { PlanningAdmin } from './pages/admin/PlanningAdmin';
import { UsersAdmin } from './pages/admin/UsersAdmin';
import { SystemAdmin } from './pages/admin/SystemAdmin';
import { ValidationRulesAdmin } from './pages/admin/ValidationRulesAdmin';
import { MachineAssignmentPage } from './pages/admin/MachineAssignmentPage';
import { RollingImportPage } from './pages/import/RollingImportPage';
import { OrderAssignmentPage } from './pages/orderAssignment/OrderAssignmentPage';
import { OrderAssignmentPanel } from './pages/orderAssignment/OrderAssignmentPanel';
import { MachineComingSoon } from './pages/MachineComingSoon';
import { GenericCapturePage } from './pages/capture/GenericCapturePage';
import { UserScopeShell } from './components/UserScopeShell';
import { UserScopeIndex } from './pages/UserScopeIndex';
import { LegacyMillRedirect } from './components/LegacyMillRedirect';
import { MachineHeadDashboard } from './pages/live/MachineHeadDashboard';
import { MachineHeadCrewPage } from './pages/machinehead/MachineHeadCrewPage';
import { LiveDashboard } from './pages/live/LiveDashboard';
import { UnifiedShell } from './components/layout/UnifiedShell';
import { PlantShiftReviewPage } from './pages/plant/PlantShiftReviewPage';

function UnknownRouteRedirect() {
  const { role, lineAccess, machineAccess, username, token } = useAuthStore();
  if (!token) return <Navigate to="/login" replace />;
  return <Navigate to={getRoleHomePath(role, lineAccess, machineAccess, username)} replace />;
}

function App() {
  return (
    <BrowserRouter>
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
        <Route path="/crm6" element={<ProtectedRoute><LegacyMillRedirect machine="6HI" /></ProtectedRoute>} />
        <Route path="/crm6/*" element={<ProtectedRoute><LegacyMillRedirect machine="6HI" /></ProtectedRoute>} />
        <Route path="/dashboard" element={<ProtectedRoute><RoleHomeRedirect /></ProtectedRoute>} />

        <Route path="/reports/plant-head" element={<PlantRoute><Navigate to="/plant" replace /></PlantRoute>} />
        <Route path="/plant" element={<PlantRoute><UnifiedShell /></PlantRoute>}>
          <Route index element={<PlantHeadDashboard />} />
          <Route path="live" element={<LiveDashboard />} />
          <Route path="production" element={<PlantProduction />} />
          <Route path="orders" element={<PlantOrderTracking />} />
          <Route path="defect-intelligence" element={<IntelligenceComingSoon title="Defect Intelligence" />} />
          <Route path="downtime-intelligence" element={<IntelligenceComingSoon title="Downtime Intelligence" />} />
          <Route path="audit" element={<AuditTrailView />} />
          <Route path="users" element={<UsersAdmin embedded />} />
          <Route path="defects" element={<PlantDefects />} />
          <Route path="stoppages" element={<PlantStoppages />} />
          <Route path="alerts" element={<PlantAlerts />} />
          <Route path="order-assignment" element={<OrderAssignmentPanel />} />
          <Route path="shift-review" element={<PlantShiftReviewPage />} />
          <Route path="setup" element={<SetupPage embedded />} />
          <Route path="dpr-export" element={<PlantDprExport />} />
          <Route path="exports/history" element={<ExportHistory embedded />} />
        </Route>
        <Route path="/audit" element={<PlantRoute><Navigate to="/plant/audit" replace /></PlantRoute>} />
        <Route path="/reports/export" element={<PlantRoute><Navigate to="/plant/dpr-export" replace /></PlantRoute>} />
        <Route path="/reports/exports/history" element={<PlantRoute><Navigate to="/plant/exports/history" replace /></PlantRoute>} />
        <Route path="/reports/dpr" element={<PlantRoute><Navigate to="/plant/dpr-export" replace /></PlantRoute>} />

        <Route path="/import/rolling" element={<MachineHeadRoute><RollingImportPage /></MachineHeadRoute>} />
        <Route path="/order-assignment" element={<MachineHeadRoute><OrderAssignmentPage /></MachineHeadRoute>} />
        <Route path="/admin/machine-assignment" element={<AdminRoute><MachineAssignmentPage /></AdminRoute>} />
        <Route path="/machine-head-dashboard" element={<MachineHeadRoute><MachineHeadDashboard /></MachineHeadRoute>} />
        <Route path="/machine-head/crew" element={<MachineHeadRoute><MachineHeadCrewPage /></MachineHeadRoute>} />
        <Route path="/machine-head/dpr-export" element={<MachineHeadRoute><MachineDprExport /></MachineHeadRoute>} />
        <Route path="/machine-head/exports/history" element={<MachineHeadRoute><ExportHistory embedded /></MachineHeadRoute>} />

        <Route path="/admin/master-data" element={<AdminRoute><MasterDataAdmin /></AdminRoute>} />
        <Route path="/admin/machines" element={<AdminRoute><MachineMasterAdmin /></AdminRoute>} />
        <Route path="/admin/planning" element={<AdminRoute><PlanningAdmin /></AdminRoute>} />
        <Route path="/admin/users" element={<AdminRoute><UsersAdmin /></AdminRoute>} />
        <Route path="/admin/system" element={<AdminRoute><SystemAdmin /></AdminRoute>} />
        <Route path="/admin/validation-rules" element={<AdminRoute><ValidationRulesAdmin /></AdminRoute>} />

        {/* User workspace — /username.role (must be last — catches dotted paths only) */}
        <Route path="/:userScope" element={<ProtectedRoute><UserScopeShell /></ProtectedRoute>}>
          <Route index element={<UserScopeIndex />} />
          <Route path="capture" element={<SixHiCapturePage />} />
          <Route path="handover" element={<CrmOutgoingHandoverPage />} />
          <Route path="shift-summary" element={<SixHiShiftSummaryPage />} />
          <Route path="rolling" element={<SixHiQueuePage />} />
          <Route path="skinpass" element={<SixHiQueuePage />} />
          <Route path="rolling/order/:batchNo" element={<SixHiOrderPage />} />
          <Route path="skinpass/order/:batchNo" element={<SixHiOrderPage />} />
        </Route>

        <Route path="*" element={<UnknownRouteRedirect />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
