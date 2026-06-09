import type { SixHiOrderDetail, SixHiQueueCard } from '@m1/shared-validation';

type PPCSource = Pick<
  SixHiOrderDetail,
  | 'batchNumber'
  | 'motherCoil'
  | 'slitId'
  | 'customer'
  | 'grade'
  | 'widthMm'
  | 'inputThkMm'
  | 'targetThkMm'
  | 'ppcWeightMt'
  | 'subProcess'
  | 'ppcDestination'
  | 'ppcRollFinish'
  | 'ppcRerollFlag'
> | SixHiQueueCard;

function label(v: string) {
  return (
    <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{v}</span>
  );
}

export function PPCInfoCards({ data, compact }: { data: PPCSource; compact?: boolean }) {
  const isRolling = 'subProcess' in data && data.subProcess === 'ROLLING';
  const batch = 'batchNumber' in data ? data.batchNumber : undefined;

  const weight = 'ppcWeightMt' in data ? data.ppcWeightMt : ('weightMt' in data ? data.weightMt : 0);
  const chips = [
    { l: 'Customer', v: data.customer },
    { l: 'Grade', v: data.grade, mono: true },
    { l: 'Mother Coil', v: `${data.motherCoil}${data.slitId ? `/${data.slitId}` : ''}`, mono: true },
    { l: 'Width (mm)', v: `${data.widthMm}`, mono: true },
    { l: 'Input Thickness (mm)', v: `${data.inputThkMm}`, mono: true },
    { l: 'Target Thickness (mm)', v: `${data.targetThkMm}`, mono: true },
    { l: 'Weight (Metric Tons)', v: `${weight}`, mono: true },
  ];

  if (compact) {
    return (
      <div className="shrink-0 bg-white border border-border rounded-xl px-2 py-2">
        <div className="flex items-center gap-1 mb-1.5">
          <span className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
            PPC Plan {batch ? `· ${batch}` : ''}
          </span>
          <span className="text-sm text-muted-foreground ml-auto">Read-only</span>
        </div>
        <div className="grid grid-cols-4 lg:grid-cols-7 gap-2">
          {chips.map((c) => (
            <div key={c.l} className="bg-secondary rounded-lg px-2.5 py-2.5 min-h-[64px]">
              <p className="text-[11px] font-bold uppercase text-muted-foreground leading-snug">{c.l}</p>
              <p className={`text-base font-bold text-foreground truncate mt-0.5 ${c.mono ? 'font-mono' : ''}`}>{c.v}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-border rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          PPC Plan {batch ? `· ${batch}` : ''}
        </h3>
        <span className="text-[10px] text-muted-foreground">Read-only</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {[
          { l: 'Customer', v: data.customer },
          { l: 'Grade', v: data.grade, mono: true },
          { l: 'Width', v: `${data.widthMm} mm`, mono: true },
          { l: 'Input Thickness', v: `${data.inputThkMm} mm`, mono: true },
          { l: 'Target Thickness', v: `${data.targetThkMm} mm`, mono: true },
          { l: 'Weight (Metric Tons)', v: `${'ppcWeightMt' in data ? data.ppcWeightMt : ('weightMt' in data ? data.weightMt : 0)}`, mono: true },
          { l: 'Mother Coil', v: `${data.motherCoil}${data.slitId ? `/${data.slitId}` : ''}`, mono: true },
        ].map((c) => (
          <div key={c.l} className="bg-secondary rounded-xl px-3 py-2.5 min-h-[56px]">
            {label(c.l)}
            <p className={`text-sm font-semibold text-foreground mt-0.5 ${c.mono ? 'font-mono' : ''}`}>{c.v}</p>
          </div>
        ))}
        {isRolling && 'ppcDestination' in data && (
          <>
            <div className="bg-secondary rounded-xl px-3 py-2.5 min-h-[56px]">
              {label('Destination')}
              <p className="text-sm font-semibold text-foreground mt-0.5">
                {data.ppcDestination === 'REWINDING' ? 'Rewinding' : 'Annealing'}
              </p>
            </div>
            <div className="bg-secondary rounded-xl px-3 py-2.5 min-h-[56px]">
              {label('Roll Finish')}
              <p className="text-sm font-semibold text-foreground mt-0.5">{data.ppcRollFinish ?? '—'}</p>
            </div>
            <div className="bg-secondary rounded-xl px-3 py-2.5 min-h-[56px]">
              {label('Re-Roll')}
              <p className="text-sm font-semibold text-foreground mt-0.5">{data.ppcRerollFlag ? 'Yes' : 'No'}</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
