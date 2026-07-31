import { useEffect, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { OfflineBanner } from '../../ui/OfflineBanner';
import { ZPageHeader } from '../../ui/operator/ZPageHeader';
import { ZButton } from '../../primitives/ZButton';
import { deskNavOffsetClass } from '../shared/deskNavLayout';
import { MachineHeadNav } from './MachineHeadNav';
import { useOperationalMachineAccess } from '../../../lib/useOperationalMachineAccess';
import { isAnnMhDesk, useMhDeskFocus } from '../../../lib/annMhDesk';
import { isPklMhDesk, syncMhDeskFocus } from '../../../lib/pklMhDesk';

interface MachineHeadShellProps {
  title: string;
  subtitle?: string;
  onRefresh?: () => void;
  /** Extra header actions (e.g. Trends). */
  headerActions?: ReactNode;
  /** Pin content to viewport height — tab panels scroll internally. */
  fillViewport?: boolean;
  children: ReactNode;
}

export function MachineHeadShell({ title, subtitle, onRefresh, headerActions, fillViewport, children }: MachineHeadShellProps) {
  const machines = useOperationalMachineAccess();
  const focus = useMhDeskFocus((s) => s.focus);
  const setFocus = useMhDeskFocus((s) => s.setFocus);

  useEffect(() => {
    syncMhDeskFocus(machines, focus, setFocus);
  }, [machines, focus, setFocus]);

  const showSwitcher = machines.length > 1;
  const annDesk = isAnnMhDesk(machines, focus);
  const pklDesk = !annDesk && isPklMhDesk(machines, focus);

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
            <div className="z-card px-4 py-3.5 md:px-5">
              <ZPageHeader
                title={title}
                subtitle={subtitle}
                actions={
                  <div className="flex flex-wrap items-center gap-2">
                    {showSwitcher && (
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        Line
                        <select
                          className="h-9 min-h-9 rounded-lg border border-input bg-background px-2 text-sm text-foreground"
                          value={
                            annDesk
                              ? 'ANN'
                              : pklDesk
                                ? 'PKL'
                                : focus && machines.includes(focus)
                                  ? focus
                                  : (machines[0] ?? '')
                          }
                          onChange={(e) => {
                            const v = e.target.value;
                            setFocus(v || null);
                            if (v === 'ANN') window.location.assign('/machine-head/ann/live');
                            else if (annDesk) window.location.assign('/live');
                            else if (v === 'PKL' || pklDesk) window.location.assign('/live');
                          }}
                          aria-label="Desk line focus"
                        >
                          {machines.map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      </label>
                    )}
                    {headerActions}
                    {onRefresh ? (
                      <ZButton variant="secondary" size="sm" onClick={onRefresh}>
                        <RefreshCw className="h-4 w-4" aria-hidden />
                        Refresh
                      </ZButton>
                    ) : null}
                  </div>
                }
              />
            </div>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
