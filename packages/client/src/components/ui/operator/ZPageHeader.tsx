import type { ReactNode } from 'react';

interface ZPageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function ZPageHeader({ title, subtitle, actions }: ZPageHeaderProps) {
  return (
    <div className="shrink-0 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-foreground">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}
