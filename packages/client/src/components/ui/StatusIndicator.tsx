import React from 'react';
import { type Tone, toneText, toneBg, toneBorder } from '../../lib/tones';

export type StatusVariant = 'success' | 'warning' | 'danger' | 'info';

const variantToTone: Record<StatusVariant, Tone> = {
  success: 'success',
  warning: 'warning',
  danger: 'destructive',
  info: 'info',
};

/**
 * SVG icons for each status variant.
 * Requirement 10.5: status indicators MUST convey state with color + icon + label,
 * never color alone.
 */
const VariantIcon: Record<StatusVariant, React.FC> = {
  success: () => (
    <svg
      aria-hidden="true"
      focusable="false"
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  warning: () => (
    <svg
      aria-hidden="true"
      focusable="false"
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  danger: () => (
    <svg
      aria-hidden="true"
      focusable="false"
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  ),
  info: () => (
    <svg
      aria-hidden="true"
      focusable="false"
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  ),
};

interface StatusIndicatorProps {
  variant: StatusVariant;
  label: string;
}

/**
 * Status indicator badge.
 *
 * Conveys state with color + icon + label (Requirement 10.5 — never color alone).
 * Uses the canonical tone maps so every status tells the same visual story
 * (zedral_design.md §8).
 */
export function StatusIndicator({ variant, label }: StatusIndicatorProps) {
  const tone = variantToTone[variant];
  const Icon = VariantIcon[variant];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${toneText[tone]} ${toneBg[tone]} ${toneBorder[tone]}`}
    >
      <Icon />
      {label}
    </span>
  );
}
