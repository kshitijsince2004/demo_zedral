import { useEffect, useState } from 'react';
import { apiClient } from '../../lib/apiClient';

interface ResolvedParam {
  code: string;
  label: string;
  unit?: string | null;
  group?: string | null;
  min?: number | null;
  max?: number | null;
  target?: number | null;
  tolerance?: number | null;
  textValue?: string | null;
  mandatory?: boolean;
  appliesTo?: string[];
}

interface ResolvedSpec {
  versionId: number;
  versionNo: number;
  source: string;
  mode?: string;
  parameters: ResolvedParam[];
}

interface OrderSpecReferenceProps {
  grade: string;
  sapOrderNo?: string;
  widthMm?: number;
  targetThkMm?: number;
  processCode?: string;
}

function fmt(p: ResolvedParam): string {
  if (p.textValue) return p.textValue;
  const parts: string[] = [];
  if (p.min != null) parts.push(`≥ ${p.min}`);
  if (p.max != null) parts.push(`≤ ${p.max}`);
  if (p.target != null) {
    parts.push(p.tolerance != null ? `${p.target} ± ${p.tolerance}` : `= ${p.target}`);
  }
  return parts.join(' · ') || '—';
}

/** Read-only quality limits for an order (snapshot if SAP maps, else live resolve). */
export function OrderSpecReference({
  grade,
  sapOrderNo,
  widthMm,
  targetThkMm,
  processCode,
}: OrderSpecReferenceProps) {
  const [spec, setSpec] = useState<ResolvedSpec | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!grade) {
      setSpec(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const q = new URLSearchParams();
    q.set('grade', grade);
    if (sapOrderNo) q.set('sapOrder', sapOrderNo);
    if (widthMm != null) q.set('width', String(widthMm));
    if (targetThkMm != null) q.set('thk', String(targetThkMm));
    void apiClient
      .get<ResolvedSpec | null>(`/quality/resolve?${q.toString()}`)
      .then((row) => {
        if (!cancelled) setSpec(row);
      })
      .catch(() => {
        if (!cancelled) setSpec(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [grade, sapOrderNo, widthMm, targetThkMm]);

  if (loading) {
    return (
      <section className="bg-background rounded-2xl border border-border p-5 shadow-sm">
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
          Quality Spec
        </h3>
        <p className="text-sm text-muted-foreground">Loading limits…</p>
      </section>
    );
  }

  if (!spec?.parameters?.length) {
    return (
      <section className="bg-background rounded-2xl border border-border p-5 shadow-sm">
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
          Quality Spec
        </h3>
        <p className="text-sm text-muted-foreground">No ACTIVE spec for this grade.</p>
      </section>
    );
  }

  const proc = processCode?.toUpperCase();
  const rows = proc
    ? spec.parameters.filter((p) => {
        const applies = p.appliesTo ?? [];
        if (!applies.length) return true;
        return applies.includes('ALL') || applies.map((a) => a.toUpperCase()).includes(proc);
      })
    : spec.parameters;

  return (
    <section className="bg-background rounded-2xl border border-border p-5 shadow-sm">
      <div className="flex items-baseline justify-between gap-2 mb-4">
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Quality Spec
        </h3>
        <span className="text-[10px] text-muted-foreground font-mono">
          v{spec.versionNo} · {spec.mode ?? 'resolved'} · {spec.source}
        </span>
      </div>
      <div className="overflow-auto max-h-64">
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground text-xs">
            <tr>
              <th className="pb-2 pr-2 font-medium">Parameter</th>
              <th className="pb-2 pr-2 font-medium">Limit</th>
              <th className="pb-2 font-medium">Unit</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 24).map((p) => (
              <tr key={p.code} className="border-t border-border/60">
                <td className="py-1.5 pr-2">
                  {p.label}
                  {p.mandatory ? <span className="text-destructive ml-1">*</span> : null}
                </td>
                <td className="py-1.5 pr-2 font-mono text-xs">{fmt(p)}</td>
                <td className="py-1.5 text-muted-foreground text-xs">{p.unit || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > 24 && (
          <p className="text-xs text-muted-foreground mt-2">+{rows.length - 24} more parameters</p>
        )}
      </div>
    </section>
  );
}
