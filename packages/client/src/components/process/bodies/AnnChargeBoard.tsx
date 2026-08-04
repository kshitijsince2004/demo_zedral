import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Search } from 'lucide-react';
import { ZButton } from '../../primitives/ZButton';
import { ZInput } from '../../primitives/ZInput';
import { ZFilterPills } from '../../ui/operator/ZFilterPills';
import { apiClient } from '../../../lib/apiClient';
import { useProcessWorkspaceBase } from '../../../hooks/useProcessWorkspaceBase';
import type { BodyProps } from '../../../lib/processConfig';
import { AnnBaseCard, boardCardStatus, type AnnBoardCardStatus, type AnnBoardRow } from './AnnBaseCard';

type StatusFilter = 'ALL' | AnnBoardCardStatus;

/** ANN Base Cards grid — create lives on MH Ann Batching. */
export function AnnChargeBoard(_props: BodyProps) {
  const navigate = useNavigate();
  const { basePath } = useProcessWorkspaceBase();
  const [board, setBoard] = useState<AnnBoardRow[]>([]);
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');

  async function reload() {
    const b = await apiClient.get<{ board: AnnBoardRow[] }>('/stations/ann/board');
    setBoard(b.board ?? []);
  }

  useEffect(() => {
    void reload();
    const id = setInterval(() => void reload(), 30_000);
    return () => clearInterval(id);
  }, []);

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = { ALL: board.length, RUNNING: 0, WARNING: 0, COMPLETE: 0, IDLE: 0 };
    for (const row of board) c[boardCardStatus(row)] += 1;
    return c;
  }, [board]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return board.filter((row) => {
      const status = boardCardStatus(row);
      if (statusFilter !== 'ALL' && status !== statusFilter) return false;
      if (!q) return true;
      const stage = (row.charge?.current_stage_code ?? '').toLowerCase();
      const batch = (row.charge?.annealing_batch_no ?? '').toLowerCase();
      const base = row.base_no.toLowerCase();
      const charge = (row.charge?.charge_no ?? '').toLowerCase();
      return (
        status.toLowerCase().includes(q) ||
        (status === 'WARNING' && 'stoppage'.includes(q)) ||
        stage.includes(q) ||
        batch.includes(q) ||
        base.includes(q) ||
        charge.includes(q)
      );
    });
  }, [board, filter, statusFilter]);

  return (
    <div className="flex flex-col h-full min-h-0 overflow-auto p-4 md:p-5 gap-3">
      <header className="shrink-0 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl md:text-2xl font-bold tracking-tight text-foreground">Base Cards</h1>
          <ZButton
            type="button"
            variant="secondary"
            size="sm"
            className="min-h-10 h-10 rounded-lg"
            onClick={() => void reload()}
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
            Refresh
          </ZButton>
        </div>
        <ZFilterPills
          options={[
            { id: 'ALL', label: 'All', count: counts.ALL },
            { id: 'RUNNING', label: 'Running', count: counts.RUNNING },
            { id: 'WARNING', label: 'Stoppage', count: counts.WARNING },
            { id: 'COMPLETE', label: 'Complete', count: counts.COMPLETE },
            { id: 'IDLE', label: 'Idle', count: counts.IDLE },
          ]}
          activeId={statusFilter}
          onChange={setStatusFilter}
        />
        <div className="w-full max-w-sm relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none z-10" aria-hidden />
          <ZInput
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by base, batch, stage…"
            className="pl-9 h-10 min-h-10 rounded-lg bg-card"
            mono={false}
            aria-label="Filter by base, batch, or stage"
          />
        </div>
      </header>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">No bases match this filter.</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
          {filtered.map((row) => (
            <AnnBaseCard
              key={row.base_no}
              row={row}
              onOpen={(cn) => navigate(`${basePath}/charge/${encodeURIComponent(cn)}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
