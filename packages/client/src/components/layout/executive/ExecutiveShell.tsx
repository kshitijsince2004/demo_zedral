import type { ReactNode } from 'react';
import { OfflineBanner } from '../../ui/OfflineBanner';
import { deskNavOffsetClass } from '../shared/DeskSideNav';
import { ExecutiveNav } from './ExecutiveNav';

interface ExecutiveShellProps {
  title: string;
  subtitle?: string;
  controls?: ReactNode;
  children: ReactNode;
}

export function ExecutiveShell({ title, subtitle, controls, children }: ExecutiveShellProps) {
  return (
    <div className="theme-operator min-h-screen bg-background text-foreground">
      <ExecutiveNav />
      <div className={`flex flex-col min-w-0 min-h-screen ${deskNavOffsetClass()}`}>
        <header className="shrink-0 border-b border-border bg-card px-4 md:px-5 py-4 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
            {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>
          {controls}
        </header>
        <OfflineBanner />
        <main className="flex-1 overflow-auto p-4 md:p-5 flex flex-col gap-4">{children}</main>
      </div>
    </div>
  );
}
