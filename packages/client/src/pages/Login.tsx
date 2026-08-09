import React, { useState, useEffect } from 'react';
import { KeyRound } from 'lucide-react';
import EmailPassword from 'supertokens-auth-react/recipe/emailpassword';
import Session from 'supertokens-auth-react/recipe/session';
import { pickPrimaryRole, UserRole } from '@m1/shared-validation';
import { ZButton } from '../components/primitives/ZButton';
import { ZInput } from '../components/primitives/ZInput';
import { isNative } from '../operator/native/init';
import { App } from '@capacitor/app';

/** Pilot dev credentials — match `npm run seed:users` / `seed:profiles`. */
const DEV_OPERATOR_BADGE = '3000';
const DEV_OPERATOR_PIN = '1234';
const DEV_STAFF_PASSWORD = 'Password123!';
const DEV_STAFF = {
  admin: 'admin@zedral.local',
  machinehead: 'machinehead@zedral.local',
  'mh.ann': 'machinehead.ann@zedral.local',
  supervisor: 'supervisor@zedral.local',
  planthead: 'planthead@zedral.local',
  quality: 'quality@zedral.local',
} as const;

export function Login({ operatorOnly: operatorOnlyProp }: { operatorOnly?: boolean } = {}) {
  const operatorOnly = operatorOnlyProp ?? isNative();
  const [mode, setMode] = useState<'operator' | 'staff'>('operator');
  const [badgeId, setBadgeId] = useState(import.meta.env.DEV ? DEV_OPERATOR_BADGE : '');
  const [pin, setPin] = useState(import.meta.env.DEV ? DEV_OPERATOR_PIN : '');
  const [email, setEmail] = useState(import.meta.env.DEV ? DEV_STAFF.supervisor : '');
  const [password, setPassword] = useState(import.meta.env.DEV ? DEV_STAFF_PASSWORD : '');
  const [error, setError] = useState('');
  const loginParams = new URLSearchParams(window.location.search);
  const sessionExpired = loginParams.get('session') === 'expired';
  const roleDenied = loginParams.get('role') === 'denied';
  const [clock, setClock] = useState('');
  const [appVersion, setAppVersion] = useState(import.meta.env.VITE_APP_VERSION || '');

  useEffect(() => {
    if (isNative()) {
      App.getInfo().then((info) => {
        setAppVersion(`${info.version} (${info.build})`);
      });
    }
  }, []);

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
    if (roleDenied) {
      setError('Operator APK is for OPERATOR profiles only. Staff must use the web console.');
    } else if (sessionExpired) {
      setError('Session expired. Please sign in again.');
      // Drop sticky ?session=expired so refresh / later visits stay clean
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [roleDenied, sessionExpired]);

  const badgePinLogin = async (badge: string, pinValue: string) => {
    const host = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
    const apiDomain = host || window.location.origin;
    // Absolute URL so SuperTokens fetch interceptor always matches apiDomain.
    const res = await fetch(`${apiDomain}/auth/badge-pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'st-auth-mode': 'header' },
      credentials: 'include',
      body: JSON.stringify({ badgeId: badge.trim(), pin: pinValue.trim() }),
    });
    let body: { error?: string; detail?: string } | null = null;
    try {
      body = (await res.json()) as { error?: string; detail?: string };
    } catch {
      /* empty */
    }
    if (!res.ok) {
      const err = new Error(
        body?.detail || body?.error || `Login failed (${res.status})`,
      ) as Error & {
        status?: number;
        body?: { error?: string; detail?: string };
      };
      err.status = res.status;
      err.body = body ?? undefined;
      throw err;
    }
  };

  useEffect(() => {
    if (!import.meta.env.DEV || import.meta.env.VITE_DEV_AUTO_LOGIN !== 'true') return;
    const doAutoLogin = async () => {
      try {
        await badgePinLogin(DEV_OPERATOR_BADGE, DEV_OPERATOR_PIN);
        window.location.href = '/';
      } catch (err) {
        console.error('Auto login failed', err);
      }
    };
    doAutoLogin();
  }, []);

  const handleStaffLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const res = await EmailPassword.signIn({
        formFields: [
          { id: 'email', value: email.trim() },
          { id: 'password', value: password },
        ],
      });
      if (res.status === 'WRONG_CREDENTIALS_ERROR') {
        setError('Incorrect email or password.');
        return;
      }
      if (res.status === 'FIELD_ERROR') {
        setError(res.formFields.map((f) => f.error).join(' '));
        return;
      }
      // Drop stale role from a previous login before reload/hydration.
      sessionStorage.removeItem('mock_role');
      sessionStorage.removeItem('mock_jwt');
      sessionStorage.removeItem('mock_username');
      sessionStorage.removeItem('mock_line_access');
      sessionStorage.removeItem('mock_machine_access');
      // Session cookie is set; reload so SuperTokensSync hydrates the store + routes by role.
      window.location.href = '/';
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    }
  };

  const handleOperatorLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await badgePinLogin(badgeId, pin);
      if (operatorOnly) {
        const payload = await Session.getAccessTokenPayloadSecurely();
        const roles = Array.isArray(payload.roles) ? (payload.roles as string[]) : [];
        if (pickPrimaryRole(roles) !== UserRole.OPERATOR) {
          await Session.signOut();
          setError('Operator APK is for OPERATOR profiles only. Staff must use the web console.');
          return;
        }
      }
      window.location.href = '/'; // ST header tokens saved → SuperTokensSync hydrates on reload
    } catch (err: unknown) {
      const apiErr = err as { status?: number; message?: string; body?: { error?: string; detail?: string } };
      setError(apiErr.body?.detail || apiErr.body?.error || apiErr.message || 'Invalid badge or PIN');
    }
  };

  return (
    <div className="theme-operator min-h-screen flex flex-col bg-secondary text-foreground">
      {/* Terminal header strip */}
      <header className="border-b border-border bg-nav text-nav-foreground px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="font-mono text-lg font-bold tracking-tight text-white">ZEDRAL</span>
          <span className="text-[10px] uppercase tracking-[0.18em] text-white/70">
            Operator Console · Hero Steel
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
              {!operatorOnly && (
                <div className="flex gap-2 mt-3">
                  <button
                    type="button"
                    onClick={() => setMode('operator')}
                    className={mode === 'operator' ? 'font-semibold underline text-sm' : 'text-muted-foreground text-sm'}
                  >
                    Operator (badge + PIN)
                  </button>
                  <span className="text-muted-foreground">·</span>
                  <button
                    type="button"
                    onClick={() => setMode('staff')}
                    className={mode === 'staff' ? 'font-semibold underline text-sm' : 'text-muted-foreground text-sm'}
                  >
                    Staff (email)
                  </button>
                </div>
              )}
            </div>

            {!operatorOnly && mode === 'staff' ? (
              <form onSubmit={handleStaffLogin} className="p-5 flex flex-col gap-4">
                {error && (
                  <div className="px-3 py-2 rounded-sm border border-destructive/40 bg-destructive/10 text-destructive text-sm">
                    {error}
                  </div>
                )}

                <ZInput
                  label="Email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="username"
                />

                <ZInput
                  label="Password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />

                <ZButton type="submit" variant="accent" fullWidth size="lg">
                  Sign in
                </ZButton>
              </form>
            ) : (
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
              </form>
            )}
          </div>

          {import.meta.env.DEV && !operatorOnly && (
            <div className="mt-3 space-y-2 text-center text-[10px] text-muted-foreground font-mono">
              <p>
                Operator: badge {DEV_OPERATOR_BADGE} / PIN {DEV_OPERATOR_PIN}
              </p>
              <p>Staff ({DEV_STAFF_PASSWORD}) — click to fill:</p>
              <div className="flex flex-wrap justify-center gap-1.5">
                {(Object.keys(DEV_STAFF) as (keyof typeof DEV_STAFF)[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setMode('staff');
                      setEmail(DEV_STAFF[key]);
                      setPassword(DEV_STAFF_PASSWORD);
                    }}
                    className="rounded border border-border bg-background px-2 py-1 text-[10px] uppercase tracking-wide hover:bg-muted/40"
                  >
                    {key}
                  </button>
                ))}
              </div>
            </div>
          )}

          {import.meta.env.DEV && operatorOnly && (
            <div className="mt-3 text-center text-[10px] text-muted-foreground font-mono">
              <p>
                Operator: badge {DEV_OPERATOR_BADGE} / PIN {DEV_OPERATOR_PIN}
              </p>
            </div>
          )}

          <div className="mt-4 flex flex-col items-center justify-center gap-1 text-[10px] text-muted-foreground font-medium tracking-wider uppercase text-center">
            <span>Hero Steel · MES Console</span>
            {appVersion && (
              <span className="font-mono text-primary/70 bg-secondary px-1.5 py-0.5 rounded border border-border/50">
                v{appVersion}
              </span>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
