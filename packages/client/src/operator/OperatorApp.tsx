import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Login } from '../pages/Login';
import { RoleHomeRedirect } from '../components/RoleHomeRedirect';
import { ProtectedRoute } from '../components/ProtectedRoute';
import { MachineComingSoon } from '../pages/MachineComingSoon';
import { GenericCapturePage } from '../pages/capture/GenericCapturePage';
import { UserScopeShell } from '../components/UserScopeShell';
import { UserScopeIndex } from '../pages/UserScopeIndex';
import { SixHiCapturePage } from '../pages/sixHi/SixHiCapturePage';
import { CrmOutgoingHandoverPage } from '../pages/sixHi/CrmOutgoingHandoverPage';
import { SixHiShiftSummaryPage } from '../pages/sixHi/SixHiShiftSummaryPage';
import { SixHiQueuePage } from '../pages/sixHi/SixHiQueuePage';
import { SixHiOrderPage } from '../pages/sixHi/SixHiOrderPage';
import { SyncStatusBadge } from './sync/SyncStatusBadge';

function OperatorApp() {
  return (
    <BrowserRouter>
      <SyncStatusBadge />
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route path="/" element={<ProtectedRoute><RoleHomeRedirect /></ProtectedRoute>} />
        <Route path="/station" element={<ProtectedRoute><RoleHomeRedirect /></ProtectedRoute>} />
        <Route path="/coming-soon/:machineCode" element={<ProtectedRoute><MachineComingSoon /></ProtectedRoute>} />
        <Route path="/capture/:machineCode" element={<ProtectedRoute><GenericCapturePage /></ProtectedRoute>} />

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

        <Route path="*" element={<Navigate to="/station" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default OperatorApp;
