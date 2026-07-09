import type { ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { OfflineBanner } from '../../ui/OfflineBanner';
import { ZPageHeader } from '../../ui/operator/ZPageHeader';
import { ZButton } from '../../primitives/ZButton';
import { deskNavOffsetClass } from '../shared/deskNavLayout';
import { MachineHeadNav } from './MachineHeadNav';

interface MachineHeadShellProps {
  title: string;
  subtitle?: string;
  onRefresh?: () => void;
  /** Pin content to viewport height — tab panels scroll internally. */
  fillViewport?: boolean;
  children: ReactNode;
}

export function MachineHeadShell({ title, subtitle, onRefresh, fillViewport, children }: MachineHeadShellProps) {
  return (
    <div className="theme-operator min-h-screen bg-background text-foreground">
      <MachineHeadNav />
      <div className={`flex flex-col min-w-0 min-h-screen ${deskNavOffsetClass()}`}>
        <OfflineBanner />
        <main className={`flex-1 flex flex-col min-h-0 bg-secondary ${fillViewport ? 'overflow-hidden' : ''}`}>
          <div
            className={[
              'flex flex-col gap-4 p-4 md:p-5',
              fillViewport ? 'flex-1 min-h-0 overflow-hidden' : 'flex-1 overflow-auto',
            ].join(' ')}
          >
            <ZPageHeader
              title={title}
              subtitle={subtitle}
              actions={
                onRefresh ? (
                  <ZButton variant="secondary" size="sm" onClick={onRefresh}>
                    <RefreshCw className="h-4 w-4" aria-hidden />
                    Refresh
                  </ZButton>
                ) : undefined
              }
            />
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
