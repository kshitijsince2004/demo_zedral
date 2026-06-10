import type { ReactNode } from 'react';

interface AdminPanelProps {
  title?: string;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  noPadding?: boolean;
}

export function AdminPanel({
  title,
  meta,
  actions,
  children,
  className = '',
  noPadding,
}: AdminPanelProps) {
  const hasHeader = title || meta || actions;

  return (
    <div className={`border border-border rounded-xl overflow-hidden bg-card text-card-foreground shadow ${className}`}>
      {hasHeader && (
        <div className="px-4 py-2.5 border-b border-border flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            {title && <span className="z-rail-label">{title}</span>}
            {meta}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </div>
      )}
      <div className={noPadding ? '' : 'p-0'}>{children}</div>
    </div>
  );
}
