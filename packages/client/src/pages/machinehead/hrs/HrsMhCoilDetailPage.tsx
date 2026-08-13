import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { MachineHeadShell } from '../../../components/layout/machinehead/MachineHeadShell';
import { ZButton } from '../../../components/primitives/ZButton';
import { apiClient } from '../../../lib/apiClient';
import { formatPlantDateTime } from '../../../lib/dateFormat';
import { displayMotherCoilId } from '../../../lib/sixHiOrderIdentity';
import { deleteHrsPklOrder, reinstateHrsPklOrder } from '../../../lib/hrsPklWrites';

type HrsDetail = {
  coilNo?: string;
  status?: string;
  gradeCode?: string;
  weightMt?: number;
  motherCoilNo?: string;
  slitId?: string;
  prodStartAt?: string;
  prodEndAt?: string;
  orderLines?: Array<{ slitId?: string; widthMm?: number; weightMt?: number }>;
};

type Prefill = {
  coilNo?: string;
  gradeCode?: string;
  weightMt?: number;
  motherCoilNo?: string;
  slitId?: string;
  prefill?: Record<string, unknown>;
  hrsCapture?: { weightMt?: number; operatorName?: string } | null;
};

/** Lean HRS MH coil detail — order + entry KV. */
export function HrsMhCoilDetailPage() {
  const { coilNo: raw } = useParams();
  const coilNo = raw ? decodeURIComponent(raw) : '';
  const navigate = useNavigate();
  const [order, setOrder] = useState<HrsDetail | null>(null);
  const [entry, setEntry] = useState<Prefill | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!coilNo) return;
    void Promise.all([
      apiClient.get<HrsDetail>(`/hrs-order/orders/${encodeURIComponent(coilNo)}`).catch(() => null),
      apiClient.get<Prefill>(`/stations/hrs/entry/${encodeURIComponent(coilNo)}`).catch(() => null),
    ]).then(([o, e]) => {
      if (!o && !e) setError('Load failed');
      setOrder(o);
      setEntry(e);
    });
  }, [coilNo]);

  const p = entry?.prefill ?? {};
  const capture = entry?.hrsCapture;
  const coilIdentity = displayMotherCoilId({
    motherCoilNo: String(order?.motherCoilNo ?? entry?.motherCoilNo ?? p.motherCoilNo ?? '') || undefined,
    coilNo: order?.coilNo ?? entry?.coilNo ?? coilNo,
    batchNumber: coilNo,
    slitId: String(order?.slitId ?? entry?.slitId ?? p.slitId ?? '') || undefined,
  });
  const weight = order?.weightMt ?? capture?.weightMt ?? entry?.weightMt ?? p.weightMt;
  const rows: Array<[string, string]> = [
    ['Coil', coilIdentity],
    ['Status', order?.status ?? '—'],
    ['Grade', String(order?.gradeCode ?? entry?.gradeCode ?? p.gradeCode ?? '—')],
    ['Weight (MT)', weight != null ? Number(weight).toFixed(2) : '—'],
    ['Prod start', order?.prodStartAt ? formatPlantDateTime(order.prodStartAt) : '—'],
    ['Prod end', order?.prodEndAt ? formatPlantDateTime(order.prodEndAt) : '—'],
    ['Slit lines', order?.orderLines?.length != null ? String(order.orderLines.length) : '—'],
    ['Operator', String(capture?.operatorName ?? p.capturedBy ?? p.created_by ?? p.operatorName ?? '—')],
  ];

  const st = (order?.status ?? '').toUpperCase();
  const canReinstate = st === 'REJECTED' || st === 'HOLD' || st === 'COMPLETED';
  const canDelete = st === 'COMPLETED';

  async function reload() {
    const [o, e] = await Promise.all([
      apiClient.get<HrsDetail>(`/hrs-order/orders/${encodeURIComponent(coilNo)}`).catch(() => null),
      apiClient.get<Prefill>(`/stations/hrs/entry/${encodeURIComponent(coilNo)}`).catch(() => null),
    ]);
    setOrder(o);
    setEntry(e);
  }

  async function onReinstate(target: 'PREPARING' | 'PENDING') {
    const label = target === 'PENDING' ? 'Pending' : 'Preparing';
    if (!window.confirm(`Move ${coilNo} to ${label}?`)) return;
    setBusy(true);
    setError(null);
    try {
      const slitId = order?.slitId ?? (order?.orderLines?.length === 1 ? order.orderLines[0]?.slitId : undefined);
      await reinstateHrsPklOrder('HRS', coilNo, target, { slitId });
      await reload();
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
      await deleteHrsPklOrder('HRS', coilNo);
      navigate('/live');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
      setBusy(false);
    }
  }

  return (
    <MachineHeadShell
      title={`HRS · ${coilNo || 'Coil'}`}
      subtitle="Order + capture detail"
      fillViewport
      headerActions={
        <ZButton variant="secondary" size="sm" onClick={() => navigate('/live')}>
          <ChevronLeft className="h-4 w-4" /> Live
        </ZButton>
      }
    >
      {error && <p className="text-sm text-destructive p-4">{error}</p>}
      {!error && !order && !entry && <p className="text-sm text-muted-foreground p-4">Loading…</p>}
      {(order || entry) && (
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
                <>
                  <ZButton type="button" variant="secondary" disabled={busy} onClick={() => void onReinstate('PENDING')}>
                    Move to pending
                  </ZButton>
                  <ZButton type="button" variant="secondary" disabled={busy} onClick={() => void onReinstate('PREPARING')}>
                    Move to preparation
                  </ZButton>
                </>
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
