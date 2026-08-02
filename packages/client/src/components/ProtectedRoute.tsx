import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useSessionContext } from 'supertokens-auth-react/recipe/session';
import { KeyRound } from 'lucide-react';
import { useAuthStore } from '../lib/authStore';
import { ZButton } from './primitives/ZButton';
import { ZInput } from './primitives/ZInput';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const session = useSessionContext();
  const { token, isLocked, unlockScreen, logout } = useAuthStore();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [unlocking, setUnlocking] = useState(false);

  // ponytail: wait for SuperTokens before mounting operator shells (avoids header-less 401 race)
  if (session.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm">
        Restoring session…
      </div>
    );
  }

  // Header-mode sessions: no live ST session ⇒ login (do not trust stale mock_jwt alone)
  if (!session.doesSessionExist) {
    return <Navigate to="/login?session=expired" replace />;
  }

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  if (isLocked) {
    return (
      <div className="theme-operator min-h-screen flex items-center justify-center bg-secondary p-6">
        <div className="w-full max-w-sm border border-border bg-card rounded-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-border text-center">
            <KeyRound className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" aria-hidden />
            <h2 className="text-base font-semibold tracking-tight">Terminal locked</h2>
            <p className="text-xs text-muted-foreground mt-1">Enter PIN to resume</p>
          </div>

          <div className="p-5 flex flex-col gap-4">
            {error && (
              <div className="px-3 py-2 rounded-sm border border-destructive/40 bg-destructive/10 text-destructive text-sm text-center">
                {error}
              </div>
            )}

            <ZInput
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="PIN"
              label="PIN"
            />

            <div className="flex gap-2">
              <ZButton variant="danger" fullWidth onClick={() => logout()}>
                Logout
              </ZButton>
              <ZButton
                variant="accent"
                fullWidth
                disabled={unlocking || pin.length < 4}
                onClick={() => {
                  void (async () => {
                    setUnlocking(true);
                    setError('');
                    const ok = await unlockScreen(pin);
                    if (!ok) {
                      setError('Incorrect PIN');
                      setPin('');
                    }
                    setUnlocking(false);
                  })();
                }}
              >
                {unlocking ? 'Verifying…' : 'Unlock'}
              </ZButton>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
