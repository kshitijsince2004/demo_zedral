import React from 'react';
import { useGloveModeStore } from '../../lib/gloveModeStore';

interface ZInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  mono?: boolean;
}

/** Focus input on tap so tablet/mobile keyboards open reliably. */
function openKeyboardOnTap(e: React.PointerEvent<HTMLInputElement>) {
  const el = e.currentTarget;
  if (el.disabled || el.readOnly) return;
  requestAnimationFrame(() => {
    el.focus({ preventScroll: true });
    if (typeof el.setSelectionRange === 'function') {
      try {
        const len = el.value.length;
        el.setSelectionRange(len, len);
      } catch (err) {
        // Ignored. setSelectionRange is not supported on some input types (like email).
      }
    }
  });
}

export function ZInput({ label, error, mono = true, className = '', id, type, inputMode, onPointerDown, ...props }: ZInputProps) {
  const { isGloveMode } = useGloveModeStore();
  const inputId = id ?? (label ? label.replace(/\s+/g, '-').toLowerCase() : undefined);
  const height = isGloveMode ? 'h-14' : 'h-11';
  const isNumeric = type === 'number' || inputMode === 'decimal' || inputMode === 'numeric';
  const resolvedType = isNumeric ? 'text' : type;
  const resolvedInputMode = inputMode ?? (isNumeric ? 'decimal' : 'text');

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label
          htmlFor={inputId}
          className="text-[10px] uppercase tracking-[0.14em] font-medium text-muted-foreground"
        >
          {label}
        </label>
      )}
      <input
        id={inputId}
        type={resolvedType}
        inputMode={resolvedInputMode}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className={[
          height,
          'w-full rounded-sm border border-input bg-background px-3 text-base',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60 focus-visible:border-accent/50',
          'touch-manipulation cursor-text',
          mono ? 'font-mono tabular-nums' : 'font-sans',
          error ? 'border-destructive/60' : '',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        onPointerDown={(e) => {
          openKeyboardOnTap(e);
          onPointerDown?.(e);
        }}
        {...props}
      />
      {error && <span className="text-[11px] text-destructive">{error}</span>}
    </div>
  );
}
