import { useEffect, useState } from 'react';
import { ZButton } from '../primitives/ZButton';
import { ZInput } from '../primitives/ZInput';
import { apiClient } from '../../lib/apiClient';

interface QcParam {
  code: string;
  label: string;
  unit?: string | null;
  limitKind?: string;
  min?: number | null;
  max?: number | null;
  target?: number | null;
  tolerance?: number | null;
  mandatory?: boolean;
  versionId: number;
}

interface QcCapturePanelProps {
  processCode: string;
  coilNo: string;
  gradeCode?: string;
  shiftLogId?: string;
}

function limitHint(p: QcParam): string {
  const parts: string[] = [];
  if (p.min != null) parts.push('min ' + p.min);
  if (p.max != null) parts.push('max ' + p.max);
  if (p.target != null) parts.push('tgt ' + p.target + (p.tolerance != null ? ' ±' + p.tolerance : ''));
  return parts.join(', ') || '—';
}

/** Dynamic QC capture — prefers order/coil snapshot, falls back to live grade resolve. */
export function QcCapturePanel({ processCode, coilNo, gradeCode, shiftLogId }: QcCapturePanelProps) {
  const [params, setParams] = useState<QcParam[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [verdicts, setVerdicts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!coilNo && !gradeCode) {
      setParams([]);
      return;
    }
    let cancelled = false;
    const q = new URLSearchParams({ process: processCode.toUpperCase() });
    if (coilNo) {
      q.set('by', 'coil');
      q.set('coilNo', coilNo);
      q.set('mode', 'snapshot');
    } else if (gradeCode) {
      q.set('by', 'grade+customer');
      q.set('grade', gradeCode);
    }
    void apiClient
      .get<QcParam[]>(`/quality/fetch?${q.toString()}`)
      .then((rows) => {
        if (!cancelled) setParams(rows ?? []);
      })
      .catch(() => {
        if (!cancelled) setParams([]);
      });
    return () => {
      cancelled = true;
    };
  }, [coilNo, gradeCode, processCode]);

  async function saveAll() {
    setBusy(true);
    setError(null);
    setSavedMsg(null);
    try {
      const items = params
        .map((p) => {
          const raw = values[p.code];
          if (raw == null || raw === '') return null;
          const num = Number(raw);
          return {
            coilNo,
            processCode: processCode.toUpperCase(),
            parameterCode: p.code,
            versionId: p.versionId,
            measuredValue: Number.isFinite(num) ? num : raw,
            shiftLogId: shiftLogId || undefined,
          };
        })
        .filter(Boolean);
      if (!items.length) {
        setError('Enter at least one measured value');
        return;
      }
      const saved = await apiClient.post<Array<{ parameter_code: string; verdict: string }>>(
        '/quality/qc-measurements/batch',
        { items },
      );
      const map: Record<string, string> = {};
      for (const row of saved) map[row.parameter_code] = row.verdict;
      setVerdicts(map);
      const fails = saved.filter((r) => r.verdict === 'FAIL').length;
      setSavedMsg(
        fails
          ? `Saved ${saved.length} — ${fails} OUT OF SPEC (flagged, capture not blocked)`
          : `Saved ${saved.length} measurement(s)`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'QC save failed');
    } finally {
      setBusy(false);
    }
  }

  if (!gradeCode && !coilNo) {
    return (
      <div className="mx-4 mb-4 rounded-xl border border-border bg-card p-4">
        <p className="text-sm text-muted-foreground">QC: coil/grade unknown — limits not loaded.</p>
      </div>
    );
  }

  if (!params.length) {
    return (
      <div className="mx-4 mb-4 rounded-xl border border-border bg-card p-4">
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Quality checks</p>
        <p className="mt-1 text-sm text-muted-foreground">
          No parameters apply to {processCode}{gradeCode ? ` for ${gradeCode}` : ''}.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-4 mb-6 rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Quality checks</p>
          <p className="text-sm text-muted-foreground">
            {gradeCode ?? coilNo} · {processCode} · {params.length} params (snapshot preferred)
          </p>
        </div>
        <ZButton type="button" disabled={busy} onClick={() => void saveAll()}>
          Save QC
        </ZButton>
      </div>
      {error && <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">{error}</p>}
      {savedMsg && <p className="text-sm bg-secondary/50 rounded-lg px-3 py-2">{savedMsg}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {params.map((p) => {
          const v = verdicts[p.code];
          return (
            <div key={p.code} className="border border-border rounded-lg p-3 space-y-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">
                  {p.label}
                  {p.mandatory ? <span className="text-destructive"> *</span> : null}
                </p>
                {v && (
                  <span
                    className={`ml-auto text-[10px] px-2 py-0.5 rounded ${
                      v === 'FAIL'
                        ? 'bg-destructive/15 text-destructive'
                        : v === 'PASS'
                          ? 'bg-success/15 text-success'
                          : 'bg-muted'
                    }`}
                  >
                    {v}
                  </span>
                )}
              </div>
              <p className="text-[10px] font-mono text-muted-foreground">
                {p.code} · {limitHint(p)} {p.unit || ''}
              </p>
              <ZInput
                type="number"
                value={values[p.code] ?? ''}
                onChange={(e) => setValues((prev) => ({ ...prev, [p.code]: e.target.value }))}
                placeholder="Measured"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
