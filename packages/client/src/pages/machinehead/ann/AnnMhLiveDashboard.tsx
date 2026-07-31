import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LineChart } from 'lucide-react';
import { MachineHeadShell } from '../../../components/layout/machinehead/MachineHeadShell';
import { AnnBaseCard, type AnnBoardRow } from '../../../components/process/bodies/AnnBaseCard';
import { ZButton } from '../../../components/primitives/ZButton';
import { apiClient } from '../../../lib/apiClient';

/** ANN MH Live — base cards; open full-screen charge detail. */
export function AnnMhLiveDashboard() {
  const navigate = useNavigate();
  const [board, setBoard] = useState<AnnBoardRow[]>([]);
  const [filter, setFilter] = useState('');

  const reload = useCallback(async () => {
    const b = await apiClient.get<{ board: AnnBoardRow[] }>('/stations/ann/board');
    setBoard(b.board ?? []);
  }, []);

  useEffect(() => {
    void reload();
    const id = setInterval(() => void reload(), 30_000);
    return () => clearInterval(id);
  }, [reload]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return board;
    return board.filter((row) => {
      const batch = (row.charge?.annealing_batch_no ?? '').toLowerCase();
      const stage = (row.charge?.current_stage_code ?? '').toLowerCase();
      return row.base_no.toLowerCase().includes(q) || batch.includes(q) || stage.includes(q);
    });
  }, [board, filter]);

  return (
    <MachineHeadShell
      title="ANN Live Dashboard"
      subtitle="Base cards — open for full charge detail"
      fillViewport
      onRefresh={() => void reload()}
      headerActions={
        <ZButton variant="secondary" size="sm" onClick={() => navigate('/machine-head/ann/trends')}>
          <LineChart className="h-4 w-4" aria-hidden />
          Trends
        </ZButton>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
        <input
          className="h-10 w-full max-w-sm rounded-lg border border-input bg-background px-3 text-sm"
          placeholder="Filter base / batch / stage"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter bases"
        />
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            {filtered.map((row) => (
              <AnnBaseCard
                key={row.base_no}
                row={row}
                onOpen={(cn) => navigate(`/machine-head/ann/charge/${encodeURIComponent(cn)}`)}
              />
            ))}
          </div>
        </div>
      </div>
    </MachineHeadShell>
  );
}
