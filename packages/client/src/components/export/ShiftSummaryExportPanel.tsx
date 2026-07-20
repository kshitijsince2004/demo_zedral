import { useMemo, useState } from 'react';
import { ChartPanel } from '../analytics/ChartPanel';
import { ZButton } from '../primitives/ZButton';
import { StatusBadge } from '../ui/StatusBadge';
import { ExportJobPanel } from './ExportJobPanel';
import { reportingService } from '../../lib/reportingService';
import { currentPlantDate } from '../../lib/dateFormat';

type ExportStatus = 'IDLE' | 'EXPORTING' | 'SUCCESS' | 'ERROR';
type ExportFormat = 'XLSX' | 'PDF' | 'CSV';

export interface ShiftSummaryExportPanelProps {
  title?: string;
  subtitle?: string;
  scopeHint?: string;
  historyPath?: string;
  machineCodes?: string[];
}

export function ShiftSummaryExportPanel({
  title = 'Shift Summary export',
  subtitle = 'Production report for a specific date, shift, and machine',
  scopeHint,
  historyPath,
  machineCodes,
}: ShiftSummaryExportPanelProps) {
  const [date, setDate] = useState(currentPlantDate());
  const [shiftCode, setShiftCode] = useState('A');
  const [machine, setMachine] = useState(machineCodes?.[0] ?? '');
  const [format, setFormat] = useState<ExportFormat>('XLSX');
  const [status, setStatus] = useState<ExportStatus>('IDLE');
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const machineOptions = useMemo(() => {
    if (machineCodes?.length) return machineCodes;
    return ['6HI', '4HI', '2HI'];
  }, [machineCodes]);

  const handleExport = async () => {
    setStatus('EXPORTING');
    setErrorMsg('');

    try {
      const scope: Record<string, string | string[]> = {
        date,
        shiftCode,
      };
      if (machine) {
        scope.machineCodes = machineCodes?.length ? [machine] : [machine];
      } else if (machineCodes?.length) {
        scope.machineCodes = machineCodes;
      }

      const job = await reportingService.createExportJob({
        type: 'SHIFT_SUMMARY',
        format,
        scope,
      });

      if (job.status === 'FAILED') {
        throw new Error(job.error || 'Shift summary export failed');
      }

      setActiveJobId(job.jobId);
      setStatus(job.status === 'COMPLETE' ? 'SUCCESS' : 'EXPORTING');
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Shift summary export failed');
      setStatus('ERROR');
    }
  };

  const handleReset = () => {
    setStatus('IDLE');
    setActiveJobId(null);
    setErrorMsg('');
  };

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
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                Date
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="h-11 rounded-md border border-input bg-background px-3 text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                Shift
              </label>
              <select
                value={shiftCode}
                onChange={(e) => setShiftCode(e.target.value)}
                className="h-11 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                {['A', 'B', 'C'].map((s) => (
                  <option key={s} value={s}>Shift {s}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                Machine
              </label>
              <select
                value={machine}
                onChange={(e) => setMachine(e.target.value)}
                className="h-11 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                {!machineCodes?.length && <option value="">All machines</option>}
                {machineOptions.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
              Format
            </label>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as ExportFormat)}
              className="h-11 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <option value="XLSX">Excel (.xlsx)</option>
              <option value="PDF">PDF</option>
              <option value="CSV">CSV</option>
            </select>
          </div>

          {status === 'IDLE' && (
            <ZButton variant="accent" fullWidth onClick={handleExport} disabled={!date || !shiftCode}>
              Export Shift Summary
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
