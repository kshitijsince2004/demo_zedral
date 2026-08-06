import { Package } from 'lucide-react';

export type ProcessPpcFields = {
  motherCoilNo?: string;
  coilNo?: string;
  customer?: string;
  grade?: string;
  slitId?: string;
  widthMm?: number | string;
  thicknessMm?: number | string;
  weightMt?: number | string;
  route?: string;
  batch?: string;
  /** Plan surface from PPC (M/B / Matt/Bright). When set, Route is hidden. */
  surface?: string;
  /** Plan mirror fields (RWD / rewinding Current Order). */
  planWidthMm?: number | string;
  planThicknessMm?: number | string;
  /** Slim active-line strip (HRS multi-slit). */
  activeLineLabel?: string;
};

function label(v: string) {
  return (
    <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground block mb-0.5">{v}</span>
  );
}

function cell(title: string, value: string, mono?: boolean, compact?: boolean) {
  return (
    <div className={`bg-muted/20 rounded-lg border border-border/50 ${compact ? 'p-1.5' : 'p-2'}`}>
      {label(title)}
      <p className={`text-sm font-semibold text-foreground truncate ${mono ? 'font-mono font-bold' : ''}`}>{value}</p>
    </div>
  );
}

function disp(v: number | string | undefined | null): string {
  if (v == null || v === '') return '—';
  return String(v);
}

function surfaceLabel(raw?: string): string {
  if (raw == null || raw === '') return '—';
  const v = raw.trim().toUpperCase();
  if (v === 'B' || v.includes('BRIGHT')) return 'Bright';
  if (v === 'M' || v.includes('MATT')) return 'Matt';
  return raw;
}

/** Process-agnostic PPC glance — mother/order summary for HRS/PKL/etc. */
export function ProcessPPCCards({
  data,
  compact,
  groupCount,
  groupWeightMt,
  hideRoute = false,
}: {
  data: ProcessPpcFields;
  compact?: boolean;
  groupCount?: number;
  groupWeightMt?: number;
  hideRoute?: boolean;
}) {
  const id = data.motherCoilNo || data.coilNo || '—';
  const w = data.widthMm != null && data.widthMm !== '' ? `${data.widthMm}` : '—';
  const t = data.thicknessMm != null && data.thicknessMm !== '' ? `${data.thicknessMm}` : '—';
  const wt = groupWeightMt ?? data.weightMt;
  const planW = data.planWidthMm ?? data.widthMm;
  const planT = data.planThicknessMm ?? data.thicknessMm;
  const showPlanRow = data.planWidthMm != null || data.planThicknessMm != null;
  const showSurface = data.surface !== undefined;

  return (
    <div className={`bg-card text-card-foreground border border-border rounded-xl shadow flex flex-col shrink-0 ${compact ? 'p-2' : 'p-4'}`}>
      <div className={`flex items-center justify-between border-b border-border/50 ${compact ? 'mb-2 pb-1' : 'mb-4 pb-2'}`}>
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-info flex items-center gap-2">
          <Package className="w-4 h-4" /> Current Order
          <span className="text-foreground ml-1 font-mono">{id}</span>
        </h3>
        {groupCount && groupCount > 1 ? (
          <span className="text-[9px] uppercase font-bold text-success bg-success/10 px-2 py-0.5 rounded">
            Selected {groupCount} · Σ {Number(groupWeightMt ?? 0).toFixed(2)} MT
          </span>
        ) : (
          <span className="text-[9px] uppercase font-bold text-success bg-success/10 px-2 py-0.5 rounded">
            ● Active
          </span>
        )}
      </div>

      <div className={`grid grid-cols-2 sm:grid-cols-3 ${compact ? 'gap-1.5' : 'gap-3'}`}>
        {cell('Customer', data.customer || '—', false, compact)}
        {cell('Grade', data.grade || '—', true, compact)}
        {cell('Slit ID', data.slitId || '—', true, compact)}
        {cell('Width / Thickness', `${w} mm / ${t} mm`, true, compact)}
        {cell(groupCount && groupCount > 1 ? 'Group Σ Wt' : 'Target Wt', wt != null && wt !== '' ? `${wt} MT` : '—', true, compact)}
        {cell('Batch', data.batch || '—', true, compact)}
        {showSurface ? cell('Surface', surfaceLabel(data.surface), false, compact) : null}
        {/* Route hidden when Surface is shown (RWD / 2HI rewinding). */}
        {!showSurface && !hideRoute && data.route ? cell('Route', data.route, false, compact) : null}
        {showPlanRow ? (
          <>
            {cell('Coil No', data.coilNo || id, true, compact)}
            {cell('Plan Width', disp(planW), true, compact)}
            {cell('Plan Thick', disp(planT), true, compact)}
          </>
        ) : null}
      </div>

      {data.activeLineLabel ? (
        <p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Active line · <span className="font-mono text-foreground normal-case tracking-normal">{data.activeLineLabel}</span>
        </p>
      ) : null}
    </div>
  );
}
