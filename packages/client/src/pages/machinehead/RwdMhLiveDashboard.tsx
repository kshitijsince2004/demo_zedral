import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import { Play, RefreshCw } from 'lucide-react';
import { MachineHeadShell } from '../../components/layout/machinehead/MachineHeadShell';
import { ZButton } from '../../components/primitives/ZButton';
import { ZInput } from '../../components/primitives/ZInput';
import { ZBadge } from '../../components/primitives/ZBadge';
import { ZFilterPills } from '../../components/ui/operator/ZFilterPills';
import { ZPillTabs } from '../../components/ui/operator/ZPillTabs';
import { RewindingMachineAllocationModal } from '../../components/rewinding/RewindingMachineAllocationModal';
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
import { formatOrderStatusLabel } from '../../lib/orderLabels';
import type { Tone } from '../../lib/tones';
import { displayMotherCoilId } from '../../lib/sixHiOrderIdentity';

function statusTone(status: string): Tone {
  const s = status.toUpperCase();
  if (s === 'PENDING' || s === 'HOLD' || s === 'REJECTED') return 'accent';
  if (s === 'IN_PROGRESS' || s === 'RUNNING') return 'success';
  if (s === 'STOPPAGE') return 'warning';
  if (s === 'PREPARING') return 'info';
  return 'muted';
}

type StatusFilter = 'ALL' | 'PENDING' | 'IN_PROGRESS' | 'HOLD' | 'COMPLETED';
type LiveView = 'overview' | 'history' | 'completed';

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
  const [allocCard, setAllocCard] = useState<RewindingQueueCard | null>(null);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [view, setView] = useState<LiveView>('overview');

  const { data, error, isLoading, mutate, isValidating } = useSWR(
    `/rewinding/queue?machine=${liveLine}`,
    async (url: string) => {
      const res = await apiClient.get<{ queue: RewindingQueueCard[] }>(url);
      return res.queue ?? [];
    },
    { refreshInterval: 15_000 },
  );

  const queue = useMemo(() => data ?? [], [data]);
  const running = useMemo(
    () => queue.find((c) => {
      const s = (c.status ?? '').toUpperCase();
      return s === 'IN_PROGRESS' || s === 'STOPPAGE' || s === 'PREPARING';
    }) ?? null,
    [queue],
  );
  const lineStatus = running
    ? ((running.status ?? '').toUpperCase() === 'STOPPAGE' ? 'STOPPAGE' : 'RUNNING')
    : 'IDLE';
  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = { ALL: 0, PENDING: 0, IN_PROGRESS: 0, HOLD: 0, COMPLETED: 0 };
    for (const card of queue) {
      const s = (card.status ?? 'PENDING').toUpperCase();
      if (s !== 'COMPLETED') c.ALL += 1;
      if (s === 'PENDING') c.PENDING += 1;
      else if (s === 'IN_PROGRESS' || s === 'STOPPAGE' || s === 'PREPARING') c.IN_PROGRESS += 1;
      else if (s === 'REJECTED') c.HOLD += 1;
      else if (s === 'COMPLETED') c.COMPLETED += 1;
    }
    return c;
  }, [queue]);

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

  function openCapture(card: RewindingQueueCard, machineCode: string, status?: string) {
    setActiveMachine(machineCode === '2HI' ? '2HI' : 'RWD');
    const base = username && role ? userScopePath(username, role) : '';
    navigate(`${base}/rewinding/${encodeURIComponent(card.coilNo)}`, {
      state: {
        batchNumber: card.batchNumber,
        orderStatus: status ?? card.status,
        prefill: rewindingCardToPrefill({
          ...card,
          machineAllocated: true,
          machineCode,
          status: status ?? card.status,
        }),
      },
    });
  }

  async function moveToProduction(card: RewindingQueueCard) {
    setBusy(true);
    setErr(null);
    try {
      let status = card.status;
      if ((card.status ?? '').toUpperCase() === 'REJECTED') {
        await reinstateRwdOrder(card.batchNumber, 'PREPARING');
        status = 'PREPARING';
      }
      // Unallocated → pick RWD or 2HI (Completion Plan Phase 1).
      if (!card.machineAllocated) {
        setAllocCard({ ...card, status });
        return;
      }
      const machine = (card.machineCode ?? liveLine).toUpperCase();
      await allocateRwdMachine(card.batchNumber, machine);
      openCapture(card, machine, status);
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
      fillViewport
      onRefresh={() => void mutate()}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-1">
        <ZPillTabs
          tabs={[
            { id: 'overview', label: 'Overview' },
            { id: 'history', label: 'History' },
            { id: 'completed', label: 'Orders completed' },
          ]}
          activeId={view}
          onChange={(id) => {
            setView(id as LiveView);
            if (id === 'completed') setStatusFilter('COMPLETED');
            else if (id === 'history') setStatusFilter('ALL');
          }}
        />
        {view === 'overview' && (
          <div className="rounded-lg border border-border bg-card p-4 shadow-sm shrink-0">
            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground mb-2">{liveLine} machine</p>
            <ZBadge
              tone={lineStatus === 'RUNNING' ? 'success' : lineStatus === 'STOPPAGE' ? 'warning' : 'muted'}
              label={lineStatus}
              dot
            />
            {running ? (
              <div className="mt-3 border-t border-border pt-3">
                <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground mb-1">Processing</p>
                <p className="font-mono text-xl font-bold tabular-nums">{displayMotherCoilId(running)}</p>
                <p className="text-sm text-muted-foreground">{running.customerName} · {running.gradeCode}</p>
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">No coil in progress</p>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-end gap-3 shrink-0">
          <div className="w-full max-w-xs">
            <ZInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search batch / coil…"
              mono={false}
              className="!h-10 rounded-lg"
            />
          </div>
          <ZButton
            variant="secondary"
            size="sm"
            disabled={isValidating}
            onClick={() => void mutate()}
            className="!h-10 !min-h-10 ml-auto"
          >
            <RefreshCw className={`h-4 w-4 ${isValidating ? 'animate-spin' : ''}`} />
            Refresh
          </ZButton>
        </div>
        {view !== 'overview' && (
        <ZFilterPills
          options={[
            { id: 'ALL', label: 'All', count: counts.ALL },
            { id: 'PENDING', label: 'Pending', count: counts.PENDING },
            { id: 'IN_PROGRESS', label: 'In progress', count: counts.IN_PROGRESS },
            { id: 'HOLD', label: 'Hold', count: counts.HOLD },
            { id: 'COMPLETED', label: 'Completed', count: counts.COMPLETED },
          ]}
          activeId={statusFilter}
          onChange={setStatusFilter}
        />
        )}

        {err && <p className="text-sm text-destructive">{err}</p>}
        {error && <p className="text-sm text-destructive">Failed to load queue</p>}
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

        <div className="min-h-0 flex-1 overflow-auto space-y-2">
          {filtered.map((card) => {
            const status = (card.status ?? 'PENDING').toUpperCase();
            return (
              <div
                key={card.batchNumber}
                className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-sm"
              >
                <button
                  type="button"
                  className="flex-1 min-w-0 text-left rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => navigate(`/machine-head/rwd/coil/${encodeURIComponent(card.batchNumber)}`)}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-bold tabular-nums text-foreground">{displayMotherCoilId(card)}</span>
                    <ZBadge tone={statusTone(status)} label={formatOrderStatusLabel(status)} />
                    {card.machineAllocated && (
                      <ZBadge tone="info" label={card.machineCode ?? liveLine} />
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground truncate mt-1">
                    {card.customerName} · {card.gradeCode}
                    <span className="font-mono tabular-nums"> · {card.widthMm}×{card.thicknessMm} mm · {card.weightMt} MT</span>
                  </p>
                  <p className="text-xs font-mono text-muted-foreground">{card.batchNumber}</p>
                </button>
                <ZButton
                  size="sm"
                  variant="primary"
                  disabled={busy}
                  onClick={() => void moveToProduction(card)}
                  className="!h-10 !min-h-10 shrink-0"
                >
                  <Play className="h-4 w-4" />
                  MTP
                </ZButton>
              </div>
            );
          })}
          {!isLoading && filtered.length === 0 && (
            <p className="text-center text-muted-foreground py-12">No orders in {liveLine} queue</p>
          )}
        </div>
      </div>

      <RewindingMachineAllocationModal
        open={!!allocCard}
        batchNumber={allocCard?.batchNumber ?? ''}
        coilLabel={allocCard ? displayMotherCoilId(allocCard) : ''}
        suggested={liveLine}
        onClose={() => setAllocCard(null)}
        onConfirm={async (machineCode) => {
          if (!allocCard) return;
          setBusy(true);
          setErr(null);
          try {
            await allocateRwdMachine(allocCard.batchNumber, machineCode);
            openCapture(allocCard, machineCode);
            setAllocCard(null);
            void mutate();
          } catch (e: unknown) {
            setErr(e instanceof Error ? e.message : 'Assignment failed');
            throw e;
          } finally {
            setBusy(false);
          }
        }}
      />
    </MachineHeadShell>
  );
}
