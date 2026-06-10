import type { ReactNode } from 'react';

interface ZOperatorCardProps {
  title?: string;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  noPadding?: boolean;
}

/** White rounded card on operator canvas — shared across operator screens. */
export function ZOperatorCard({
  title,
  meta,
  actions,
  children,
  className = '',
  noPadding,
}: ZOperatorCardProps) {
  const hasHeader = title || meta || actions;

  return (
    <div className={['bg-background border border-border rounded-lg shadow-sm overflow-hidden flex flex-col min-h-0', className].join(' ')}>
      {hasHeader && (
        <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {title && <span className="z-rail-label">{title}</span>}
            {meta}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </div>
      )}
      <div className={noPadding ? 'flex-1 min-h-0' : 'p-4'}>{children}</div>
    </div>
  );
}
