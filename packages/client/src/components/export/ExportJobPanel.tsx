import { useCallback, useEffect, useRef, useState } from 'react';
import { reportingService, type ExportJobView } from '../../lib/reportingService';
import { getAuthHeaders } from '../../lib/apiClient';
import { StatusBadge } from '../ui/StatusBadge';
import { ZButton } from '../primitives/ZButton';

interface ExportJobPanelProps {
  jobId: string | null;
  onReset?: () => void;
  pollIntervalMs?: number;
}

export function ExportJobPanel({ jobId, onReset, pollIntervalMs = 2000 }: ExportJobPanelProps) {
  const [job, setJob] = useState<ExportJobView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (id: string) => {
    try {
      const next = await reportingService.getExportJob(id);
      setJob(next);
      setError(next.error ?? null);
      return next;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load export job');
      return null;
    }
  }, []);

  useEffect(() => {
    if (!jobId) {
      setJob(null);
      setError(null);
      return;
    }

    void load(jobId);
    timerRef.current = setInterval(() => {
      void load(jobId).then((j) => {
        if (j && (j.status === 'COMPLETE' || j.status === 'FAILED')) {
          if (timerRef.current) clearInterval(timerRef.current);
        }
      });
    }, pollIntervalMs);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [jobId, load, pollIntervalMs]);

  if (!jobId) return null;

  const isRunning = job?.status === 'PENDING' || job?.status === 'PROCESSING';
  const downloadUrl = job?.downloadUrl
    ? `/api${job.downloadUrl}`
    : job?.artifact?.url
      ? `/api${job.artifact.url}`
      : null;

  const handleDownload = async () => {
    if (!downloadUrl) return;
    const res = await fetch(downloadUrl, { headers: getAuthHeaders(), credentials: 'include' });
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = job?.artifact?.filename ?? `export_${jobId}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-3">
      {isRunning && (
        <StatusBadge
          tone="info"
          label={job?.status === 'PROCESSING' ? `Exporting… ${job.progress}%` : 'Queued — waiting to start…'}
        />
      )}

      {job?.status === 'COMPLETE' && (
        <>
          <StatusBadge
            tone="success"
            label={
              job.rowCount != null
                ? `Export ready — ${job.rowCount} row${job.rowCount === 1 ? '' : 's'}`
                : 'Export ready'
            }
          />
          {job.artifact?.sha256 && (
            <p className="text-[10px] font-mono text-muted-foreground truncate" title={job.artifact.sha256}>
              sha256: {job.artifact.sha256.slice(0, 16)}…
            </p>
          )}
          <div className="flex gap-2">
            {downloadUrl && (
              <ZButton variant="accent" fullWidth onClick={() => void handleDownload()}>
                Download
              </ZButton>
            )}
            {onReset && (
              <ZButton variant="secondary" onClick={onReset}>
                New export
              </ZButton>
            )}
          </div>
        </>
      )}

      {(job?.status === 'FAILED' || error) && (
        <div className="flex flex-col gap-2">
          <StatusBadge tone="destructive" label={error || job?.error || 'Export failed'} />
          {onReset && (
            <ZButton variant="secondary" fullWidth onClick={onReset}>
              Try again
            </ZButton>
          )}
        </div>
      )}
    </div>
  );
}
