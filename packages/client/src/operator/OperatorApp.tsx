import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useSessionContext } from 'supertokens-auth-react/recipe/session';
import { useAuthStore } from '../lib/authStore';
import { pickPrimaryRole } from '@m1/shared-validation';
import { Login } from '../pages/Login';
import { RoleHomeRedirect } from '../components/RoleHomeRedirect';
import { ProtectedRoute } from '../components/ProtectedRoute';
import { UserScopeShell } from '../components/UserScopeShell';
import { RouteSpinner } from '../components/RouteSpinner';

const MachineComingSoon = lazy(() =>
  import('../pages/MachineComingSoon').then((m) => ({ default: m.MachineComingSoon })),
);
const GenericCapturePage = lazy(() =>
  import('../pages/capture/GenericCapturePage').then((m) => ({ default: m.GenericCapturePage })),
);
const UserScopeIndex = lazy(() =>
  import('../pages/UserScopeIndex').then((m) => ({ default: m.UserScopeIndex })),
);
const TwoHiRewindingCapturePage = lazy(() =>
  import('../pages/sixHi/TwoHiRewindingCapturePage').then((m) => ({ default: m.TwoHiRewindingCapturePage })),
);
const SixHiQueuePage = lazy(() =>
  import('../pages/sixHi/SixHiQueuePage').then((m) => ({ default: m.SixHiQueuePage })),
);
const SixHiOrderPage = lazy(() =>
  import('../pages/sixHi/SixHiOrderPage').then((m) => ({ default: m.SixHiOrderPage })),
);
const ProcessOperatorHistoryPage = lazy(() =>
  import('../pages/process/ProcessOperatorHistoryPage').then((m) => ({ default: m.ProcessOperatorHistoryPage })),
);
const ScopeCaptureRoute = lazy(() =>
  import('../components/ScopeCaptureRoute').then((m) => ({ default: m.ScopeCaptureRoute })),
);
const ProcessCapturePage = lazy(() =>
  import('../pages/process/ProcessCapturePage').then((m) => ({ default: m.ProcessCapturePage })),
);
const ScopeHandoverRoute = lazy(() =>
  import('../components/ScopeHandoverRoute').then((m) => ({ default: m.ScopeHandoverRoute })),
);
const PklChartPage = lazy(() =>
  import('../pages/process/PklChartPage').then((m) => ({ default: m.PklChartPage })),
);

function OperatorRouteFallback() {
  return <RouteSpinner />;
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
        void import('./sync/pull').then((m) => m.prefetchOperatorCaches()).catch(() => undefined);
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
            <Route path="capture" element={<ScopeCaptureRoute />} />
            <Route path="capture/:coilNo" element={<ProcessCapturePage />} />
            <Route path="chart" element={<PklChartPage />} />
            <Route path="history" element={<ProcessOperatorHistoryPage />} />
            <Route path="handover" element={<ScopeHandoverRoute />} />
            <Route path="shift-summary" element={<Navigate to="../handover" replace />} />
            <Route path="rolling" element={<SixHiQueuePage />} />
            <Route path="skinpass" element={<SixHiQueuePage />} />
            <Route path="rolling/order/:batchNo" element={<SixHiOrderPage />} />
            <Route path="skinpass/order/:batchNo" element={<SixHiOrderPage />} />
            <Route path="rewinding/:coilNo" element={<TwoHiRewindingCapturePage />} />
          </Route>

          <Route path="*" element={<Navigate to="/station" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default OperatorApp;
