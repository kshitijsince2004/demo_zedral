import type { HandoverOverviewRow } from '../../services/machineHandoverService';

function HandoverList({ rows, emptyLabel }: { rows: HandoverOverviewRow[]; emptyLabel: string }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center border border-dashed border-border rounded-xl">
        {emptyLabel}
      </p>
    );
  }

  return (
    <ul className="text-xs border border-border rounded-xl divide-y divide-border">
      {rows.map((h) => (
        <li key={h.handoverId} className="px-3 py-2 flex flex-col gap-0.5">
          <div className="flex justify-between gap-2">
            <span className="font-mono font-semibold text-primary">{h.machineCode}</span>
            <span className="text-muted-foreground">{h.status}</span>
          </div>
          <div className="flex justify-between gap-2 text-muted-foreground">
            <span>{h.batchNumber ?? 'Idle'}</span>
            <span>{h.outgoingShiftCode} → {h.incomingShiftCode}</span>
          </div>
          {h.createdByBoundary && (
            <span className="text-[10px] uppercase tracking-wider text-amber-700">Boundary auto</span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function HandoverOverviewPanel({
  pending,
  recent,
  awaitingAcceptance,
}: {
  pending: HandoverOverviewRow[];
  recent: HandoverOverviewRow[];
  awaitingAcceptance: number;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
        <div className="border border-border rounded-xl p-3">
          <p className="text-muted-foreground text-xs">Awaiting acceptance</p>
          <p className="text-2xl font-mono font-bold text-warning mt-1">{awaitingAcceptance}</p>
        </div>
        <div className="border border-border rounded-xl p-3">
          <p className="text-muted-foreground text-xs">Pending handovers</p>
          <p className="text-2xl font-mono font-bold mt-1">{pending.length}</p>
        </div>
        <div className="border border-border rounded-xl p-3">
          <p className="text-muted-foreground text-xs">Recent completed</p>
          <p className="text-2xl font-mono font-bold mt-1">{recent.length}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Pending</h3>
          <HandoverList rows={pending} emptyLabel="No machines awaiting acceptance" />
        </div>
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Recent</h3>
          <HandoverList rows={recent.slice(0, 8)} emptyLabel="No recent handovers" />
        </div>
      </div>
    </div>
  );
}
