import React from 'react';
import { useGloveModeStore } from '../../lib/gloveModeStore';

/**
 * Glove-mode toggle (Requirement 10.2).
 *
 * A compact pill-shaped toggle placed in the Topbar. When active, it signals
 * the rest of the capture UI to use ≥56px hit targets and increased spacing.
 * Conveys state with color + icon + label (never color alone — Requirement 10.5).
 */
export function GloveModeToggle() {
  const { isGloveMode, toggle } = useGloveModeStore();

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={isGloveMode}
      aria-label={isGloveMode ? 'Glove mode on — click to disable' : 'Glove mode off — click to enable'}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-semibold uppercase tracking-wider transition-colors ${
        isGloveMode
          ? 'border-accent/60 bg-accent/20 text-accent-foreground'
          : 'border-border bg-secondary/60 text-muted-foreground hover:border-accent/40 hover:bg-accent/10 hover:text-accent-foreground'
      }`}
    >
      {/* Glove icon (SVG inline — no icon library per design system rules) */}
      <svg
        aria-hidden="true"
        focusable="false"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* Simplified glove outline */}
        <path d="M18 11V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2" />
        <path d="M14 10V4a2 2 0 0 0-2-2 2 2 0 0 0-2 2v2" />
        <path d="M10 10.5V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2v8" />
        <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
      </svg>
      <span>{isGloveMode ? 'Glove On' : 'Glove'}</span>
    </button>
  );
}
