import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useSessionContext } from 'supertokens-auth-react/recipe/session';
import { useAuthStore } from '../lib/authStore';
import { pickPrimaryRole } from '@m1/shared-validation';
import { Login } from '../pages/Login';
import { RoleHomeRedirect } from '../components/RoleHomeRedirect';
import { ProtectedRoute } from '../components/ProtectedRoute';
import { UserScopeShell } from '../components/UserScopeShell';

const MachineComingSoon = lazy(() =>
  import('../pages/MachineComingSoon').then((m) => ({ default: m.MachineComingSoon })),
);
const GenericCapturePage = lazy(() =>
  import('../pages/capture/GenericCapturePage').then((m) => ({ default: m.GenericCapturePage })),
);
const UserScopeIndex = lazy(() =>
  import('../pages/UserScopeIndex').then((m) => ({ default: m.UserScopeIndex })),
);
const SixHiCapturePage = lazy(() =>
  import('../pages/sixHi/SixHiCapturePage').then((m) => ({ default: m.SixHiCapturePage })),
);
const CrmOutgoingHandoverPage = lazy(() =>
  import('../pages/sixHi/CrmOutgoingHandoverPage').then((m) => ({ default: m.CrmOutgoingHandoverPage })),
);
const SixHiQueuePage = lazy(() =>
  import('../pages/sixHi/SixHiQueuePage').then((m) => ({ default: m.SixHiQueuePage })),
);
const SixHiOrderPage = lazy(() =>
  import('../pages/sixHi/SixHiOrderPage').then((m) => ({ default: m.SixHiOrderPage })),
);

function OperatorRouteFallback() {
  return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading…</div>;
}

function SuperTokensSync() {
  const session = useSessionContext();
  const { login, logout, token } = useAuthStore();

  useEffect(() => {
    if (session.loading) return;

    if (session.doesSessionExist) {
      const payload = session.accessTokenPayload as Record<string, unknown>;
      const roles = Array.isArray(payload.roles) ? (payload.roles as string[]) : [];
      const role = pickPrimaryRole(roles) ?? 'OPERATOR';
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
      if (!same) {
        login('st-session', role, lines, undefined, machines, username);
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
      <Suspense fallback={<OperatorRouteFallback />}>
        <Routes>
          <Route path="/login" element={<Login operatorOnly />} />

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
      </Suspense>
    </BrowserRouter>
  );
}

export default OperatorApp;
