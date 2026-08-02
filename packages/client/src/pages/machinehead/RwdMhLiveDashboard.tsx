import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import { Play, RefreshCw } from 'lucide-react';
import { MachineHeadShell } from '../../components/layout/machinehead/MachineHeadShell';
import { ZButton } from '../../components/primitives/ZButton';
import { ZInput } from '../../components/primitives/ZInput';
import { ZBadge } from '../../components/primitives/ZBadge';
import { apiClient } from '../../lib/apiClient';
import { useAuthStore } from '../../lib/authStore';
import { useMhDeskFocus } from '../../lib/annMhDesk';
import { useOperationalMachineAccess } from '../../lib/useOperationalMachineAccess';
import { allocateRwdMachine, reinstateRwdOrder } from '../../lib/rewindingWrites';
import { resolveRwdLiveLine } from '../../lib/rwdMhDesk';
import {
  rewindingCardToPrefill,
  type RewindingQueueCard,
} from '../../lib/rewindingQueue';
import { userScopePath } from '../../lib/userScope';

/** MH Live for Rewinding line — backed by /rewinding/queue?machine=RWD|2HI. */
export function RwdMhLiveDashboard() {
  const navigate = useNavigate();
  const username = useAuthStore((s) => s.username);
  const role = useAuthStore((s) => s.role);
  const setActiveMachine = useAuthStore((s) => s.setActiveMachine);
  const machines = useOperationalMachineAccess();
  const focus = useMhDeskFocus((s) => s.focus);
  const liveLine = resolveRwdLiveLine(machines, focus);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<
    'ALL' | 'PENDING' | 'IN_PROGRESS' | 'HOLD' | 'COMPLETED'
  >('ALL');

  const { data, error, isLoading, mutate, isValidating } = useSWR(
    `/rewinding/queue?machine=${liveLine}`,
    async (url) => {
      const res = await apiClient.get<{ queue: RewindingQueueCard[] }>(url);
      return res.queue ?? [];
    },
    { refreshInterval: 15_000 },
  );

  const queue = data ?? [];
  const filtered = useMemo(() => {
    const byStatus = queue.filter((c) => {
      const s = (c.status ?? 'PENDING').toUpperCase();
      if (statusFilter === 'ALL') return s !== 'COMPLETED';
      if (statusFilter === 'IN_PROGRESS') return s === 'IN_PROGRESS' || s === 'STOPPAGE' || s === 'PREPARING';
      if (statusFilter === 'HOLD') return s === 'REJECTED';
      return s === statusFilter;
    });
    const q = search.trim().toLowerCase();
    if (!q) return byStatus;
    return byStatus.filter((c) =>
      [c.batchNumber, c.coilNo, c.displayCoilNo, c.customerName, c.gradeCode]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [queue, search, statusFilter]);

  async function moveToProduction(card: RewindingQueueCard) {
    setBusy(true);
    setErr(null);
    try {
      if ((card.status ?? '').toUpperCase() === 'REJECTED') {
        await reinstateRwdOrder(card.batchNumber, 'PREPARING');
      }
      await allocateRwdMachine(card.batchNumber, liveLine);
      setActiveMachine(liveLine === '2HI' ? '2HI' : 'RWD');
      const base = username && role ? userScopePath(username, role) : '';
      navigate(`${base}/rewinding/${encodeURIComponent(card.coilNo)}`, {
        state: {
          batchNumber: card.batchNumber,
          orderStatus: (card.status ?? '').toUpperCase() === 'REJECTED' ? 'PREPARING' : card.status,
          prefill: rewindingCardToPrefill({
            ...card,
            machineAllocated: true,
            machineCode: liveLine,
            status: (card.status ?? '').toUpperCase() === 'REJECTED' ? 'PREPARING' : card.status,
          }),
        },
      });
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to move to production');
    } finally {
      setBusy(false);
    }
  }

  return (
    <MachineHeadShell
      title={`${liveLine} Live Dashboard`}
      subtitle="Rewinding orders"
      onRefresh={() => void mutate()}
    >
      <div className="flex flex-col gap-4 p-4 max-w-6xl mx-auto w-full">
        <div className="flex flex-wrap items-center gap-2">
          <ZInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search batch / coil…"
            className="max-w-xs"
          />
          <div className="flex gap-1 flex-wrap">
            {(['ALL', 'PENDING', 'IN_PROGRESS', 'HOLD', 'COMPLETED'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={[
                  'px-3 py-1.5 rounded-lg text-xs font-bold uppercase',
                  statusFilter === s ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground',
                ].join(' ')}
              >
                {s === 'HOLD' ? 'Hold' : s.replace('_', ' ')}
              </button>
            ))}
          </div>
          <ZButton
            variant="secondary"
            size="sm"
            disabled={isValidating}
            onClick={() => void mutate()}
            className="ml-auto"
          >
            <RefreshCw className={`h-4 w-4 ${isValidating ? 'animate-spin' : ''}`} />
          </ZButton>
        </div>

        {err && <p className="text-sm text-destructive">{err}</p>}
        {error && <p className="text-sm text-destructive">Failed to load queue</p>}
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

        <div className="space-y-2">
          {filtered.map((card) => (
            <div
              key={card.batchNumber}
              className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono font-bold">{card.displayCoilNo || card.coilNo}</span>
                  <ZBadge tone="muted" label={(card.status ?? 'PENDING').toUpperCase()} />
                  {card.machineAllocated && (
                    <ZBadge tone="info" label={card.machineCode ?? liveLine} />
                  )}
                </div>
                <p className="text-sm text-muted-foreground truncate">
                  {card.customerName} · {card.gradeCode} · {card.widthMm}×{card.thicknessMm} · {card.weightMt} MT
                </p>
                <p className="text-xs font-mono text-muted-foreground">{card.batchNumber}</p>
              </div>
              <ZButton
                size="sm"
                disabled={busy}
                onClick={() => void moveToProduction(card)}
              >
                <Play className="h-4 w-4 mr-1" />
                MTP
              </ZButton>
            </div>
          ))}
          {!isLoading && filtered.length === 0 && (
            <p className="text-center text-muted-foreground py-12">No orders in {liveLine} queue</p>
          )}
        </div>
      </div>
    </MachineHeadShell>
  );
}
