/**
 * DprExport — Monthly DPR auto-generation (E1)
 * Month picker → export job → poll → download XLSX
 */

import { useState } from 'react';
import { ExecutiveShell } from '../../components/layout/executive/ExecutiveShell';
import { ChartPanel } from '../../components/analytics/ChartPanel';
import { ZButton } from '../../components/primitives/ZButton';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { reportingService } from '../../lib/reportingService';
import { ExportJobPanel } from '../../components/export/ExportJobPanel';

function currentMonthValue(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}-${m}`;
}

type ExportStatus = 'IDLE' | 'EXPORTING' | 'SUCCESS' | 'ERROR';

export function DprExport() {
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
    <ExecutiveShell title="DPR export" subtitle="Monthly production report · E1 auto-generation">
      <div className="max-w-2xl flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Generates the monthly DPR workbook (month sheet + DELAY sheet) from captured M1 data.
          Jobs are logged in <code className="text-xs font-mono">audit.export_job</code>.
        </p>

        <ChartPanel title="DPR configuration">
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
                <p className="text-xs text-muted-foreground">Output: DPR {monthLabel.toUpperCase()}.xlsx</p>
              )}
            </div>

            {status === 'IDLE' && (
              <ZButton variant="accent" fullWidth onClick={handleExport} disabled={!monthValid}>
                Generate DPR
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
          </div>
        </ChartPanel>
      </div>
    </ExecutiveShell>
  );
}
