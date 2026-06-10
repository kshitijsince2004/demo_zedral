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
    'bg-primary text-primary-foreground shadow hover:bg-primary/90',
  secondary:
    'bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80',
  ghost:
    'hover:bg-accent hover:text-accent-foreground',
  danger:
    'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90',
  accent:
    'border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground',
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
  const sizeClasses = {
    sm: 'h-10 min-h-10 rounded-md px-3 text-xs md:h-8 md:min-h-0',
    md: 'h-11 min-h-11 px-4 py-2 rounded-md md:h-9 md:min-h-0 text-sm',
    lg: 'h-12 min-h-12 rounded-md px-8 md:h-10 md:min-h-0 text-sm',
    touch: 'h-14 min-h-14 px-6 text-base rounded-lg',
  };
  
  const currentSizeClass = isGloveMode ? sizeClasses.touch : sizeClasses[size];

  return (
    <button
      type={type}
      className={[
        'inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
        currentSizeClass,
        variantClass[variant],
        fullWidth ? 'w-full' : '',
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
