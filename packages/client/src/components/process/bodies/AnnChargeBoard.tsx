import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { ZButton } from '../../primitives/ZButton';
import { ZInput } from '../../primitives/ZInput';
import { apiClient } from '../../../lib/apiClient';
import { useProcessWorkspaceBase } from '../../../hooks/useProcessWorkspaceBase';
import type { BodyProps } from '../../../lib/processConfig';
import { AnnBaseCard, boardCardStatus, type AnnBoardRow } from './AnnBaseCard';

/** ANN Base Cards grid — create lives on MH Ann Batching. */
export function AnnChargeBoard(_props: BodyProps) {
  const navigate = useNavigate();
  const { basePath } = useProcessWorkspaceBase();
  const [board, setBoard] = useState<AnnBoardRow[]>([]);
  const [filter, setFilter] = useState('');

  async function reload() {
    const b = await apiClient.get<{ board: AnnBoardRow[] }>('/stations/ann/board');
    setBoard(b.board ?? []);
  }

  useEffect(() => {
    void reload();
    const id = setInterval(() => void reload(), 30_000);
    return () => clearInterval(id);
  }, []);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return board;
    return board.filter((row) => {
      const status = boardCardStatus(row).toLowerCase();
      const stage = (row.charge?.current_stage_code ?? '').toLowerCase();
      const batch = (row.charge?.annealing_batch_no ?? '').toLowerCase();
      const base = row.base_no.toLowerCase();
      const charge = (row.charge?.charge_no ?? '').toLowerCase();
      return status.includes(q) || stage.includes(q) || batch.includes(q) || base.includes(q) || charge.includes(q);
    });
  }, [board, filter]);

  return (
    <div className="flex flex-col h-full min-h-0 overflow-auto p-4 md:p-5 gap-3">
      <header className="shrink-0 space-y-3">
        <h1 className="text-xl md:text-2xl font-bold tracking-tight text-foreground">Base Cards</h1>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="w-full max-w-sm relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none z-10" aria-hidden />
            <ZInput
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by status or stage"
              className="pl-9 h-10 min-h-10 rounded-lg bg-card"
              mono={false}
              aria-label="Filter by status or stage"
            />
          </div>
          <div className="flex gap-2 sm:justify-end">
            <ZButton
              type="button"
              variant="primary"
              className="min-h-10 h-10 min-w-[6rem] rounded-lg"
              onClick={() => void reload()}
            >
              Search
            </ZButton>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
        {filtered.map((row) => (
          <AnnBaseCard
            key={row.base_no}
            row={row}
            onOpen={(cn) => navigate(`${basePath}/charge/${encodeURIComponent(cn)}`)}
          />
        ))}
      </div>
    </div>
  );
}
