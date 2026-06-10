/**
 * KpiDrilldownModal
 *
 * Displays the underlying coils/entries composing a KPI tile.
 * Fetches from /reports/drilldown via reportingService.getKpiDrilldown().
 *
 * Requirements: 9.5
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  reportingService,
  type DrilldownResult,
  type DrilldownScope,
} from '../../lib/reportingService';

interface KpiDrilldownModalProps {
  /** The metric key to drill into (e.g. "yield", "oee", "rejection_rate"). */
  metric: string;
  /** Human-readable label shown in the modal header. */
  label: string;
  /** Optional scope to narrow the drill-down. */
  scope?: DrilldownScope;
  onClose: () => void;
}

export function KpiDrilldownModal({
  metric,
  label,
  scope = {},
  onClose,
}: KpiDrilldownModalProps) {
  const [result, setResult] = useState<DrilldownResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await reportingService.getKpiDrilldown(metric, scope);
      setResult(data);
    } catch (err: any) {
      setError(err?.message ?? 'Unable to load drill-down data');
    } finally {
      setLoading(false);
    }
  }, [metric, JSON.stringify(scope)]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
  }, [load]);

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Drill-down: ${label}`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Panel */}
      <div className="w-full max-w-3xl max-h-[80vh] flex flex-col rounded-lg border border-border bg-card shadow-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div>
            <div className="text-xs uppercase tracking-wider font-medium text-muted-foreground">
              Drill-down
            </div>
            <div className="text-base font-semibold mt-0.5">{label}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close drill-down"
            className="h-9 w-9 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto">
          {loading && (
            <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
              Loading entries…
            </div>
          )}

          {!loading && error && (
            <div className="flex flex-col items-center justify-center gap-3 h-40">
              <span className="text-sm text-destructive">⚠ {error}</span>
              <button
                onClick={load}
                className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                Retry
              </button>
            </div>
          )}

          {!loading && !error && result && (
            <>
              {/* Summary bar */}
              <div className="px-5 py-3 border-b border-border bg-muted/30 flex items-center gap-4 text-xs text-muted-foreground">
                <span>
                  <span className="font-semibold text-foreground">{result.total}</span> entries
                </span>
                {result.scope.processId && (
                  <span>Process: <span className="font-semibold text-foreground">{result.scope.processId}</span></span>
                )}
                {result.scope.dateFrom && (
                  <span>From: <span className="font-semibold text-foreground">{result.scope.dateFrom}</span></span>
                )}
                {result.scope.dateTo && (
                  <span>To: <span className="font-semibold text-foreground">{result.scope.dateTo}</span></span>
                )}
                {result.scope.shiftCode && (
                  <span>Shift: <span className="font-semibold text-foreground">{result.scope.shiftCode}</span></span>
                )}
              </div>

              {result.entries.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
                  No entries found for this metric and scope.
                </div>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Coil No.</th>
                      <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Process</th>
                      <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Shift</th>
                      <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Date</th>
                      <th className="text-right px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.entries.map((entry) => (
                      <tr key={entry.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-2.5 text-sm font-mono font-medium">{entry.coilNo}</td>
                        <td className="px-4 py-2.5 text-sm">{entry.processId}</td>
                        <td className="px-4 py-2.5 text-sm text-muted-foreground">{entry.shiftCode}</td>
                        <td className="px-4 py-2.5 text-sm text-muted-foreground">{entry.date}</td>
                        <td className="px-4 py-2.5 text-sm font-mono font-bold text-right">
                          {entry.value} <span className="text-muted-foreground font-normal">{entry.unit}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border shrink-0 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-4 rounded-md border border-border text-sm font-medium hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
