import type { ProcessPpcFields } from '../components/process/ProcessPPCCards';
import type { ProcessQueueCard } from '../store/processStore';

export type HrsDetailField = { label: string; value: string };

export type HrsDetailSection = {
  id: string;
  title: string;
  fields: HrsDetailField[];
};

type HrsOrderLike = {
  status?: string;
  prodStartAt?: string | null;
  prodEndAt?: string | null;
  prodDurationMin?: number | null;
  shiftCode?: string | null;
  orderLines?: Array<Record<string, unknown>>;
  holdReason?: string | null;
  holdRemarks?: string | null;
} | null;

type HrsEntryLike = {
  customerName?: string;
  prefill?: Record<string, unknown>;
  hrsCapture?: {
    scrapMt?: number | null;
    actualWidthMm?: number | null;
    weightMt?: number | null;
    slitSlots?: Array<Record<string, unknown>>;
  } | null;
  orderLines?: Array<Record<string, unknown>>;
} | null;

function field(label: string, value: unknown): HrsDetailField {
  if (value == null || value === '') return { label, value: '—' };
  return { label, value: String(value) };
}

/** PPC glance fields for HRS MH order detail. */
export function hrsPpcFields(
  card: ProcessQueueCard,
  orderOrEntry?: HrsOrderLike | HrsEntryLike,
  entry?: HrsEntryLike,
): ProcessPpcFields {
  const e = entry ?? (orderOrEntry as HrsEntryLike | null | undefined) ?? null;
  const p = e?.prefill ?? {};
  return {
    coilNo: card.coilNo,
    motherCoilNo: card.motherCoilNo ?? String(p.motherCoilNo ?? ''),
    customer: card.customerName
      || String((orderOrEntry as HrsEntryLike | null)?.customerName ?? '')
      || String(p.customerName ?? e?.customerName ?? ''),
    grade: card.gradeCode || String(p.gradeCode ?? ''),
    slitId: card.slitId ?? String(p.slitId ?? ''),
    widthMm: card.widthMm ?? (p.widthMm as number | string | undefined),
    thicknessMm: card.thicknessMm ?? (p.thicknessMm as number | string | undefined),
    weightMt: card.weightMt ?? (p.weightMt as number | string | undefined),
    route: card.routeRaw ?? String(p.routeRaw ?? ''),
    batch: card.batchNumber ?? card.coilNo,
    activeLineLabel: card.combination,
  };
}

/** Structured sections for HRS order detail drawers / MH panels. */
export function buildHrsOrderDetailSections(
  card: ProcessQueueCard,
  order: HrsOrderLike,
  entry: HrsEntryLike,
): HrsDetailSection[] {
  const sections: HrsDetailSection[] = [];
  const ppc = hrsPpcFields(card, order, entry);

  sections.push({
    id: 'ppc',
    title: 'PPC',
    fields: [
      field('Customer', ppc.customer),
      field('Grade', ppc.grade),
      field('Width', ppc.widthMm != null ? `${ppc.widthMm} mm` : null),
      field('Thickness', ppc.thicknessMm != null ? `${ppc.thicknessMm} mm` : null),
      field('Weight', ppc.weightMt != null ? `${ppc.weightMt} MT` : null),
      field('Combination', card.combination),
      field('Route', ppc.route),
    ],
  });

  const status = order?.status ?? card.status;
  sections.push({
    id: 'lifecycle',
    title: 'Lifecycle',
    fields: [
      field('Status', status),
      field('Prod start', order?.prodStartAt),
      field('Prod end', order?.prodEndAt),
      field('Duration', order?.prodDurationMin != null ? `${order.prodDurationMin} min` : null),
      field('Shift', order?.shiftCode),
    ],
  });

  const lines = order?.orderLines ?? entry?.orderLines ?? card.orderLines ?? [];
  if (lines.length > 0) {
    sections.push({
      id: 'lines',
      title: 'Order lines',
      fields: lines.map((line, i) =>
        field(
          String(line.batchNumber ?? line.slitId ?? `Line ${i + 1}`),
          [
            line.widthMm != null ? `${line.widthMm} mm` : null,
            line.weightMt != null ? `${line.weightMt} MT` : null,
          ].filter(Boolean).join(' · ') || '—',
        )),
    });
  }

  const capture = entry?.hrsCapture;
  if (capture && (
    capture.scrapMt != null
    || capture.actualWidthMm != null
    || (capture.slitSlots?.length ?? 0) > 0
  )) {
    sections.push({
      id: 'capture',
      title: 'Capture',
      fields: [
        field('Scrap', capture.scrapMt != null ? `${capture.scrapMt} MT` : null),
        field('Actual width', capture.actualWidthMm != null ? `${capture.actualWidthMm} mm` : null),
        field('Slots', capture.slitSlots?.length ?? 0),
      ],
    });
  }

  return sections;
}
