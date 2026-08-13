import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { MachineHeadShell } from '../../../components/layout/machinehead/MachineHeadShell';
import { ZButton } from '../../../components/primitives/ZButton';
import { apiClient } from '../../../lib/apiClient';
import { formatPlantDateTime } from '../../../lib/dateFormat';
import { displayMotherCoilId } from '../../../lib/sixHiOrderIdentity';
import { deleteHrsPklOrder, reinstateHrsPklOrder } from '../../../lib/hrsPklWrites';

type Prefill = {
  coilNo?: string;
  gradeCode?: string;
  weightMt?: number;
  motherCoilNo?: string;
  slitId?: string;
  prefill?: Record<string, unknown>;
  pklCapture?: {
    lineSpeedMpm?: number;
    repeats?: number;
    ht?: string;
    wp?: string;
    endFilling?: boolean;
    weightMt?: number;
    operatorName?: string;
  } | null;
};

/** Full-screen PKL coil detail for MH desk. */
export function PklMhCoilDetailPage() {
  const { coilNo: raw } = useParams();
  const coilNo = raw ? decodeURIComponent(raw) : '';
  const navigate = useNavigate();
  const [data, setData] = useState<Prefill | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!coilNo) return;
    void Promise.all([
      apiClient.get<Prefill>(`/stations/pkl/entry/${encodeURIComponent(coilNo)}`),
      apiClient.get<{ status?: string }>(`/pkl-order/orders/${encodeURIComponent(coilNo)}`).catch(() => null),
    ])
      .then(([entry, order]) => {
        setData(entry);
        setStatus(order?.status ?? null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Load failed'));
  }, [coilNo]);

  const p = data?.prefill ?? {};
  const c = data?.pklCapture ?? {};
  const coilIdentity = displayMotherCoilId({
    motherCoilNo: String(data?.motherCoilNo ?? p.motherCoilNo ?? '') || undefined,
    coilNo: data?.coilNo ?? coilNo,
    batchNumber: coilNo,
    slitId: String(data?.slitId ?? p.slitId ?? '') || undefined,
  });
  const endRaw = c.endFilling ?? p.endFilling ?? p.end_filling;
  const endFilling = endRaw === true || endRaw === 'true' ? 'Yes'
    : endRaw === false || endRaw === 'false' ? 'No'
      : '—';
  const weight = c.weightMt ?? data?.weightMt ?? p.weightMt;
  const rows: Array<[string, string]> = [
    ['Coil', coilIdentity],
    ['Grade', String(data?.gradeCode ?? p.gradeCode ?? '—')],
    ['Weight (MT)', weight != null ? Number(weight).toFixed(2) : '—'],
    ['Line speed', String(c.lineSpeedMpm ?? p.lineSpeedMpm ?? p.line_speed_mpm ?? '—')],
    ['Repeats', String(c.repeats ?? p.repeats ?? '—')],
    ['HT', String(c.ht ?? p.ht ?? p.HT ?? '—')],
    ['W/P', String(c.wp ?? p.wp ?? p.WP ?? '—')],
    ['End filling', endFilling],
    ['Captured at', p.createdAt || p.created_at ? formatPlantDateTime(String(p.createdAt ?? p.created_at)) : '—'],
    ['Operator', String(c.operatorName ?? p.capturedBy ?? p.created_by ?? p.operatorName ?? '—')],
  ];

  const st = (status ?? '').toUpperCase();
  const canReinstate = st === 'REJECTED' || st === 'HOLD' || st === 'COMPLETED';
  const canDelete = st === 'COMPLETED';

  async function onReinstate() {
    if (!window.confirm(`Move ${coilNo} back to Preparing?`)) return;
    setBusy(true);
    setError(null);
    try {
      const order = await reinstateHrsPklOrder('PKL', coilNo, 'PREPARING') as { status?: string };
      setStatus(order?.status ?? 'PREPARING');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reinstate failed');
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!window.confirm(`Delete order ${coilNo}?\n\nPPC plan stays. This cannot be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteHrsPklOrder('PKL', coilNo);
      navigate('/machine-head/pkl/live');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
      setBusy(false);
    }
  }

  return (
    <MachineHeadShell
      title={`PKL · ${coilNo || 'Coil'}`}
      subtitle="Operator-captured values"
      fillViewport
      headerActions={
        <ZButton variant="secondary" size="sm" onClick={() => navigate('/machine-head/pkl/live')}>
          <ChevronLeft className="h-4 w-4" /> Live
        </ZButton>
      }
    >
      {error && <p className="text-sm text-destructive p-4">{error}</p>}
      {!error && !data && <p className="text-sm text-muted-foreground p-4">Loading…</p>}
      {data && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 p-1">
          {rows.map(([label, value]) => (
            <div key={label} className="rounded-xl border border-border bg-card px-3 py-2.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
              <p className="mt-0.5 text-sm font-semibold font-mono tabular-nums">{value}</p>
            </div>
          ))}
          {(canReinstate || canDelete) && (
            <div className="sm:col-span-2 lg:col-span-3 flex flex-wrap gap-2">
              {canReinstate && (
                <ZButton type="button" variant="secondary" disabled={busy} onClick={() => void onReinstate()}>
                  Move to preparation
                </ZButton>
              )}
              {canDelete && (
                <ZButton type="button" variant="secondary" disabled={busy} onClick={() => void onDelete()}>
                  Delete order
                </ZButton>
              )}
            </div>
          )}
        </div>
      )}
    </MachineHeadShell>
  );
}
