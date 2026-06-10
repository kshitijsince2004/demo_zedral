import React, { useState } from 'react';
import { authApi } from '../../lib/authApi';

interface FieldWrapperProps {
  label?: string;
  error?: string;
  isWarning?: boolean;
  required?: boolean;
  children: React.ReactNode;
  /** Tighter spacing + larger labels for production console / tablet */
  prominent?: boolean;
  labelClassName?: string;
  className?: string;
}

export function FieldWrapper({ label, error, isWarning, required, children, prominent, labelClassName, className }: FieldWrapperProps) {
  const [overrideActive, setOverrideActive] = useState(false);
  const [overridePin, setOverridePin] = useState('');
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const [overrideBusy, setOverrideBusy] = useState(false);

  const showOverridePrompt = isWarning && error && !overrideActive;
  const borderClass = error && !overrideActive
    ? isWarning ? 'border-warning/40' : 'border-destructive/30'
    : 'border-transparent';

  const handleOverride = async () => {
    setOverrideBusy(true);
    setOverrideError(null);
    try {
      await authApi.supervisorOverride(overridePin, label);
      setOverrideActive(true);
      setOverridePin('');
    } catch {
      setOverrideError('Invalid supervisor PIN');
      setOverridePin('');
    } finally {
      setOverrideBusy(false);
    }
  };

  return (
    <div className={[prominent ? 'mb-2' : 'mb-4', className].filter(Boolean).join(' ')}>
      {label && (
        <label
          className={[
            'block uppercase tracking-wider font-semibold text-muted-foreground',
            prominent ? 'text-xs font-bold mb-1' : 'text-[10px] mb-1.5',
            labelClassName,
          ].filter(Boolean).join(' ')}
        >
          {label}
          {required ? <span className="text-destructive ml-0.5">*</span> : null}
        </label>
      )}

      <div className={`rounded-md border-2 ${borderClass}`}>
        {children}
      </div>

      {error && !overrideActive && (
        <div className={`mt-1.5 flex items-center gap-1 text-xs font-medium ${isWarning ? 'text-warning' : 'text-destructive'}`}>
          ⚠ {error}
        </div>
      )}

      {showOverridePrompt && (
        <div className="mt-2 p-3 rounded-md bg-secondary border border-border">
          <div className="text-xs font-medium text-muted-foreground mb-2">Supervisor Override Required</div>
          <div className="flex gap-2">
            <input
              type="password"
              placeholder="Enter supervisor PIN"
              value={overridePin}
              onChange={(e) => setOverridePin(e.target.value)}
              className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            />
            <button
              type="button"
              disabled={overrideBusy || overridePin.length < 4}
              onClick={() => void handleOverride()}
              className="h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors px-3 disabled:opacity-50"
            >
              {overrideBusy ? 'Verifying…' : 'Override'}
            </button>
          </div>
          {overrideError && (
            <p className="mt-2 text-xs text-destructive">{overrideError}</p>
          )}
        </div>
      )}
    </div>
  );
}
