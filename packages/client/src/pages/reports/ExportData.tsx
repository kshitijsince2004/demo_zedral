import { AdminShell } from '../../components/layout/admin/AdminShell';
/**
 * ExportData — Data Export Center (E4 RAW register)
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { ChartPanel } from '../../components/analytics/ChartPanel';
import { ZButton } from '../../components/primitives/ZButton';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { reportingService } from '../../lib/reportingService';
import { currentPlantDate } from '../../lib/dateFormat';

const SHIFT_OPTIONS = [
  { value: '', label: 'All shifts' },
  { value: 'A', label: 'Shift A' },
  { value: 'B', label: 'Shift B' },
  { value: 'C', label: 'Shift C' },
];

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'OK', label: 'OK' },
  { value: 'HOLD', label: 'Hold' },
  { value: 'REJECT', label: 'Order Hold' },
  { value: 'FOR_CTL', label: 'For CTL' },
];

type ExportStatus = 'IDLE' | 'EXPORTING' | 'SUCCESS' | 'ERROR';

function splitCsv(value: string): string[] | undefined {
  const parts = value.split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : undefined;
}

export function ExportData() {
  const [exportType, setExportType] = useState<'RAW' | 'DPR'>('RAW');
  const [processCodes, setProcessCodes] = useState('');
  const [areaCodes, setAreaCodes] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [shiftCodes, setShiftCodes] = useState('');
  const [coilNos, setCoilNos] = useState('');
  const [customerCodes, setCustomerCodes] = useState('');
  const [statuses, setStatuses] = useState('');
  const [columns, setColumns] = useState('');
  const [format, setFormat] = useState<'csv' | 'xlsx'>('csv');
  const [status, setStatus] = useState<ExportStatus>('IDLE');
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const handleExport = async () => {
    setStatus('EXPORTING');
    setErrorMsg('');

    try {
      const scope = {
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        processCodes: splitCsv(processCodes),
        areaCodes: splitCsv(areaCodes),
        shiftCodes: shiftCodes ? [shiftCodes] : undefined,
        coilNos: splitCsv(coilNos),
        customerCodes: splitCsv(customerCodes),
        statuses: splitCsv(statuses),
        columns: splitCsv(columns),
      };

      const job = await reportingService.createExportJob({
        type: exportType,
        format: format.toUpperCase() as 'CSV' | 'XLSX',
        scope: exportType === 'DPR'
          ? { month: dateFrom?.slice(0, 7) ?? currentPlantDate().slice(0, 7) }
          : scope,
      });

      if (job.status === 'FAILED') {
        throw new Error(job.error || 'Export job failed');
      }

      setActiveJobId(job.jobId);
      setStatus(job.status === 'COMPLETE' ? 'SUCCESS' : 'EXPORTING');
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Export failed. Please try again.');
      setStatus('ERROR');
    }
  };

  const handleReset = () => {
    setStatus('IDLE');
    setActiveJobId(null);
    setErrorMsg('');
  };

  const dateError =
    dateFrom && dateTo && dateTo < dateFrom ? 'End date must be on or after start date' : null;

  const isValid = !dateError && (exportType === 'DPR' || true);

  return (
    <AdminShell title="Data export" subtitle="RAW register · scoped export jobs">
      <div className="max-w-2xl flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          RAW exports use the canonical register model. For monthly DPR workbooks, use{' '}
          <Link to="/reports/exports/history" className="text-primary underline-offset-2 hover:underline">
            Export history
          </Link>
          {' · '}
          <Link to="/reports/dpr" className="text-primary underline-offset-2 hover:underline">
            DPR export
          </Link>
          . Jobs are logged in <code className="text-xs font-mono">audit.export_job</code>.
        </p>

        <ChartPanel title="Export configuration">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                Export type
              </label>
              <select
                value={exportType}
                onChange={(e) => setExportType(e.target.value as 'RAW' | 'DPR')}
                className="h-11 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                <option value="RAW">RAW register (E4)</option>
                <option value="DPR">DPR monthly (redirects scope to month)</option>
              </select>
              {exportType === 'DPR' && (
                <p className="text-xs text-muted-foreground">
                  Prefer the dedicated <Link to="/reports/dpr" className="underline">DPR page</Link> for month picker UX.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                  Date from
                </label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="h-11 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                  Date to
                </label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="h-11 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                />
              </div>
            </div>
            {dateError && (
              <div className="text-xs text-destructive font-medium -mt-3">⚠ {dateError}</div>
            )}

            {exportType === 'RAW' && (
              <>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                    Process codes (comma-separated)
                  </label>
                  <input
                    type="text"
                    placeholder="HRS, PKL, 6HI"
                    value={processCodes}
                    onChange={(e) => setProcessCodes(e.target.value)}
                    className="h-11 rounded-md border border-input bg-background px-3 text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                    Area codes (comma-separated)
                  </label>
                  <input
                    type="text"
                    placeholder="HRS, 4HI_R, CRS_1"
                    value={areaCodes}
                    onChange={(e) => setAreaCodes(e.target.value)}
                    className="h-11 rounded-md border border-input bg-background px-3 text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                      Shift
                    </label>
                    <select
                      value={shiftCodes}
                      onChange={(e) => setShiftCodes(e.target.value)}
                      className="h-11 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                    >
                      {SHIFT_OPTIONS.map((o) => (
                        <option key={o.value || 'all'} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                      Status
                    </label>
                    <select
                      value={statuses}
                      onChange={(e) => setStatuses(e.target.value)}
                      className="h-11 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                    >
                      {STATUS_OPTIONS.map((o) => (
                        <option key={o.value || 'all'} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                    Coil numbers (comma-separated)
                  </label>
                  <input
                    type="text"
                    placeholder="C-2024-001, C-2024-002"
                    value={coilNos}
                    onChange={(e) => setCoilNos(e.target.value)}
                    className="h-11 rounded-md border border-input bg-background px-3 text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                    Customer codes (comma-separated)
                  </label>
                  <input
                    type="text"
                    placeholder="CUST_TATA"
                    value={customerCodes}
                    onChange={(e) => setCustomerCodes(e.target.value)}
                    className="h-11 rounded-md border border-input bg-background px-3 text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                    Columns (optional, comma-separated keys)
                  </label>
                  <input
                    type="text"
                    placeholder="coil_no, process_code, output_weight_mt"
                    value={columns}
                    onChange={(e) => setColumns(e.target.value)}
                    className="h-11 rounded-md border border-input bg-background px-3 text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  />
                </div>
              </>
            )}

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                Format
              </label>
              <div className="flex gap-6">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="format"
                    checked={format === 'csv'}
                    onChange={() => setFormat('csv')}
                    className="accent-primary"
                  />
                  CSV (streaming)
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="format"
                    checked={format === 'xlsx'}
                    onChange={() => setFormat('xlsx')}
                    className="accent-primary"
                  />
                  Excel (XLSX + dictionary)
                </label>
              </div>
            </div>

            {status === 'IDLE' && (
              <ZButton variant="accent" fullWidth onClick={handleExport} disabled={!isValid}>
                Generate export
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
    </AdminShell>
  );
}
