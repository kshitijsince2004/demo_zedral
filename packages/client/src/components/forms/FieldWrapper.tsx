import React, { useState } from 'react';

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

  const showOverridePrompt = isWarning && error && !overrideActive;
  const borderClass = error && !overrideActive
    ? isWarning ? 'border-warning/40' : 'border-destructive/30'
    : 'border-transparent';

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
              placeholder="Enter PIN"
              value={overridePin}
              onChange={(e) => setOverridePin(e.target.value)}
              className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            />
            <button
              onClick={() => {
                if (overridePin === '1234') {
                  setOverrideActive(true);
                } else {
                  alert('Invalid PIN');
                }
              }}
              className="h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors px-3"
            >
              Override
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
