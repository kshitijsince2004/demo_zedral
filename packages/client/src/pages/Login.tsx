import React, { useState, useEffect } from 'react';
import { BadgeCheck, KeyRound } from 'lucide-react';
import { useAuthStore } from '../lib/authStore';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../lib/apiClient';
import { scheduleAccessTokenRefresh } from '../lib/authSession';
import { getRoleHomePath } from '../lib/roleHome';
import { bootstrapShiftContext } from '../lib/shiftDetection';
import { ZButton } from '../components/primitives/ZButton';
import { ZInput } from '../components/primitives/ZInput';

/** Pilot dev credentials — match `npm run seed:users` (PIN 1234 for all seeded badges). */
const DEV_OPERATOR_BADGE = '3000';
const DEV_OPERATOR_PIN = '1234';

function decodeToken(accessToken: string) {
  const base64Url = accessToken.split('.')[1];
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(window.atob(base64));
}

export function Login() {
  const { login } = useAuthStore();
  const navigate = useNavigate();
  const [badgeId, setBadgeId] = useState(import.meta.env.DEV ? DEV_OPERATOR_BADGE : '');
  const [pin, setPin] = useState(import.meta.env.DEV ? DEV_OPERATOR_PIN : '');
  const [error, setError] = useState('');
  const sessionExpired = new URLSearchParams(window.location.search).get('session') === 'expired';
  const [clock, setClock] = useState('');

  useEffect(() => {
    const tick = () => {
      setClock(
        new Date().toLocaleString('en-IN', {
          timeZone: 'Asia/Kolkata',
          weekday: 'short',
          day: '2-digit',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }),
      );
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (sessionExpired) {
      setError('Session expired. Please sign in again.');
    }
  }, [sessionExpired]);

  useEffect(() => {
    console.log('Login component mounted');
    console.log('VITE_API_URL:', import.meta.env.VITE_API_URL);
    if (!import.meta.env.DEV || import.meta.env.VITE_DEV_AUTO_LOGIN !== 'true') return;
    const doAutoLogin = async () => {
      try {
        const data = await apiClient.post('/auth/badge-pin', {
          badgeId: DEV_OPERATOR_BADGE,
          pin: DEV_OPERATOR_PIN,
        });
        const payload = decodeToken(data.accessToken);
        const role = payload.roles?.[0] ?? 'OPERATOR';
        const username = payload.username as string | undefined;
        login(data.accessToken, role, payload.lineAccess || [], data.refreshToken, payload.machineAccess || [], username);
        navigate(getRoleHomePath(role, payload.lineAccess || [], payload.machineAccess || [], username));
      } catch (err) {
        console.error('Auto login failed', err);
      }
    };
    doAutoLogin();
  }, [login, navigate]);

  const finishLogin = async (accessToken: string, refreshToken?: string) => {
    const payload = decodeToken(accessToken);
    const role = payload.roles?.[0] ?? 'OPERATOR';
    const lines = payload.lineAccess || [];
    const username = payload.username as string | undefined;
    login(accessToken, role, lines, refreshToken, payload.machineAccess || [], username);
    scheduleAccessTokenRefresh(accessToken);
    try {
      const machines = (payload.machineAccess || []) as string[];
      await bootstrapShiftContext(machines[0]);
    } catch {
      /* shift detection is best-effort until migration runs */
    }
    navigate(getRoleHomePath(role, lines, payload.machineAccess || [], username));
  };

  const handleOperatorLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setError('');
      console.log('Attempting login with:', { badgeId, pin });
      const data = await apiClient.post('/auth/badge-pin', { badgeId, pin });
      console.log('Login successful:', data);
      finishLogin(data.accessToken, data.refreshToken);
    } catch (err: unknown) {
      console.error('Login failed:', err);
      const apiErr = err as { status?: number; message?: string; body?: { error?: string } };
      const statusText = apiErr.status ? ` (Status: ${apiErr.status})` : '';
      const errorMessage = apiErr.body?.error || apiErr.message || 'Invalid badge or PIN';
      setError(`${errorMessage}${statusText}`);
    }
  };

  const handleSSOLogin = async () => {
    try {
      setError('');
      const data = await apiClient.post('/auth/token', { code: 'sub-3' });
      finishLogin(data.accessToken, data.refreshToken);
    } catch (err: unknown) {
      const body = (err as { body?: { error?: string } })?.body;
      setError(body?.error ?? 'SSO login failed');
    }
  };

  return (
    <div className="theme-operator min-h-screen flex flex-col bg-secondary text-foreground">
      {/* Terminal header strip */}
      <header className="border-b border-border bg-nav text-nav-foreground px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="font-mono text-lg font-bold tracking-tight text-white">ZEDRAL</span>
          <span className="text-[10px] uppercase tracking-[0.18em] text-white/70">
            M1 · Plant 1100
          </span>
        </div>
        <span className="font-mono text-xs text-white/70 tabular-nums">{clock} IST</span>
      </header>

      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="border border-border bg-background rounded-lg shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border">
              <h1 className="text-base font-semibold tracking-tight">Terminal unlock</h1>
              <p className="text-xs text-muted-foreground mt-1">
                Scan badge or enter operator credentials
              </p>
            </div>

            <form onSubmit={handleOperatorLogin} className="p-5 flex flex-col gap-4">
              {error && (
                <div className="px-3 py-2 rounded-sm border border-destructive/40 bg-destructive/10 text-destructive text-sm">
                  {error}
                </div>
              )}

              <ZInput
                label="Badge ID"
                value={badgeId}
                onChange={(e) => setBadgeId(e.target.value)}
                placeholder="Scan or type badge"
                autoComplete="username"
              />

              <ZInput
                label="PIN"
                type="password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="••••"
                autoComplete="current-password"
              />

              <ZButton type="submit" variant="accent" fullWidth size="lg">
                <KeyRound className="h-4 w-4" aria-hidden />
                Unlock terminal
              </ZButton>

              <div className="relative py-1">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center">
                  <span className="bg-card px-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                    supervisor / office
                  </span>
                </div>
              </div>

              <ZButton type="button" variant="secondary" fullWidth onClick={handleSSOLogin}>
                <BadgeCheck className="h-4 w-4" aria-hidden />
                Corporate SSO
              </ZButton>
            </form>
          </div>

          {import.meta.env.DEV && (
            <p className="text-center text-[10px] text-muted-foreground mt-3 font-mono">
              Dev: badge 3000 / PIN 1234 (operator) · 2000 supervisor · 1000 admin
            </p>
          )}

          <p className="text-center text-[10px] text-muted-foreground mt-2 tracking-wide">
            Hero Steel · MES data collection terminal
          </p>
        </div>
      </main>
    </div>
  );
}
