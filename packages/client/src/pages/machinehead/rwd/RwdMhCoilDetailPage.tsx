import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { MachineHeadShell } from '../../../components/layout/machinehead/MachineHeadShell';
import { ZBadge } from '../../../components/primitives/ZBadge';
import { ZButton } from '../../../components/primitives/ZButton';
import { apiClient } from '../../../lib/apiClient';
import { formatPlantDateTime } from '../../../lib/dateFormat';
import { formatOrderStatusLabel } from '../../../lib/orderLabels';
import type { Tone } from '../../../lib/tones';
import { displayMotherCoilId } from '../../../lib/sixHiOrderIdentity';

type RwdDetail = {
  batchNumber?: string;
  coilNo?: string;
  displayCoilNo?: string;
  slitId?: string;
  status?: string;
  machineCode?: string;
  gradeCode?: string;
  ppcWeightMt?: number;
  widthMm?: number;
  ppcThkMm?: number;
  combinedGroupId?: string;
  prodStartAt?: string;
  prodEndAt?: string;
  prodDurationMin?: number;
  surfaceFinish?: string;
  finishWeightMt?: number | null;
  rwTension1Kg?: number | null;
  rwTension2Kg?: number | null;
  rwTension3Kg?: number | null;
  outputThkMm?: number | null;
};

function fmtKg(v: number | null | undefined): string {
  return v != null ? Number(v).toFixed(1) : '—';
}

function statusTone(status?: string): Tone {
  const s = (status ?? '').toUpperCase();
  if (s === 'PENDING' || s === 'HOLD' || s === 'REJECTED') return 'accent';
  if (s === 'IN_PROGRESS' || s === 'RUNNING') return 'success';
  if (s === 'STOPPAGE') return 'warning';
  if (s === 'PREPARING') return 'info';
  return 'muted';
}

/** Lean RWD/2HI MH order detail — keyed by batch number. */
export function RwdMhCoilDetailPage() {
  const { batchNo: raw } = useParams();
  const batchNo = raw ? decodeURIComponent(raw) : '';
  const navigate = useNavigate();
  const [data, setData] = useState<RwdDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!batchNo) return;
    void apiClient
      .get<RwdDetail>(`/rewinding/orders/${encodeURIComponent(batchNo)}`)
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Load failed'));
  }, [batchNo]);

  const surface =
    data?.surfaceFinish === 'B' || data?.surfaceFinish === 'BRIGHT' ? 'Bright'
      : data?.surfaceFinish === 'M' || data?.surfaceFinish === 'MATT' ? 'Matt'
        : (data?.surfaceFinish ?? '—');

  const lineCode = (data?.machineCode ?? 'RWD').toUpperCase() === '2HI' ? '2HI' : (data?.machineCode ?? 'RWD');
  const status = data?.status ?? '—';

  const rows: Array<[string, string]> = data ? [
    ['Batch', data.batchNumber ?? batchNo],
    ['Coil', displayMotherCoilId({
      displayCoilNo: data.displayCoilNo,
      coilNo: data.coilNo,
      batchNumber: data.batchNumber ?? batchNo,
      slitId: data.slitId,
    })],
    ['Machine', data.machineCode ?? '—'],
    ['Grade', data.gradeCode ?? '—'],
    ['Plan WT (MT)', data.ppcWeightMt != null ? Number(data.ppcWeightMt).toFixed(2) : '—'],
    ['Finish WT (MT)', data.finishWeightMt != null ? Number(data.finishWeightMt).toFixed(2) : '—'],
    ['Width × Thk', `${data.widthMm ?? '—'} × ${data.ppcThkMm ?? '—'} mm`],
    ['Output thk', data.outputThkMm != null ? `${Number(data.outputThkMm)} mm` : '—'],
    ['Surface', surface],
    ['Tension 1 (KG)', fmtKg(data.rwTension1Kg)],
    ['Tension 2 (KG)', fmtKg(data.rwTension2Kg)],
    ['Tension 3 (KG)', fmtKg(data.rwTension3Kg)],
    ['Combined group', data.combinedGroupId ?? '—'],
    ['Prod start', data.prodStartAt ? formatPlantDateTime(data.prodStartAt) : '—'],
    ['Prod end', data.prodEndAt ? formatPlantDateTime(data.prodEndAt) : '—'],
    ['Duration min', data.prodDurationMin != null ? String(data.prodDurationMin) : '—'],
  ] : [];

  return (
    <MachineHeadShell
      title={`${lineCode} · ${batchNo || 'Order'}`}
      subtitle="Rewinding order detail"
      fillViewport
      headerActions={
        <div className="flex items-center gap-2">
          {data && <ZBadge tone={statusTone(status)} label={formatOrderStatusLabel(String(status))} />}
          <ZButton variant="secondary" size="sm" onClick={() => navigate('/machine-head/rwd/live')}>
            <ChevronLeft className="h-4 w-4" /> Live
          </ZButton>
        </div>
      }
    >
      {error && <p className="text-sm text-destructive p-4">{error}</p>}
      {!error && !data && <p className="text-sm text-muted-foreground p-4">Loading…</p>}
      {data && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 p-1">
          {rows.map(([label, value]) => (
            <div key={label} className="rounded-lg border border-border bg-card px-3 py-2.5 shadow-sm">
              <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
              <p className="mt-0.5 text-sm font-semibold font-mono tabular-nums text-foreground">{value}</p>
            </div>
          ))}
        </div>
      )}
    </MachineHeadShell>
  );
}
