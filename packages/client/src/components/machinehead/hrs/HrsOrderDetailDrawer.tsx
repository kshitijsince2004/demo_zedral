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
import type { HrsCoilDetail, HrsEntryShape, HrsOrderShape } from './HrsSidePanel';

type HrsCaptureSlot = {
  slot?: string;
  targetWidthMm?: number;
  plannedThkMm?: number;
  plannedWeightMt?: number;
  childCoilNo?: string;
  customer?: string;
  sapBatchNumber?: string;
  surfaceFinish?: string;
  finishThicknessMm?: number;
  routeRaw?: string;
  downstreamCrsCombination?: string;
  holdFlag?: boolean;
  forCtlFlag?: boolean;
  thkLatestMm?: number;
  taperLatest?: string;
};

type HrsCapture = {
  entryId?: string;
  actualWidthMm?: number;
  scrapMt?: number;
  weightMt?: number;
  motherWidthReadings?: Array<{ time: string; widthMm: number }>;
  slitSlots?: HrsCaptureSlot[];
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

function hrsPpcFields(card: ProcessQueueCard, entry: HrsEntryShape | null): ProcessPpcFields {
  const p = entry?.prefill ?? {};
  return {
    coilNo: card.coilNo,
    motherCoilNo: card.motherCoilNo ?? String(p.motherCoilNo ?? ''),
    customer: card.customerName || String(p.customerName ?? entry?.customerName ?? ''),
    grade: card.gradeCode || String(p.gradeCode ?? entry?.gradeCode ?? ''),
    slitId: card.slitId ?? String(p.slitId ?? entry?.slitId ?? ''),
    widthMm: card.widthMm ?? (p.widthMm as number | string | undefined),
    thicknessMm: card.thicknessMm ?? (p.thicknessMm as number | string | undefined),
    weightMt: card.weightMt ?? entry?.weightMt ?? (p.weightMt as number | string | undefined),
    route: card.routeRaw ?? String(p.routeRaw ?? ''),
    batch: card.batchNumber ?? card.coilNo,
    activeLineLabel: card.combination,
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

function HrsCaptureSection({ capture }: { capture: HrsCapture | null | undefined }) {
  if (!capture) return null;
  const slots = capture.slitSlots ?? [];
  const hasHeader = capture.actualWidthMm != null || capture.scrapMt != null || capture.weightMt != null;
  if (!hasHeader && slots.length === 0) return null;

  return (
    <Section title="HRS production capture">
      <KvGrid rows={[
        ['Actual width', capture.actualWidthMm != null ? `${capture.actualWidthMm} mm` : '—'],
        ['Scrap', capture.scrapMt != null ? `${Number(capture.scrapMt).toFixed(2)} MT` : '—'],
        ['Weight', capture.weightMt != null ? `${Number(capture.weightMt).toFixed(2)} MT` : '—'],
      ]} />
      {capture.motherWidthReadings && capture.motherWidthReadings.length > 0 && (
        <p className="text-xs text-muted-foreground font-mono">
          Width readings: {capture.motherWidthReadings.map((r) => `${r.time} · ${r.widthMm} mm`).join(' · ')}
        </p>
      )}
      {slots.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs mt-2">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 pr-2">Slot</th>
                <th className="py-1 pr-2">Width</th>
                <th className="py-1 pr-2">Thk</th>
                <th className="py-1 pr-2">Taper</th>
                <th className="py-1 pr-2">Flags</th>
              </tr>
            </thead>
            <tbody>
              {slots.map((s) => (
                <tr key={String(s.slot)} className="border-t border-border/50 font-mono">
                  <td className="py-1.5 pr-2">{s.slot ?? '—'}</td>
                  <td className="py-1.5 pr-2">{s.targetWidthMm ?? '—'}</td>
                  <td className="py-1.5 pr-2">{s.thkLatestMm ?? s.plannedThkMm ?? '—'}</td>
                  <td className="py-1.5 pr-2">{s.taperLatest ?? '—'}</td>
                  <td className="py-1.5 pr-2">
                    {[s.holdFlag && 'HOLD', s.forCtlFlag && 'CTL'].filter(Boolean).join(', ') || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function OrderLinesTable({ lines }: { lines: Array<Record<string, unknown>> }) {
  if (lines.length === 0) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-1 pr-2">Batch / Slit</th>
            <th className="py-1 pr-2">Width</th>
            <th className="py-1 pr-2">Weight</th>
            <th className="py-1 pr-2">Route</th>
            <th className="py-1 pr-2">To WC</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, i) => (
            <tr key={i} className="border-t border-border/50 font-mono">
              <td className="py-1.5 pr-2">{String(line.batchNumber ?? line.slitId ?? `Line ${i + 1}`)}</td>
              <td className="py-1.5 pr-2">{line.widthMm != null ? `${line.widthMm} mm` : '—'}</td>
              <td className="py-1.5 pr-2">{line.weightMt != null ? `${line.weightMt} MT` : '—'}</td>
              <td className="py-1.5 pr-2">{String(line.routeRaw ?? '—')}</td>
              <td className="py-1.5 pr-2">{String(line.toWorkCenter ?? '—')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HrsFilledBody({
  card,
  order,
  entry,
}: {
  card: ProcessQueueCard;
  order: HrsOrderShape | null;
  entry: HrsEntryShape | null;
}) {
  const p = entry?.prefill ?? {};
  const capture = (entry?.hrsCapture ?? null) as HrsCapture | null;
  const operator = String(p.capturedBy ?? p.operatorName ?? p.created_by ?? '');
  const status = order?.status ?? card.status;
  const hasLifecycle = order?.prodStartAt || order?.prodEndAt || order?.shiftCode;
  const hasCapture = capture && (
    capture.actualWidthMm != null
    || capture.scrapMt != null
    || (capture.slitSlots?.length ?? 0) > 0
  );
  const hasHold = order?.holdReason || order?.holdRemarks;

  if (!hasLifecycle && !hasCapture && !operator && !hasHold) {
    return (
      <p className="px-4 py-6 text-sm text-muted-foreground text-center">
        No HRS production data captured yet for this order.
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
      <HrsCaptureSection capture={capture} />
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
  order: HrsOrderShape | null;
  entry: HrsEntryShape | null;
}) {
  const p = entry?.prefill ?? {};
  const capture = (entry?.hrsCapture ?? null) as HrsCapture | null;
  const orderLines = (order?.orderLines ?? entry?.orderLines ?? card.orderLines ?? []) as Array<Record<string, unknown>>;
  const operator = String(p.capturedBy ?? p.operatorName ?? p.created_by ?? '');
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
          ['Combination', card.combination ?? '—'],
          ['Line count', card.lineCount != null ? String(card.lineCount) : '—'],
          ['Journey', card.journeyId ?? '—'],
        ]} />
      </Section>

      <ProcessPPCCards data={hrsPpcFields(card, entry)} compact hideRoute={!hrsPpcFields(card, entry).route} />

      {orderLines.length > 0 && (
        <Section title="PPC order lines">
          <OrderLinesTable lines={orderLines} />
        </Section>
      )}

      <Section title="Coil / material">
        <KvGrid rows={[
          ['Grade', order?.gradeCode ?? card.gradeCode ?? String(p.gradeCode ?? '—')],
          ['Width', order?.widthMm != null ? `${order.widthMm} mm` : card.widthMm != null ? `${card.widthMm} mm` : '—'],
          ['Thickness', order?.thicknessMm != null ? `${order.thicknessMm} mm` : card.thicknessMm != null ? `${card.thicknessMm} mm` : '—'],
          ['Weight', order?.weightMt != null ? `${Number(order.weightMt).toFixed(2)} MT` : card.weightMt != null ? `${Number(card.weightMt).toFixed(2)} MT` : '—'],
          ['Route', card.routeRaw ?? String(p.routeRaw ?? '—')],
        ]} />
      </Section>

      <HrsCaptureSection capture={capture} />

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

/** Read-only HRS order detail drawer — HRS-filled or complete PPC dump. */
export function HrsOrderDetailDrawer({
  card,
  open,
  onClose,
  mode,
  cachedDetail,
}: {
  card: ProcessQueueCard | null;
  open: boolean;
  onClose: () => void;
  mode: 'hrs' | 'complete';
  cachedDetail?: HrsCoilDetail | null;
}) {
  const [order, setOrder] = useState<HrsOrderShape | null>(null);
  const [entry, setEntry] = useState<HrsEntryShape | null>(null);
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
      apiClient.get<HrsOrderShape>(`/hrs-order/orders/${encodeURIComponent(card.coilNo)}`).catch(() => null),
      apiClient.get<HrsEntryShape>(`/stations/hrs/entry/${encodeURIComponent(card.coilNo)}`).catch(() => null),
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
      : `HRS details · ${card.coilNo}`
    : 'Order details';

  return (
    <ZDrawer open={open} onClose={onClose} title={title} size={mode === 'complete' ? 'large' : 'medium'}>
      {loading && <p className="px-4 py-6 text-sm text-muted-foreground">Loading…</p>}
      {error && <p className="px-4 py-3 text-sm text-destructive">{error}</p>}
      {!loading && !error && card && (
        mode === 'complete'
          ? <CompleteBody card={card} order={order} entry={entry} />
          : <HrsFilledBody card={card} order={order} entry={entry} />
      )}
      <p className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground border-t border-border">
        Read-only · Machine Head view
      </p>
    </ZDrawer>
  );
}
