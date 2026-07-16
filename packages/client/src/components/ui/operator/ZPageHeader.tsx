import type { ReactNode } from 'react';

interface ZPageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function ZPageHeader({ title, subtitle, actions }: ZPageHeaderProps) {
  return (
    <div className="shrink-0 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
      <div className="flex items-stretch gap-3 min-w-0">
        <span className="w-1 rounded-full bg-accent shrink-0" aria-hidden />
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-foreground truncate">{title}</h1>
          {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
