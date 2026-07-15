import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useSessionContext } from 'supertokens-auth-react/recipe/session';
import { useAuthStore } from '../lib/authStore';
import { Login } from '../pages/Login';
import { RoleHomeRedirect } from '../components/RoleHomeRedirect';
import { ProtectedRoute } from '../components/ProtectedRoute';
import { MachineComingSoon } from '../pages/MachineComingSoon';
import { GenericCapturePage } from '../pages/capture/GenericCapturePage';
import { UserScopeShell } from '../components/UserScopeShell';
import { UserScopeIndex } from '../pages/UserScopeIndex';
import { SixHiCapturePage } from '../pages/sixHi/SixHiCapturePage';
import { CrmOutgoingHandoverPage } from '../pages/sixHi/CrmOutgoingHandoverPage';
import { SixHiQueuePage } from '../pages/sixHi/SixHiQueuePage';
import { SixHiOrderPage } from '../pages/sixHi/SixHiOrderPage';

function SuperTokensSync() {
  const session = useSessionContext();
  const { login, logout, token } = useAuthStore();

  useEffect(() => {
    if (session.loading) return;

    if (session.doesSessionExist) {
      const payload = session.accessTokenPayload;
      if (token !== 'st-session') {
        const role = payload.roles?.[0] ?? 'OPERATOR';
        const lines = payload.lineAccess || [];
        const username = payload.username as string | undefined;
        login('st-session', role, lines, undefined, payload.machineAccess || [], username);
      }
    } else {
      const existingLegacy = sessionStorage.getItem('mock_jwt');
      if (!existingLegacy && token) {
        logout();
      }
    }
  }, [session, login, logout, token]);

  return null;
}

function OperatorApp() {
  return (
    <BrowserRouter>
      <SuperTokensSync />
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
          <Route path="shift-summary" element={<Navigate to="../handover" replace />} />
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
