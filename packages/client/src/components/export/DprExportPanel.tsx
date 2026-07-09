import { useState } from 'react';
import { ChartPanel } from '../analytics/ChartPanel';
import { ZButton } from '../primitives/ZButton';
import { StatusBadge } from '../ui/StatusBadge';
import { ExportJobPanel } from './ExportJobPanel';
import { reportingService } from '../../lib/reportingService';
import { getPlantClockParts } from '@m1/shared-validation';

function currentMonthValue(): string {
  const { year, month } = getPlantClockParts();
  return `${year}-${String(month).padStart(2, '0')}`;
}

type ExportStatus = 'IDLE' | 'EXPORTING' | 'SUCCESS' | 'ERROR';

export interface DprExportPanelProps {
  title?: string;
  subtitle?: string;
  scopeHint?: string;
  /** When set, shows export history link */
  historyPath?: string;
}

export function DprExportPanel({
  title = 'DPR export',
  subtitle = 'Monthly production report from live platform data',
  scopeHint,
  historyPath,
}: DprExportPanelProps) {
  const [month, setMonth] = useState(currentMonthValue());
  const [status, setStatus] = useState<ExportStatus>('IDLE');
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const monthValid = /^\d{4}-(0[1-9]|1[0-2])$/.test(month);

  const handleExport = async () => {
    setStatus('EXPORTING');
    setErrorMsg('');

    try {
      const job = await reportingService.createExportJob({
        type: 'DPR',
        format: 'XLSX',
        scope: { month },
      });

      if (job.status === 'FAILED') {
        throw new Error(job.error || 'DPR export failed');
      }

      setActiveJobId(job.jobId);
      setStatus(job.status === 'COMPLETE' ? 'SUCCESS' : 'EXPORTING');
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'DPR export failed');
      setStatus('ERROR');
    }
  };

  const handleReset = () => {
    setStatus('IDLE');
    setActiveJobId(null);
    setErrorMsg('');
  };

  const monthLabel = monthValid
    ? new Date(`${month}-01`).toLocaleString('en-IN', { month: 'long', year: 'numeric' })
    : '—';

  return (
    <div className="max-w-2xl flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
        {scopeHint && (
          <p className="text-xs text-muted-foreground mt-2">{scopeHint}</p>
        )}
      </div>

      <ChartPanel title="Export configuration">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
              Month
            </label>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="h-11 rounded-md border border-input bg-background px-3 text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            />
            {monthValid && (
              <p className="text-xs text-muted-foreground">
                Output: DPR {monthLabel}.xlsx — template format with live data
              </p>
            )}
          </div>

          {status === 'IDLE' && (
            <ZButton variant="accent" fullWidth onClick={handleExport} disabled={!monthValid}>
              Export DPR
            </ZButton>
          )}

          {(status === 'EXPORTING' || status === 'SUCCESS') && activeJobId && (
            <ExportJobPanel jobId={activeJobId} onReset={handleReset} />
          )}

          {status === 'ERROR' && (
            <div className="flex flex-col gap-3">
              <StatusBadge tone="destructive" label={errorMsg || 'Export failed'} />
              <ZButton variant="secondary" fullWidth onClick={handleReset}>
                Try again
              </ZButton>
            </div>
          )}

          {historyPath && (
            <a
              href={historyPath}
              className="text-xs text-primary hover:underline text-center"
            >
              View export history
            </a>
          )}
        </div>
      </ChartPanel>
    </div>
  );
}
