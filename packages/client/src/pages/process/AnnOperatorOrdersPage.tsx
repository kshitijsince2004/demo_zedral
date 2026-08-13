import { useCallback, useEffect, useMemo, useState } from 'react';
import { Info } from 'lucide-react';
import { AnnQueueOrderDetailDrawer } from '../../components/process/AnnQueueOrderDetailDrawer';
import { ZInput } from '../../components/primitives/ZInput';
import { apiClient } from '../../lib/apiClient';
import { displayMotherCoilId } from '../../lib/sixHiOrderIdentity';
import type { ProcessQueueCard } from '../../store/processStore';

/** Operator ANN Orders — pending queue + detail drawer. */
export function AnnOperatorOrdersPage() {
  const [queue, setQueue] = useState<ProcessQueueCard[]>([]);
  const [search, setSearch] = useState('');
  const [detailCard, setDetailCard] = useState<ProcessQueueCard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const q = await apiClient.get<{ queue: ProcessQueueCard[] }>('/stations/ann/queue');
      setQueue((q.queue ?? []).filter((c) =>
        c.status === 'PENDING' || c.status === 'PREPARING' || c.status === 'IN_PROGRESS',
      ));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load orders');
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return queue;
    return queue.filter((c) => {
      const hay = [c.coilNo, c.batchNumber, c.gradeCode, c.customerName, c.annealingBatch]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [queue, search]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="shrink-0 space-y-2 border-b border-border px-4 py-3">
        <h1 className="text-sm font-bold uppercase tracking-widest text-foreground">Orders</h1>
        <p className="text-xs text-muted-foreground">Inspect queue coils before batching</p>
        <ZInput
          className="!h-10 rounded-lg max-w-md"
          placeholder="Search coil / batch / grade / customer"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          mono={false}
          aria-label="Search orders"
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
      </header>
      <ul className="min-h-0 flex-1 overflow-y-auto p-3 space-y-1">
        {visible.length === 0 && (
          <li className="text-sm text-muted-foreground px-2 py-6">No pending coils.</li>
        )}
        {visible.map((c) => (
          <li key={c.coilNo} className="relative">
            <button
              type="button"
              className="w-full min-h-11 rounded-lg border border-border bg-card px-3 py-2 pr-10 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setDetailCard(c)}
            >
              <span className="font-mono tabular-nums font-semibold text-foreground">
                {displayMotherCoilId(c)}
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {c.gradeCode ?? '—'} · {Number(c.weightMt ?? 0).toFixed(2)} MT
                {c.customerName ? ` · ${c.customerName}` : ''}
                {c.batchNumber ? ` · ${c.batchNumber}` : ''}
              </span>
            </button>
            <button
              type="button"
              className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={`Order details for ${displayMotherCoilId(c)}`}
              onClick={() => setDetailCard(c)}
            >
              <Info className="h-4 w-4" strokeWidth={2} aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <AnnQueueOrderDetailDrawer
        card={detailCard}
        open={!!detailCard}
        onClose={() => setDetailCard(null)}
      />
    </div>
  );
}
