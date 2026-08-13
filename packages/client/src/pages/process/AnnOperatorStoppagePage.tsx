import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ZButton } from '../../components/primitives/ZButton';
import type { AnnBoardRow } from '../../components/process/bodies/AnnBaseCard';
import { apiClient } from '../../lib/apiClient';
import { useProcessWorkspaceBase } from '../../hooks/useProcessWorkspaceBase';

type OpenStoppage = {
  stoppage_id: string | number;
  category_code?: string;
  reason?: string | null;
  start_at?: string;
};

/** Operator ANN Stoppage hub — open stoppages first; link others to charge page. */
export function AnnOperatorStoppagePage() {
  const navigate = useNavigate();
  const { basePath } = useProcessWorkspaceBase();
  const [board, setBoard] = useState<AnnBoardRow[]>([]);
  const [openByCharge, setOpenByCharge] = useState<Record<string, OpenStoppage>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const b = await apiClient.get<{ board: AnnBoardRow[] }>('/stations/ann/board');
      const rows = b.board ?? [];
      setBoard(rows);
      const openRows = rows.filter((r) => r.charge && r.has_open_stoppage);
      const map: Record<string, OpenStoppage> = {};
      await Promise.all(
        openRows.map(async (r) => {
          const cn = r.charge!.charge_no;
          const d = await apiClient.get<{
            stoppages: Array<{ stoppage_id: string | number; end_at: string | null; category_code?: string; reason?: string | null; start_at?: string }>;
          }>(`/stations/ann/charges/${encodeURIComponent(cn)}`);
          const open = (d.stoppages ?? []).find((s) => !s.end_at);
          if (open) map[cn] = open;
        }),
      );
      setOpenByCharge(map);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load stoppages');
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const withCharge = useMemo(
    () => board.filter((r) => r.charge && r.charge.status !== 'DONE'),
    [board],
  );
  const openFirst = useMemo(
    () => [
      ...withCharge.filter((r) => r.has_open_stoppage),
      ...withCharge.filter((r) => !r.has_open_stoppage),
    ],
    [withCharge],
  );

  async function endOpen(chargeNo: string) {
    const open = openByCharge[chargeNo];
    if (!open) return;
    setBusy(true);
    setError(null);
    try {
      await apiClient.post('/stations/ann/charges', {
        action: 'stoppage-end',
        stoppageId: String(open.stoppage_id),
      });
      await reload();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'End stoppage failed');
    } finally {
      setBusy(false);
    }
  }

  function openCharge(chargeNo: string) {
    navigate(`${basePath}/charge/${encodeURIComponent(chargeNo)}`);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-border px-4 py-3">
        <h1 className="text-sm font-bold uppercase tracking-widest text-foreground">Stoppage</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          End open stoppages here · start new ones from the charge page
        </p>
        {error && <p className="text-sm text-destructive mt-2">{error}</p>}
      </header>
      <ul className="min-h-0 flex-1 overflow-y-auto p-3 space-y-2">
        {openFirst.length === 0 && (
          <li className="text-sm text-muted-foreground px-2 py-6">No active charges.</li>
        )}
        {openFirst.map((r) => {
          const cn = r.charge!.charge_no;
          const open = openByCharge[cn];
          const isOpen = r.has_open_stoppage;
          return (
            <li
              key={cn}
              className={[
                'rounded-lg border bg-card px-3 py-3 space-y-2',
                isOpen ? 'border-status-stopped/50' : 'border-border',
              ].join(' ')}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-mono font-bold text-sm truncate">
                    {r.charge?.annealing_batch_no ?? cn}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Base {r.base_no} · {r.charge?.current_stage_code ?? '—'} · {r.charge?.status}
                  </p>
                  {isOpen && open ? (
                    <p className="text-xs text-status-stopped mt-1">
                      OPEN · {open.category_code ?? 'stoppage'}
                      {open.reason ? ` · ${open.reason}` : ''}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-1">No open stoppage</p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col gap-1.5">
                  {isOpen && open ? (
                    <ZButton
                      type="button"
                      variant="primary"
                      className="!h-9 !min-h-9 rounded-lg text-xs"
                      disabled={busy}
                      onClick={() => void endOpen(cn)}
                    >
                      End stoppage
                    </ZButton>
                  ) : null}
                  <ZButton
                    type="button"
                    variant="secondary"
                    className="!h-9 !min-h-9 rounded-lg text-xs"
                    onClick={() => openCharge(cn)}
                  >
                    {isOpen ? 'Open charge' : 'Start stoppage'}
                  </ZButton>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
