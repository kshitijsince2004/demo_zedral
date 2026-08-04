import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LineChart, Search } from 'lucide-react';
import { MachineHeadShell } from '../../../components/layout/machinehead/MachineHeadShell';
import { AnnBaseCard, boardCardStatus, type AnnBoardCardStatus, type AnnBoardRow } from '../../../components/process/bodies/AnnBaseCard';
import { ZInput } from '../../../components/primitives/ZInput';
import { ZFilterPills } from '../../../components/ui/operator/ZFilterPills';
import { apiClient } from '../../../lib/apiClient';

type StatusFilter = 'ALL' | AnnBoardCardStatus;

/** ANN MH Live — base cards; open full-screen charge detail. */
export function AnnMhLiveDashboard() {
  const navigate = useNavigate();
  const [board, setBoard] = useState<AnnBoardRow[]>([]);
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');

  const reload = useCallback(async () => {
    const b = await apiClient.get<{ board: AnnBoardRow[] }>('/stations/ann/board');
    setBoard(b.board ?? []);
  }, []);

  useEffect(() => {
    void reload();
    const id = setInterval(() => void reload(), 30_000);
    return () => clearInterval(id);
  }, [reload]);

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
      const batch = (row.charge?.annealing_batch_no ?? '').toLowerCase();
      const stage = (row.charge?.current_stage_code ?? '').toLowerCase();
      return row.base_no.toLowerCase().includes(q) || batch.includes(q) || stage.includes(q);
    });
  }, [board, filter, statusFilter]);

  return (
    <MachineHeadShell
      title="ANN Live Dashboard"
      subtitle="Base cards — open for full charge detail"
      fillViewport
      onRefresh={() => void reload()}
      headerActions={
        <button
          type="button"
          onClick={() => navigate('/machine-head/ann/trends')}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border bg-background px-4 text-xs font-semibold text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <LineChart className="h-4 w-4" aria-hidden />
          Trends
        </button>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
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
            className="pl-9 h-10 min-h-10 rounded-lg"
            placeholder="Filter base / batch / stage"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            mono={false}
            aria-label="Filter bases"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No bases match this filter.</p>
          ) : (
            <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
              {filtered.map((row) => (
                <AnnBaseCard
                  key={row.base_no}
                  row={row}
                  onOpen={(cn) => navigate(`/machine-head/ann/charge/${encodeURIComponent(cn)}`)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </MachineHeadShell>
  );
}
