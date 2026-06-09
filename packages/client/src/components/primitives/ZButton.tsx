import React from 'react';
import { useGloveModeStore } from '../../lib/gloveModeStore';

type ZButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';
type ZButtonSize = 'sm' | 'md' | 'lg';

interface ZButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ZButtonVariant;
  size?: ZButtonSize;
  fullWidth?: boolean;
}

const variantClass: Record<ZButtonVariant, string> = {
  primary:
    'bg-primary text-primary-foreground border border-primary hover:bg-primary/90 active:bg-primary/80',
  secondary:
    'bg-transparent text-foreground border border-border hover:bg-secondary/80 active:bg-secondary',
  ghost:
    'bg-transparent text-muted-foreground border border-transparent hover:text-foreground hover:bg-secondary/60',
  danger:
    'bg-transparent text-destructive border border-destructive/40 hover:bg-destructive/10',
  accent:
    'bg-accent text-accent-foreground border border-accent hover:bg-accent/90',
};

export function ZButton({
  variant = 'secondary',
  size = 'md',
  fullWidth,
  className = '',
  children,
  type = 'button',
  ...props
}: ZButtonProps) {
  const { isGloveMode } = useGloveModeStore();
  const height =
    size === 'lg' || isGloveMode ? 'h-14' : size === 'sm' ? 'h-9' : 'h-11';
  const text = size === 'sm' ? 'text-xs' : 'text-sm';

  return (
    <button
      type={type}
      className={[
        'inline-flex items-center justify-center gap-2 font-medium tracking-tight',
        'rounded-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        'disabled:opacity-45 disabled:cursor-not-allowed',
        height,
        text,
        variantClass[variant],
        fullWidth ? 'w-full' : 'px-4',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    >
      {children}
    </button>
  );
}
