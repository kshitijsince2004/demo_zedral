import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { MachineHeadShell } from '../../../components/layout/machinehead/MachineHeadShell';
import { ZButton } from '../../../components/primitives/ZButton';
import { apiClient } from '../../../lib/apiClient';
import { formatPlantDateTime } from '../../../lib/dateFormat';

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
};

/** Lean HRS MH coil detail — order + entry KV. */
export function HrsMhCoilDetailPage() {
  const { coilNo: raw } = useParams();
  const coilNo = raw ? decodeURIComponent(raw) : '';
  const navigate = useNavigate();
  const [order, setOrder] = useState<HrsDetail | null>(null);
  const [entry, setEntry] = useState<Prefill | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  const rows: Array<[string, string]> = [
    ['Coil', order?.coilNo ?? entry?.coilNo ?? coilNo],
    ['Status', order?.status ?? '—'],
    ['Grade', String(order?.gradeCode ?? entry?.gradeCode ?? p.gradeCode ?? '—')],
    ['Weight (MT)', order?.weightMt != null ? Number(order.weightMt).toFixed(2)
      : entry?.weightMt != null ? Number(entry.weightMt).toFixed(2) : String(p.weightMt ?? '—')],
    ['Mother', String(order?.motherCoilNo ?? entry?.motherCoilNo ?? p.motherCoilNo ?? '—')],
    ['Slit', String(order?.slitId ?? entry?.slitId ?? p.slitId ?? '—')],
    ['Prod start', order?.prodStartAt ? formatPlantDateTime(order.prodStartAt) : '—'],
    ['Prod end', order?.prodEndAt ? formatPlantDateTime(order.prodEndAt) : '—'],
    ['Slit lines', order?.orderLines?.length != null ? String(order.orderLines.length) : '—'],
    ['Operator', String(p.capturedBy ?? p.created_by ?? p.operatorName ?? '—')],
  ];

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
        </div>
      )}
    </MachineHeadShell>
  );
}
