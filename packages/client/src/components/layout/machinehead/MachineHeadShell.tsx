import type { ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { OfflineBanner } from '../../ui/OfflineBanner';
import { deskNavOffsetClass } from '../shared/DeskSideNav';
import { MachineHeadNav } from './MachineHeadNav';

interface MachineHeadShellProps {
  title: string;
  subtitle?: string;
  onRefresh?: () => void;
  children: ReactNode;
}

export function MachineHeadShell({ title, subtitle, onRefresh, children }: MachineHeadShellProps) {
  return (
    <div className="theme-operator min-h-screen bg-background text-foreground">
      <MachineHeadNav />
      <div className={`flex flex-col min-w-0 min-h-screen ${deskNavOffsetClass()}`}>
        <header className="shrink-0 border-b border-border bg-card px-4 md:px-5 py-4 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
            {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>
          {onRefresh && (
            <button
              onClick={onRefresh}
              className="px-3 py-1.5 flex items-center gap-2 text-sm font-medium border border-border rounded-lg bg-card hover:bg-secondary/20 transition-colors"
            >
              <RefreshCw className="h-4 w-4" />
              <span>Refresh</span>
            </button>
          )}
        </header>
        <OfflineBanner />
        <main className="flex-1 overflow-auto p-4 md:p-5 flex flex-col gap-4">{children}</main>
      </div>
    </div>
  );
}
