import type { SixHiOrderStoppage } from '@m1/shared-validation';

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function OrderStoppagePanel({ stoppages }: { stoppages: SixHiOrderStoppage[] }) {
  if (stoppages.length === 0) {
    return (
      <div className="bg-white border border-border rounded-2xl p-4">
        <h3 className="text-sm font-bold text-foreground mb-1">Stoppages</h3>
        <p className="text-sm text-muted-foreground">No stoppages on this order.</p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-border rounded-2xl p-4 space-y-2">
      <h3 className="text-sm font-bold text-foreground">Stoppages</h3>
      <ul className="space-y-2 max-h-40 overflow-auto">
        {stoppages.map((s) => (
          <li
            key={s.id}
            className={[
              'rounded-xl px-3 py-2 text-sm border',
              s.endAt ? 'border-border/60 bg-secondary/40' : 'border-warning/40 bg-warning/5',
            ].join(' ')}
          >
            <div className="flex justify-between gap-2 font-semibold text-foreground">
              <span>{s.categoryLabel}{s.breakdownCode ? ` / ${s.breakdownCode}` : ''}</span>
              {!s.endAt && <span className="text-warning text-xs">ACTIVE</span>}
            </div>
            <p className="font-mono text-xs text-muted-foreground mt-1">
              {fmtTime(s.startAt)}
              {s.endAt ? ` – ${fmtTime(s.endAt)}` : ' – …'}
              {s.durationMin != null ? ` · ${s.durationMin} min` : ''}
            </p>
            {s.remarks && <p className="text-xs text-muted-foreground mt-0.5">{s.remarks}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
