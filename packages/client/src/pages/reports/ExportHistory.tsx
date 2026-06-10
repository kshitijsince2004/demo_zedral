import { AdminShell } from '../../components/layout/admin/AdminShell';
/**
 * ExportHistory — past export jobs with re-download (Phase 7)
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { ChartPanel } from '../../components/analytics/ChartPanel';
import { ZButton } from '../../components/primitives/ZButton';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { reportingService, type ExportJobView, type ExportType } from '../../lib/reportingService';
import { getAuthHeaders } from '../../lib/apiClient';

const TYPE_OPTIONS: Array<{ value: '' | ExportType; label: string }> = [
  { value: '', label: 'All types' },
  { value: 'RAW', label: 'RAW register' },
  { value: 'DPR', label: 'DPR' },
  { value: 'LINE_LOG', label: 'Line log' },
  { value: 'COIL_TRACE', label: 'Coil trace' },
];

function statusTone(status: ExportJobView['status']) {
  if (status === 'COMPLETE') return 'success' as const;
  if (status === 'FAILED') return 'destructive' as const;
  return 'info' as const;
}

export function ExportHistory({ embedded = false }: { embedded?: boolean }) {
  const [type, setType] = useState<'' | ExportType>('');
  const [page, setPage] = useState(1);
  const [jobs, setJobs] = useState<ExportJobView[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await reportingService.listExportHistory({
        type: type || undefined,
        page,
        limit: 15,
      });
      setJobs(result.jobs);
      setTotalPages(result.pages);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load export history');
    } finally {
      setLoading(false);
    }
  }, [type, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDownload = async (job: ExportJobView) => {
    const url = job.signedDownloadUrl
      ? job.signedDownloadUrl
      : job.downloadUrl
        ? `/api${job.downloadUrl}`
        : job.artifact?.url
          ? `/api${job.artifact.url}`
          : null;
    if (!url) return;

    const res = await fetch(url, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = job.artifact?.filename ?? `export_${job.jobId}`;
    a.click();
    URL.revokeObjectURL(objectUrl);
  };

  const content = (
    <div className="max-w-4xl flex flex-col gap-4">
      {!embedded && (
        <p className="text-sm text-muted-foreground">
          Jobs are recorded in <code className="text-xs font-mono">audit.export_job</code> with sha256 and data version.
          {' '}<Link to="/reports/export" className="text-primary underline-offset-2 hover:underline">New export</Link>
        </p>
      )}

        <ChartPanel title="Filters">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                Type
              </label>
              <select
                value={type}
                onChange={(e) => { setType(e.target.value as '' | ExportType); setPage(1); }}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                {TYPE_OPTIONS.map((o) => (
                  <option key={o.value || 'all'} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <ZButton variant="secondary" onClick={() => void load()} disabled={loading}>
              Refresh
            </ZButton>
          </div>
        </ChartPanel>

        {error && <StatusBadge tone="destructive" label={error} />}

        <ChartPanel title="Past jobs">
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!loading && jobs.length === 0 && (
            <p className="text-sm text-muted-foreground">No export jobs found.</p>
          )}
          <ul className="flex flex-col gap-2">
            {jobs.map((job) => (
              <li
                key={job.jobId}
                className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-md border border-border bg-card text-sm"
              >
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="font-mono text-xs truncate">{job.jobId}</span>
                  <span className="text-muted-foreground text-xs">
                    {job.type ?? 'RAW'} · {new Date(job.createdAt).toLocaleString()}
                    {job.rowCount != null ? ` · ${job.rowCount} rows` : ''}
                  </span>
                  {job.dataVersion && (
                    <span className="text-[10px] font-mono text-muted-foreground truncate">{job.dataVersion}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <StatusBadge tone={statusTone(job.status)} label={job.status} />
                  {job.status === 'COMPLETE' && (job.downloadUrl || job.artifact?.url) && (
                    <ZButton variant="accent" onClick={() => void handleDownload(job)}>
                      Download
                    </ZButton>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {totalPages > 1 && (
            <div className="flex gap-2 mt-4 justify-center">
              <ZButton variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </ZButton>
              <span className="text-xs self-center text-muted-foreground">Page {page} / {totalPages}</span>
              <ZButton variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </ZButton>
            </div>
          )}
        </ChartPanel>
      </div>
  );

  if (embedded) return content;

  return (
    <AdminShell title="Export history" subtitle="Audit trail · re-download past artifacts">
      {content}
    </AdminShell>
  );
}
