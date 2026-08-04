import { useCallback, useEffect, useState } from 'react';
import { AnnOperatorHistoryPage } from './AnnOperatorHistoryPage';
import { ZButton } from '../../components/primitives/ZButton';
import { ZFilterPills } from '../../components/ui/operator/ZFilterPills';
import { apiClient } from '../../lib/apiClient';
import { useAuthStore } from '../../lib/authStore';
import { useShiftStore } from '../../store/shiftStore';
import { isProcessStationCode } from '../../lib/processConfig';

type Tab = 'orders' | 'readings';

/** Operator History for HRS/PKL/RWD — ANN keeps its own readings page. */
export function ProcessOperatorHistoryPage() {
  const processCode = (useAuthStore((s) => s.activeMachine) ?? '').toUpperCase();
  const shiftLogId = useShiftStore((s) => s.shiftLogId);
  const [tab, setTab] = useState<Tab>('orders');
  const [orders, setOrders] = useState<Array<Record<string, unknown>>>([]);
  const [readings, setReadings] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAnn = processCode === 'ANN';
  const isProcess = isProcessStationCode(processCode);
  const showReadings = processCode === 'HRS' || processCode === 'RWD';
  const code = processCode.toLowerCase();

  const load = useCallback(async () => {
    if (!shiftLogId || isAnn || !isProcess) return;
    setLoading(true);
    setError(null);
    try {
      const o = await apiClient.get<{ orders: Array<Record<string, unknown>> }>(
        `/stations/${code}/history?shiftLogId=${encodeURIComponent(shiftLogId)}`,
      );
      setOrders(o.orders ?? []);
      if (showReadings) {
        const r = await apiClient.get<{ readings: Array<Record<string, unknown>> }>(
          `/stations/${code}/readings?shiftLogId=${encodeURIComponent(shiftLogId)}`,
        );
        setReadings(r.readings ?? []);
      } else {
        setReadings([]);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load history');
    } finally {
      setLoading(false);
    }
  }, [shiftLogId, code, showReadings, isAnn, isProcess]);

  useEffect(() => { void load(); }, [load]);

  if (isAnn) return <AnnOperatorHistoryPage />;
  if (!isProcess) {
    return <p className="p-4 text-sm text-muted-foreground">History is available on process lines only.</p>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-border bg-card px-4 py-3 flex flex-wrap items-center gap-3">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">History</p>
          <h1 className="text-lg font-bold text-foreground">{processCode} · Shift log</h1>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <ZFilterPills
            options={[
              { id: 'orders', label: 'Orders' },
              ...(showReadings ? [{ id: 'readings' as const, label: 'Readings' }] : []),
            ]}
            activeId={tab}
            onChange={setTab}
          />
          <ZButton type="button" variant="secondary" size="sm" className="!h-10 !min-h-10" onClick={() => void load()}>
            Refresh
          </ZButton>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-4">
        {!shiftLogId && <p className="text-sm text-muted-foreground">No active shift log.</p>}
        {error && <p className="text-sm text-destructive mb-2">{error}</p>}
        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

        {!loading && tab === 'orders' && (
          <div className="rounded-lg border border-border bg-background overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-muted-foreground border-b border-border bg-card">
                <th className="py-2 px-2 font-medium">Coil</th>
                <th className="py-2 px-2 font-medium">Grade / Finish</th>
                <th className="py-2 px-2 font-medium">Weight MT</th>
                <th className="py-2">Meta</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((row) => (
                <tr key={String(row.id)} className="border-b border-border/50 font-mono">
                  <td className="py-2 pr-2 font-bold">{String(row.coilNo ?? '—')}</td>
                  <td className="py-2 pr-2">{String(row.gradeCode ?? row.surfaceFinish ?? '—')}</td>
                  <td className="py-2 pr-2">{row.weightMt != null ? Number(row.weightMt).toFixed(2) : '—'}</td>
                  <td className="py-2 text-muted-foreground text-xs">
                    {row.durationMin != null ? `${row.durationMin} min` : ''}
                    {row.lineSpeedMpm != null ? ` · ${row.lineSpeedMpm} m/min` : ''}
                    {row.tension1Kg != null ? ` · T ${row.tension1Kg}/${row.tension2Kg ?? '—'}/${row.tension3Kg ?? '—'}` : ''}
                    {row.status ? ` · ${row.status}` : ''}
                  </td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr><td colSpan={4} className="py-6 text-muted-foreground">No production rows this shift</td></tr>
              )}
            </tbody>
          </table>
          </div>
        )}

        {!loading && tab === 'readings' && showReadings && (
          <div className="rounded-lg border border-border bg-background overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-muted-foreground border-b border-border bg-card">
                <th className="py-2 px-2 font-medium">Coil</th>
                <th className="py-2 px-2 font-medium">Reading</th>
                <th className="py-2 px-2 font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {readings.map((row) => (
                <tr key={String(row.id)} className="border-b border-border/50 font-mono tabular-nums">
                  <td className="py-2 px-2 font-bold text-foreground">{String(row.coilNo ?? '—')}</td>
                  <td className="py-2 px-2">
                    {row.actualWidthMm != null ? `${row.actualWidthMm} mm` : ''}
                    {row.tension1Kg != null ? `T ${row.tension1Kg}/${row.tension2Kg ?? '—'}/${row.tension3Kg ?? '—'} kg` : ''}
                    {row.weightMt != null && row.actualWidthMm == null && row.tension1Kg == null
                      ? `${Number(row.weightMt).toFixed(2)} MT`
                      : ''}
                  </td>
                  <td className="py-2 px-2 text-muted-foreground text-xs">
                    {row.takenAt ? String(row.takenAt) : String(row.timeFrom ?? '—')}
                  </td>
                </tr>
              ))}
              {readings.length === 0 && (
                <tr><td colSpan={3} className="py-6 px-2 text-muted-foreground">No readings this shift</td></tr>
              )}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  );
}
