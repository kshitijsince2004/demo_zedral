import React from 'react';

interface Stoppage {
  id: string;
  startTime: string;
  endTime?: string | null;
  durationMins?: number | null;
  categoryCode?: string;
  categoryName?: string;
  breakdownName?: string;
  remarks?: string | null;
}

interface ShiftStoppageHistoryProps {
  stoppages: Stoppage[];
}

function formatDuration(mins?: number | null) {
  if (mins == null) return '—';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function ShiftStoppageHistory({ stoppages }: ShiftStoppageHistoryProps) {
  return (
    <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden flex flex-col">
      <div className="bg-muted/30 px-4 py-3 border-b border-border flex items-center justify-between">
        <h3 className="font-bold text-sm text-foreground">Shift Stoppage History</h3>
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{stoppages.length} Records</span>
      </div>

      {stoppages.length === 0 ? (
        <div className="p-8 text-center text-sm font-medium text-muted-foreground">
          No stoppages recorded in this shift.
        </div>
      ) : (
        <div className="overflow-auto max-h-[300px]">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/10 sticky top-0 border-b border-border">
              <tr>
                <th className="px-4 py-2 font-semibold text-muted-foreground text-xs">Start Time</th>
                <th className="px-4 py-2 font-semibold text-muted-foreground text-xs">End Time</th>
                <th className="px-4 py-2 font-semibold text-muted-foreground text-xs">Duration</th>
                <th className="px-4 py-2 font-semibold text-muted-foreground text-xs">Stoppage Code</th>
                <th className="px-4 py-2 font-semibold text-muted-foreground text-xs">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {stoppages.map((s) => (
                <tr key={s.id} className="hover:bg-muted/5 transition-colors">
                  <td className="px-4 py-2 font-mono text-foreground">
                    {new Date(s.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td className="px-4 py-2 font-mono text-muted-foreground">
                    {s.endTime ? new Date(s.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Ongoing'}
                  </td>
                  <td className="px-4 py-2 font-mono text-warning font-medium">{formatDuration(s.durationMins)}</td>
                  <td className="px-4 py-2 font-mono font-bold text-foreground">{s.categoryCode || '—'}</td>
                  <td className="px-4 py-2 text-foreground">
                    <span className="font-medium">{s.categoryName || 'Unknown'}</span>
                    {(s.breakdownName || s.remarks) && (
                      <span className="text-muted-foreground block text-xs mt-0.5">
                        {[s.breakdownName, s.remarks].filter(Boolean).join(' - ')}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
