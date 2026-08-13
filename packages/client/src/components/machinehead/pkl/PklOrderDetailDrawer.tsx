import { useEffect, useState, type ReactNode } from 'react';
import { OrderIdentityDisplay } from '../../orders/OrderIdentityDisplay';
import { ProcessPPCCards, type ProcessPpcFields } from '../../process/ProcessPPCCards';
import { ZBadge } from '../../primitives/ZBadge';
import { ZDrawer } from '../../primitives/ZDrawer';
import { apiClient } from '../../../lib/apiClient';
import { formatPlantDateTime } from '../../../lib/dateFormat';
import { formatOrderStatusLabel } from '../../../lib/orderLabels';
import type { Tone } from '../../../lib/tones';
import type { ProcessQueueCard } from '../../../store/processStore';
import type { PklCoilDetail, PklEntryShape, PklOrderShape } from './PklMhSidePanel';

type PklCaptureMerged = {
  lineSpeedMpm?: string | number;
  repeats?: string | number;
  ht?: string;
  wp?: string;
  endFilling?: boolean | string;
  weightMt?: number;
  ppcWeightMt?: number;
  remarks?: string;
  capturedAt?: string;
  operator?: string;
};

function statusTone(status: string): Tone {
  const u = status.toUpperCase();
  if (u === 'PENDING' || u === 'HOLD') return 'accent';
  if (u === 'IN_PROGRESS') return 'success';
  if (u === 'STOPPAGE') return 'warning';
  if (u === 'PREPARING') return 'info';
  if (u === 'REJECTED') return 'destructive';
  return 'muted';
}

function identity(card: ProcessQueueCard) {
  return {
    batchNumber: card.batchNumber ?? card.coilNo,
    coilNo: card.coilNo,
    motherCoilNo: card.motherCoilNo,
    slitId: card.slitId,
    displayCoilNo: card.displayCoilNo,
  };
}

function pklPpcFields(card: ProcessQueueCard, entry: PklEntryShape | null): ProcessPpcFields {
  const p = entry?.prefill ?? {};
  return {
    coilNo: card.coilNo,
    motherCoilNo: card.motherCoilNo ?? String(p.motherCoilNo ?? entry?.motherCoilNo ?? ''),
    customer: card.customerName || String(p.customerName ?? entry?.customerName ?? ''),
    grade: card.gradeCode || String(p.gradeCode ?? entry?.gradeCode ?? ''),
    slitId: card.slitId ?? String(p.slitId ?? entry?.slitId ?? ''),
    widthMm: card.widthMm ?? (p.widthMm as number | string | undefined),
    thicknessMm: card.thicknessMm ?? (p.thicknessMm as number | string | undefined),
    weightMt: card.weightMt ?? entry?.weightMt ?? (p.weightMt as number | string | undefined),
    route: card.routeRaw ?? String(p.routeRaw ?? ''),
    batch: card.batchNumber ?? card.coilNo,
  };
}

function mergePklCapture(entry: PklEntryShape | null): PklCaptureMerged {
  const p = entry?.prefill ?? {};
  const c = entry?.pklCapture ?? {};
  const endRaw = c.endFilling ?? c.end_filling ?? p.endFilling ?? p.end_filling;
  let endFilling: boolean | string | undefined;
  if (endRaw === true || endRaw === 'true') endFilling = 'Yes';
  else if (endRaw === false || endRaw === 'false') endFilling = 'No';
  else if (endRaw != null && endRaw !== '') endFilling = String(endRaw);

  const capturedAt = p.createdAt ?? p.created_at;
  return {
    lineSpeedMpm: c.lineSpeedMpm ?? c.line_speed_mpm ?? p.lineSpeedMpm ?? p.line_speed_mpm,
    repeats: c.repeats ?? p.repeats,
    ht: String(c.ht ?? p.ht ?? p.HT ?? ''),
    wp: String(c.wp ?? p.wp ?? p.WP ?? ''),
    endFilling,
    weightMt: c.weightMt != null ? Number(c.weightMt) : c.weight_mt != null ? Number(c.weight_mt) : undefined,
    ppcWeightMt: c.ppcWeightMt != null ? Number(c.ppcWeightMt) : c.ppc_weight_mt != null ? Number(c.ppc_weight_mt) : undefined,
    remarks: String(c.remarks ?? ''),
    capturedAt: capturedAt ? String(capturedAt) : undefined,
    operator: String(c.operatorName ?? p.capturedBy ?? p.operatorName ?? p.created_by ?? ''),
  };
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-border/60 p-3 space-y-2">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

function KvGrid({ rows }: { rows: Array<[string, string]> }) {
  const filtered = rows.filter(([, v]) => v && v !== '—');
  if (filtered.length === 0) return null;
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
      {filtered.map(([label, value]) => (
        <div key={label}>
          <dt className="text-[10px] uppercase text-muted-foreground font-semibold">{label}</dt>
          <dd className="font-semibold mt-0.5 font-mono tabular-nums break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function PklCaptureSection({ capture }: { capture: PklCaptureMerged }) {
  const rows: Array<[string, string]> = [
    ['Line speed', capture.lineSpeedMpm != null && capture.lineSpeedMpm !== '' ? `${capture.lineSpeedMpm} mpm` : '—'],
    ['Repeats', capture.repeats != null && capture.repeats !== '' ? String(capture.repeats) : '—'],
    ['HT', capture.ht && capture.ht !== '' ? capture.ht : '—'],
    ['W/P', capture.wp && capture.wp !== '' ? capture.wp : '—'],
    ['End filling', capture.endFilling != null ? String(capture.endFilling) : '—'],
    ['Weight (actual)', capture.weightMt != null ? `${capture.weightMt.toFixed(2)} MT` : '—'],
    ['Weight (PPC)', capture.ppcWeightMt != null ? `${capture.ppcWeightMt.toFixed(2)} MT` : '—'],
    ['Remarks', capture.remarks && capture.remarks !== '' ? capture.remarks : '—'],
    ['Captured at', capture.capturedAt ? formatPlantDateTime(capture.capturedAt) : '—'],
  ];
  const filtered = rows.filter(([, v]) => v && v !== '—');
  if (filtered.length === 0) return null;

  return (
    <Section title="PKL production capture">
      <KvGrid rows={rows} />
    </Section>
  );
}

function PklFilledBody({
  card,
  order,
  entry,
}: {
  card: ProcessQueueCard;
  order: PklOrderShape | null;
  entry: PklEntryShape | null;
}) {
  const capture = mergePklCapture(entry);
  const status = order?.status ?? card.status;
  const hasLifecycle = order?.prodStartAt || order?.prodEndAt || order?.shiftCode;
  const hasHold = order?.holdReason || order?.holdRemarks;
  const operator = capture.operator;

  const captureRows: Array<[string, string]> = [
    ['Line speed', capture.lineSpeedMpm != null && capture.lineSpeedMpm !== '' ? `${capture.lineSpeedMpm} mpm` : '—'],
    ['Repeats', capture.repeats != null && capture.repeats !== '' ? String(capture.repeats) : '—'],
    ['HT', capture.ht && capture.ht !== '' ? capture.ht : '—'],
    ['W/P', capture.wp && capture.wp !== '' ? capture.wp : '—'],
    ['End filling', capture.endFilling != null ? String(capture.endFilling) : '—'],
    ['Weight (actual)', capture.weightMt != null ? `${capture.weightMt.toFixed(2)} MT` : '—'],
    ['Weight (PPC)', capture.ppcWeightMt != null ? `${capture.ppcWeightMt.toFixed(2)} MT` : '—'],
    ['Remarks', capture.remarks && capture.remarks !== '' ? capture.remarks : '—'],
    ['Captured at', capture.capturedAt ? formatPlantDateTime(capture.capturedAt) : '—'],
  ].filter(([, v]) => v && v !== '—');
  const hasCaptureData = captureRows.length > 0;

  if (!hasLifecycle && !hasCaptureData && !operator && !hasHold) {
    return (
      <p className="px-4 py-6 text-sm text-muted-foreground text-center">
        No PKL production data captured yet for this order.
      </p>
    );
  }

  return (
    <div className="px-4 py-3 space-y-3">
      <Section title="Status & lifecycle">
        <KvGrid rows={[
          ['Status', formatOrderStatusLabel(status)],
          ['Prod start', order?.prodStartAt ? formatPlantDateTime(order.prodStartAt) : '—'],
          ['Prod end', order?.prodEndAt ? formatPlantDateTime(order.prodEndAt) : '—'],
          ['Duration', order?.prodDurationMin != null ? `${order.prodDurationMin} min` : '—'],
          ['Shift', order?.shiftCode ?? '—'],
        ]} />
      </Section>
      {hasCaptureData && (
        <Section title="PKL production capture">
          <KvGrid rows={captureRows as Array<[string, string]>} />
        </Section>
      )}
      {operator && (
        <Section title="Operator">
          <p className="text-sm font-semibold">{operator}</p>
        </Section>
      )}
      {hasHold && (
        <Section title="Hold">
          <p className="text-sm">{order?.holdReason || order?.holdRemarks}</p>
        </Section>
      )}
    </div>
  );
}

function CompleteBody({
  card,
  order,
  entry,
}: {
  card: ProcessQueueCard;
  order: PklOrderShape | null;
  entry: PklEntryShape | null;
}) {
  const p = entry?.prefill ?? {};
  const capture = mergePklCapture(entry);
  const operator = capture.operator;
  const status = order?.status ?? card.status;
  const stoppages = order?.stoppages ?? [];

  return (
    <div className="px-4 py-3 space-y-3">
      <Section title="Order identity">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <OrderIdentityDisplay order={identity(card)} size="md" />
          <ZBadge tone={statusTone(status)} label={formatOrderStatusLabel(status)} />
        </div>
        <KvGrid rows={[
          ['Order ID', order?.orderId ?? '—'],
          ['Journey', card.journeyId ?? '—'],
          ['Step', card.stepNo != null ? String(card.stepNo) : '—'],
        ]} />
      </Section>

      <ProcessPPCCards data={pklPpcFields(card, entry)} compact hideRoute={!pklPpcFields(card, entry).route} />

      <Section title="Coil / material">
        <KvGrid rows={[
          ['Grade', order?.gradeCode ?? card.gradeCode ?? String(p.gradeCode ?? entry?.gradeCode ?? '—')],
          ['Width', order?.widthMm != null ? `${order.widthMm} mm` : card.widthMm != null ? `${card.widthMm} mm` : '—'],
          ['Thickness', order?.thicknessMm != null ? `${order.thicknessMm} mm` : card.thicknessMm != null ? `${card.thicknessMm} mm` : '—'],
          ['Weight', order?.weightMt != null ? `${Number(order.weightMt).toFixed(2)} MT` : card.weightMt != null ? `${Number(card.weightMt).toFixed(2)} MT` : '—'],
          ['Route', card.routeRaw ?? String(p.routeRaw ?? '—')],
          ['Mother coil', card.motherCoilNo ?? order?.motherCoilNo ?? String(p.motherCoilNo ?? '—')],
          ['Slit', card.slitId ?? order?.slitId ?? String(p.slitId ?? '—')],
        ]} />
      </Section>

      <PklCaptureSection capture={capture} />

      <Section title="Production lifecycle">
        <KvGrid rows={[
          ['Prod start', order?.prodStartAt ? formatPlantDateTime(order.prodStartAt) : '—'],
          ['Prod end', order?.prodEndAt ? formatPlantDateTime(order.prodEndAt) : '—'],
          ['Duration', order?.prodDurationMin != null ? `${order.prodDurationMin} min` : '—'],
          ['Shift', order?.shiftCode ?? '—'],
          ['Shift log', order?.shiftLogId ?? '—'],
        ]} />
      </Section>

      {operator && (
        <Section title="Operator">
          <p className="text-sm font-semibold">{operator}</p>
        </Section>
      )}

      {(order?.holdReason || order?.holdRemarks) && (
        <Section title="Status & hold">
          <KvGrid rows={[
            ['Status', formatOrderStatusLabel(status)],
            ['Hold reason', order?.holdReason ?? '—'],
            ['Hold remarks', order?.holdRemarks ?? '—'],
          ]} />
        </Section>
      )}

      {stoppages.length > 0 && (
        <Section title="Stoppages">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 pr-2">Category</th>
                  <th className="py-1 pr-2">Start</th>
                  <th className="py-1 pr-2">End</th>
                  <th className="py-1 pr-2">Min</th>
                </tr>
              </thead>
              <tbody>
                {stoppages.map((s) => (
                  <tr key={String(s.stoppageId)} className="border-t border-border/50 font-mono">
                    <td className="py-1.5 pr-2">{s.categoryCode ?? '—'}</td>
                    <td className="py-1.5 pr-2">{s.startAt ? formatPlantDateTime(s.startAt) : '—'}</td>
                    <td className="py-1.5 pr-2">{s.endAt ? formatPlantDateTime(s.endAt) : '—'}</td>
                    <td className="py-1.5 pr-2">{s.durationMin ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </div>
  );
}

/** Read-only PKL order detail drawer — PKL-filled or complete PPC dump. */
export function PklOrderDetailDrawer({
  card,
  open,
  onClose,
  mode,
  cachedDetail,
}: {
  card: ProcessQueueCard | null;
  open: boolean;
  onClose: () => void;
  mode: 'pkl' | 'complete';
  cachedDetail?: PklCoilDetail | null;
}) {
  const [order, setOrder] = useState<PklOrderShape | null>(null);
  const [entry, setEntry] = useState<PklEntryShape | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !card?.coilNo) {
      setOrder(null);
      setEntry(null);
      setError(null);
      return;
    }
    if (cachedDetail?.order || cachedDetail?.entry) {
      setOrder(cachedDetail.order ?? null);
      setEntry(cachedDetail.entry ?? null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    void Promise.all([
      apiClient.get<PklOrderShape>(`/pkl-order/orders/${encodeURIComponent(card.coilNo)}`).catch(() => null),
      apiClient.get<PklEntryShape>(`/stations/pkl/entry/${encodeURIComponent(card.coilNo)}`).catch(() => null),
    ])
      .then(([o, e]) => {
        if (!o && !e) setError('Failed to load order details');
        setOrder(o);
        setEntry(e);
      })
      .finally(() => setLoading(false));
  }, [open, card?.coilNo, cachedDetail]);

  const title = card
    ? mode === 'complete'
      ? `Complete details · ${card.coilNo}`
      : `PKL details · ${card.coilNo}`
    : 'Order details';

  return (
    <ZDrawer open={open} onClose={onClose} title={title} size={mode === 'complete' ? 'large' : 'medium'}>
      {loading && <p className="px-4 py-6 text-sm text-muted-foreground">Loading…</p>}
      {error && <p className="px-4 py-3 text-sm text-destructive">{error}</p>}
      {!loading && !error && card && (
        mode === 'complete'
          ? <CompleteBody card={card} order={order} entry={entry} />
          : <PklFilledBody card={card} order={order} entry={entry} />
      )}
      <p className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground border-t border-border">
        Read-only · Machine Head view
      </p>
    </ZDrawer>
  );
}
