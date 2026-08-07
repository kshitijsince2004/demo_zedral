import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, ClipboardList } from 'lucide-react';
import { apiClient } from '../../lib/apiClient';
import { currentPlantDate, formatPlantDateTime, formatShiftDate } from '../../lib/dateFormat';
import { bootstrapShiftContext } from '../../lib/shiftDetection';
import { useAuthStore } from '../../lib/authStore';
import { MachineHeadShell } from '../../components/layout/machinehead/MachineHeadShell';
import { ZButton } from '../../components/primitives/ZButton';
import { useOperationalMachineAccess } from '../../lib/useOperationalMachineAccess';
import { isAnnMhDesk, useMhDeskFocus } from '../../lib/annMhDesk';
import { isPklMhDesk } from '../../lib/pklMhDesk';
import { AnnShiftReviewPanel } from '../../components/process/AnnShiftReviewPanel';
import { PklShiftReviewPanel } from '../../components/process/PklShiftReviewPanel';
import { DataFreshnessBadge } from '../../components/DataFreshnessBadge';
import {
  COMPLETED_STATES,
  SHIFT_ORDER,
  VISIBLE_STATES,
  ShiftCompleteForm,
  ShiftReviewPanel,
  StateBadge,
  isActiveState,
  type ShiftLogRow,
  type ShiftReviewData,
  type StatusFilter,
} from './PlantShiftReviewPanels';

// PERF-B3 — thin container; panels in PlantShiftReviewPanels

function sortLogsForDay(a: ShiftLogRow, b: ShiftLogRow): number {
  const activeDelta = Number(isActiveState(b.state)) - Number(isActiveState(a.state));
  if (activeDelta !== 0) return activeDelta;
  const shiftDelta = (SHIFT_ORDER[a.shiftCode] ?? 9) - (SHIFT_ORDER[b.shiftCode] ?? 9);
  if (shiftDelta !== 0) return shiftDelta;
  const machineA = a.reviewMachine ?? a.millType ?? a.machines?.[0] ?? '';
  const machineB = b.reviewMachine ?? b.millType ?? b.machines?.[0] ?? '';
  const machineDelta = machineA.localeCompare(machineB);
  if (machineDelta !== 0) return machineDelta;
  return a.processLine.localeCompare(b.processLine);
}

/** Normalize API rows to exactly one machine · one shift · one card. */
function expandMachineCards(logs: ShiftLogRow[], allowedMachines?: string[]): ShiftLogRow[] {
  const allow = allowedMachines?.map((m) => m.toUpperCase());
  const out: ShiftLogRow[] = [];

  for (const log of logs) {
    const fromServer = (log.machine || log.millType || '').toUpperCase();
    let machines = fromServer
      ? [fromServer]
      : (log.machines ?? []).map((m) => m.toUpperCase()).filter(Boolean);

    if (allow && allow.length > 0) {
      machines = machines.filter((m) => allow.includes(m));
      if (machines.length === 0) continue;
    }

    if (machines.length === 0) {
      out.push({ ...log, reviewMachine: undefined, machines: [] });
      continue;
    }

    for (const machine of machines) {
      out.push({
        ...log,
        machine,
        reviewMachine: machine,
        machines: [machine],
      });
    }
  }

  // Dedupe: one card per plant-day + shift + machine.
  const byKey = new Map<string, ShiftLogRow>();
  for (const card of out) {
    const day = formatShiftDate(card.shiftDate);
    const machine = card.reviewMachine || card.machine || card.processLine;
    const key = `${day}|${card.shiftCode}|${machine}`;
    const prev = byKey.get(key);
    if (!prev || card.entryCount > prev.entryCount) byKey.set(key, card);
  }
  return [...byKey.values()];
}

function cardKey(log: ShiftLogRow): string {
  const machine = log.reviewMachine || log.machine;
  return machine ? `${log.id}:${machine}` : log.id;
}

function cardTitle(log: ShiftLogRow): string {
  const machine = log.reviewMachine || log.machine || log.millType;
  if (machine) return `${machine} · Shift ${log.shiftCode}`;
  return `${log.processLine} · Shift ${log.shiftCode}`;
}

export function PlantShiftReviewPage() {
  const [logs, setLogs] = useState<ShiftLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [reviewById, setReviewById] = useState<Record<string, ShiftReviewData>>({});
  const loadingMoreCompleted = useRef(false);
  const [reviewLoadingId, setReviewLoadingId] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);

  /** Empty date = all plant days (active + previous). Picker can narrow. */
  const [filterDate, setFilterDate] = useState('');
  const [filterShift, setFilterShift] = useState('');
  const [filterMachine, setFilterMachine] = useState('');
  const [filterStatus, setFilterStatus] = useState<StatusFilter>('ALL');
  const [currentShiftLabel, setCurrentShiftLabel] = useState<string | null>(null);
  const [activeProdDate, setActiveProdDate] = useState<string | null>(null);
  const [activeShiftCode, setActiveShiftCode] = useState<string | null>(null);
  /**
   * Default list = active shift + previous dates (no hard pin to one slot).
   * When false, MH/PH narrowed via the date/shift picker.
   */
  const [shiftPinnedToActive, setShiftPinnedToActive] = useState(true);

  const machineAccess = useOperationalMachineAccess();
  const role = useAuthStore((s) => s.role);
  const deskFocus = useMhDeskFocus((s) => s.focus);
  const annDesk = isAnnMhDesk(machineAccess, deskFocus);
  const pklDesk = isPklMhDesk(machineAccess, deskFocus);

  useEffect(() => {
    if (annDesk) setFilterMachine('ANN');
    if (pklDesk) setFilterMachine('PKL');
  }, [annDesk, pklDesk]);

  const resolveActiveShift = useCallback(() => {
    const machine = annDesk ? 'ANN' : pklDesk ? 'PKL' : machineAccess[0];
    void bootstrapShiftContext(machine)
      .then((shift) => {
        const prodDate = formatShiftDate(shift.prodDate);
        setActiveProdDate(prodDate);
        setActiveShiftCode(shift.shiftCode);
        setCurrentShiftLabel(`${prodDate} · Shift ${shift.shiftCode}`);
        // Keep the list open to previous dates; only reset pickers when returning to default.
        if (shiftPinnedToActive) {
          setFilterDate('');
          setFilterShift('');
        }
      })
      .catch(() => {
        setActiveProdDate(null);
        setActiveShiftCode(null);
        setCurrentShiftLabel(`${currentPlantDate()} · Shift detection unavailable`);
      });
  }, [annDesk, pklDesk, machineAccess, shiftPinnedToActive]);

  useEffect(() => {
    resolveActiveShift();
    const id = window.setInterval(resolveActiveShift, 60_000);
    return () => window.clearInterval(id);
  }, [resolveActiveShift]);

  const machineOptions = useMemo(() => {
    if (annDesk) return ['ANN'];
    if (pklDesk) return ['PKL'];
    if (role === 'MACHINE_HEAD') return machineAccess;
    const all = new Set<string>();
    for (const log of logs) {
      if (log.machine) all.add(log.machine);
      for (const m of log.machines ?? []) all.add(m);
      if (log.millType) all.add(log.millType);
    }
    return [...all].sort();
  }, [annDesk, pklDesk, logs, machineAccess, role]);

  const logsByDay = useMemo(() => {
    const map = new Map<string, ShiftLogRow[]>();
    const allowed = role === 'MACHINE_HEAD' ? machineAccess : undefined;
    // Default (no date pick): active day + previous dates within a recent window.
    const windowStart = activeProdDate && !filterDate
      ? (() => {
          const d = new Date(`${activeProdDate}T12:00:00`);
          d.setDate(d.getDate() - 14);
          return formatShiftDate(d);
        })()
      : null;

    for (const log of expandMachineCards(logs, allowed)) {
      if (filterMachine && log.reviewMachine !== filterMachine && !log.machines?.includes(filterMachine)) {
        continue;
      }
      const day = formatShiftDate(log.shiftDate);
      if (day === '—') continue;
      if (filterDate && day !== filterDate) continue;
      if (windowStart && day < windowStart) continue;
      const bucket = map.get(day) ?? [];
      bucket.push(log);
      map.set(day, bucket);
    }
    for (const [, dayLogs] of map) {
      dayLogs.sort(sortLogsForDay);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [logs, machineAccess, role, filterMachine, filterDate, activeProdDate]);

  const toggleReview = useCallback(async (log: ShiftLogRow) => {
    const key = cardKey(log);
    if (expandedId === key) {
      setExpandedId(null);
      return;
    }
    setExpandedId(key);
    setReviewError(null);
    if (reviewById[key]) return;
    setReviewLoadingId(key);
    try {
      const qs = new URLSearchParams({ limit: '40' });
      if (log.reviewMachine) qs.set('machine', log.reviewMachine);
      const data = await apiClient.get<ShiftReviewData>(`/shift-logs/${log.id}/review?${qs.toString()}`);
      setReviewById((prev) => ({ ...prev, [key]: data }));
    } catch (err: unknown) {
      setReviewError((err as Error)?.message ?? 'Failed to load shift summary');
    } finally {
      setReviewLoadingId(null);
    }
  }, [expandedId, reviewById]);

  const loadMoreCompletedOrders = useCallback(async (log: ShiftLogRow) => {
    const key = cardKey(log);
    const current = reviewById[key];
    const cursor = current?.completedOrdersNextCursor;
    if (!current || !cursor || loadingMoreCompleted.current) return;
    loadingMoreCompleted.current = true;
    try {
      const qs = new URLSearchParams({ limit: '40', cursor });
      if (log.reviewMachine) qs.set('machine', log.reviewMachine);
      const page = await apiClient.get<ShiftReviewData>(`/shift-logs/${log.id}/review?${qs.toString()}`);
      setReviewById((prev) => {
        const prevRow = prev[key];
        if (!prevRow) return prev;
        return {
          ...prev,
          [key]: {
            ...prevRow,
            completedOrders: [...prevRow.completedOrders, ...(page.completedOrders ?? [])],
            completedOrdersNextCursor: page.completedOrdersNextCursor ?? null,
          },
        };
      });
    } catch {
      /* soft — keep shown page */
    } finally {
      loadingMoreCompleted.current = false;
    }
  }, [reviewById]);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (filterDate) qs.set('shiftDate', filterDate);
      if (filterShift) qs.set('shiftCode', filterShift);

      const rows = await apiClient.get<ShiftLogRow[]>(`/shift-logs?${qs.toString()}`);

      let filtered = rows.filter((log) => VISIBLE_STATES.has(log.state));

      if (filterStatus === 'ACTIVE') {
        filtered = filtered.filter((log) => isActiveState(log.state));
      } else if (filterStatus === 'COMPLETED') {
        filtered = filtered.filter((log) => COMPLETED_STATES.has(log.state));
      }

      if (role === 'MACHINE_HEAD') {
        filtered = filtered.filter((log) => {
          const codes = [
            log.machine,
            log.millType,
            ...(log.machines ?? []),
          ]
            .filter(Boolean)
            .map((m) => String(m).toUpperCase());
          if (codes.length === 0) return false;
          return codes.some((m) => machineAccess.includes(m));
        });
      }

      if (filterMachine) {
        filtered = filtered.filter((log) => {
          const code = (log.machine || log.millType || '').toUpperCase();
          if (code === filterMachine) return true;
          return log.machines?.includes(filterMachine);
        });
      }

      setLogs(filtered);
      setError(null);
    } catch (err: unknown) {
      setError((err as Error)?.message ?? 'Failed to load shift logs');
    } finally {
      setLoading(false);
    }
  }, [machineAccess, role, filterDate, filterShift, filterMachine, filterStatus]);

  useEffect(() => {
    void load();
  }, [load]);

  const annLogs = useMemo(() => {
    if (!annDesk) return [];
    return logs.filter((log) => {
      const codes = [log.machine, log.millType, log.processLine, ...(log.machines ?? [])]
        .filter(Boolean)
        .map((m) => String(m).toUpperCase());
      return codes.includes('ANN') || log.processLine?.toUpperCase() === 'ANN';
    });
  }, [annDesk, logs]);

  const pklLogs = useMemo(() => {
    if (!pklDesk) return [];
    return logs.filter((log) => {
      const codes = [log.machine, log.millType, log.processLine, ...(log.machines ?? [])]
        .filter(Boolean)
        .map((m) => String(m).toUpperCase());
      return codes.includes('PKL') || log.processLine?.toUpperCase() === 'PKL';
    });
  }, [pklDesk, logs]);

  const [annSelectedLogId, setAnnSelectedLogId] = useState<string | null>(null);
  const [pklSelectedLogId, setPklSelectedLogId] = useState<string | null>(null);

  useEffect(() => {
    if (!annDesk) return;
    if (annSelectedLogId && annLogs.some((l) => l.id === annSelectedLogId)) return;
    const active = activeProdDate && activeShiftCode
      ? annLogs.find(
        (l) => formatShiftDate(l.shiftDate) === activeProdDate && l.shiftCode === activeShiftCode,
      )
      : null;
    setAnnSelectedLogId(active?.id ?? annLogs[0]?.id ?? null);
  }, [annDesk, annLogs, annSelectedLogId, activeProdDate, activeShiftCode]);

  useEffect(() => {
    if (!pklDesk) return;
    if (pklSelectedLogId && pklLogs.some((l) => l.id === pklSelectedLogId)) return;
    const active = activeProdDate && activeShiftCode
      ? pklLogs.find(
        (l) => formatShiftDate(l.shiftDate) === activeProdDate && l.shiftCode === activeShiftCode,
      )
      : null;
    setPklSelectedLogId(active?.id ?? pklLogs[0]?.id ?? null);
  }, [pklDesk, pklLogs, pklSelectedLogId, activeProdDate, activeShiftCode]);

  if (pklDesk) {
    return (
      <MachineHeadShell
        title="PKL Shift Review"
        subtitle={currentShiftLabel ? `Active: ${currentShiftLabel}` : 'Pickling shift review'}
        headerActions={<DataFreshnessBadge />}
      >
        <div className="flex flex-col gap-4 max-w-5xl">
          <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Shift log
            <select
              value={pklSelectedLogId ?? ''}
              onChange={(e) => setPklSelectedLogId(e.target.value || null)}
              className="mt-1 block w-full rounded-lg border border-border bg-white px-2 py-1.5 text-sm font-mono"
            >
              {pklLogs.length === 0 && <option value="">No PKL logs</option>}
              {pklLogs.map((l) => (
                <option key={l.id} value={l.id}>
                  {formatShiftDate(l.shiftDate)} · {l.shiftCode} · {l.state}
                </option>
              ))}
            </select>
          </label>
          {error && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <>
              <PklShiftReviewPanel shiftLogId={pklSelectedLogId} />
              {pklSelectedLogId && (
                <ShiftCompleteForm
                  shiftLogId={pklSelectedLogId}
                  onCompleted={() => void load()}
                />
              )}
            </>
          )}
        </div>
      </MachineHeadShell>
    );
  }

  if (annDesk) {
    return (
      <MachineHeadShell
        title="Shift Review"
        subtitle={
          currentShiftLabel
            ? `ANN — Active: ${currentShiftLabel}`
            : 'ANN process, stoppages, and production'
        }
        onRefresh={() => void load()}
        headerActions={<DataFreshnessBadge />}
      >
        <div className="flex flex-col gap-4 max-w-5xl">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-2xl border border-border bg-white p-4">
            <label className="text-xs font-medium text-muted-foreground">
              Date
              <input
                type="date"
                value={filterDate}
                onChange={(e) => {
                  setShiftPinnedToActive(false);
                  setFilterDate(e.target.value);
                }}
                className="mt-1 block w-full rounded-lg border border-border bg-white px-2 py-1.5 text-sm font-mono"
              />
            </label>
            <label className="text-xs font-medium text-muted-foreground">
              Shift
              <select
                value={filterShift}
                onChange={(e) => {
                  setShiftPinnedToActive(false);
                  setFilterShift(e.target.value);
                }}
                className="mt-1 block w-full rounded-lg border border-border bg-white px-2 py-1.5 text-sm"
              >
                <option value="">All shifts</option>
                {['A', 'B', 'C'].map((s) => (
                  <option key={s} value={s}>Shift {s}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-muted-foreground">
              Shift log
              <select
                value={annSelectedLogId ?? ''}
                onChange={(e) => setAnnSelectedLogId(e.target.value || null)}
                className="mt-1 block w-full rounded-lg border border-border bg-white px-2 py-1.5 text-sm font-mono"
              >
                {annLogs.length === 0 && <option value="">No ANN logs</option>}
                {annLogs.map((l) => (
                  <option key={l.id} value={l.id}>
                    {formatShiftDate(l.shiftDate)} · {l.shiftCode} · {l.state}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {!shiftPinnedToActive && (
            <ZButton
              variant="secondary"
              className="min-h-9 px-3 text-xs self-start"
              onClick={() => {
                setFilterDate('');
                setFilterShift('');
                setShiftPinnedToActive(true);
                resolveActiveShift();
              }}
            >
              Show active shift
            </ZButton>
          )}

          {error && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <AnnShiftReviewPanel shiftLogId={annSelectedLogId} />
          )}
        </div>
      </MachineHeadShell>
    );
  }

  return (
    <MachineHeadShell
      title="Shift Review"
      subtitle={
        currentShiftLabel
          ? `Active: ${currentShiftLabel} — also lists previous production days`
          : 'Active and previous-date shifts — open a row for production summary'
      }
      headerActions={<DataFreshnessBadge />}
    >
      <div className="flex flex-col gap-6 max-w-5xl">
        {currentShiftLabel && (
          <div className="rounded-xl border border-accent/30 bg-accent/5 px-4 py-3 text-sm text-foreground flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="font-semibold">Active shift:</span>{' '}
              <span className="font-mono">{currentShiftLabel}</span>
              {shiftPinnedToActive ? (
                <span className="ml-2 text-xs text-muted-foreground">
                  (showing active + previous dates · auto-updating)
                </span>
              ) : (
                <span className="ml-2 text-xs text-muted-foreground">(filtered view)</span>
              )}
            </div>
            {!shiftPinnedToActive && (
              <ZButton
                variant="secondary"
                className="min-h-9 px-3 text-xs"
                onClick={() => {
                  setFilterDate('');
                  setFilterShift('');
                  setShiftPinnedToActive(true);
                  resolveActiveShift();
                }}
              >
                Show active + previous
              </ZButton>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 rounded-2xl border border-border bg-white p-4">
          <label className="text-xs font-medium text-muted-foreground">
            Date
            <input
              type="date"
              value={filterDate}
              onChange={(e) => {
                setShiftPinnedToActive(false);
                setFilterDate(e.target.value);
              }}
              className="mt-1 block w-full rounded-lg border border-border bg-white px-2 py-1.5 text-sm font-mono"
            />
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            Shift
            <select
              value={filterShift}
              onChange={(e) => {
                setShiftPinnedToActive(false);
                setFilterShift(e.target.value);
              }}
              className="mt-1 block w-full rounded-lg border border-border bg-white px-2 py-1.5 text-sm"
            >
              <option value="">All shifts</option>
              {['A', 'B', 'C'].map((s) => (
                <option key={s} value={s}>Shift {s}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            Machine
            <select
              value={filterMachine}
              onChange={(e) => setFilterMachine(e.target.value)}
              disabled={annDesk}
              className="mt-1 block w-full rounded-lg border border-border bg-white px-2 py-1.5 text-sm disabled:opacity-70"
            >
              {!annDesk && <option value="">All machines</option>}
              {machineOptions.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            Status
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as StatusFilter)}
              className="mt-1 block w-full rounded-lg border border-border bg-white px-2 py-1.5 text-sm"
            >
              <option value="ALL">Active + completed</option>
              <option value="ACTIVE">Active only (DRAFT / REOPENED)</option>
              <option value="COMPLETED">Completed only</option>
            </select>
          </label>
        </div>

        {filterDate ? (
          <p className="text-xs text-muted-foreground -mt-3">
            Showing plant day <span className="font-mono font-semibold text-foreground">{filterDate}</span>
            {' · '}
            <button
              type="button"
              className="underline underline-offset-2 hover:text-foreground"
              onClick={() => {
                setFilterDate('');
                setShiftPinnedToActive(true);
              }}
            >
              Show active + previous dates
            </button>
          </p>
        ) : (
          <p className="text-xs text-muted-foreground -mt-3">
            Showing active shift and previous production days
            {activeProdDate ? (
              <>
                {' · '}active day{' '}
                <span className="font-mono font-semibold text-foreground">{activeProdDate}</span>
                {activeShiftCode ? ` · Shift ${activeShiftCode}` : ''}
                {' · '}last 14 days
              </>
            ) : null}
            . Pick a date above to narrow.
          </p>
        )}

        {error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center rounded-2xl border border-border bg-white px-6 py-12 text-sm text-muted-foreground">
            <div className="animate-spin mr-2 h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
            Loading shifts…
          </div>
        )}

        {!loading && logsByDay.length === 0 && (
          <div className="rounded-2xl border border-border bg-white px-6 py-12 flex flex-col items-center justify-center text-center">
            <ClipboardList className="h-8 w-8 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium text-foreground">No shifts found</p>
            <p className="text-sm text-muted-foreground mt-1">
              Try another date, or switch status to include active DRAFT logs.
              Closed shifts stay Active/DRAFT until a machine head marks them completed.
            </p>
          </div>
        )}

        <div className="space-y-6">
          {logsByDay.map(([day, dayLogs]) => {
            const activeCount = dayLogs.filter((l) => isActiveState(l.state)).length;
            const isActiveDay = !!activeProdDate && day === activeProdDate;
            return (
              <section key={day} className="space-y-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
                  <h3 className="text-sm font-bold text-foreground font-mono">
                    {day}
                    {isActiveDay ? (
                      <span className="ml-2 text-[10px] font-bold uppercase tracking-widest text-accent">
                        Active day
                      </span>
                    ) : null}
                  </h3>
                  <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
                    {activeCount > 0 ? `${activeCount} active · ` : ''}
                    {dayLogs.length} shift{dayLogs.length === 1 ? '' : 's'}
                  </p>
                </div>
                <ul className="space-y-3">
                  {dayLogs.map((log) => {
                    const key = cardKey(log);
                    const isClockActive =
                      !!activeProdDate
                      && !!activeShiftCode
                      && formatShiftDate(log.shiftDate) === activeProdDate
                      && log.shiftCode === activeShiftCode;
                    return (
                    <li
                      key={key}
                      className={`rounded-2xl border bg-white p-5 shadow-sm ${
                        isClockActive
                          ? 'border-accent ring-1 ring-accent/30'
                          : isActiveState(log.state)
                            ? 'border-amber-500/40'
                            : 'border-border'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => void toggleReview(log)}
                        className="w-full text-left"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="font-mono font-bold text-foreground flex items-center gap-1.5">
                              {expandedId === key
                                ? <ChevronDown className="w-4 h-4" />
                                : <ChevronRight className="w-4 h-4" />}
                              {cardTitle(log)}
                              {isClockActive ? (
                                <span className="text-[10px] font-bold uppercase tracking-widest text-accent">
                                  Now
                                </span>
                              ) : null}
                            </p>
                            <p className="text-sm text-muted-foreground mt-1">
                              {log.processLine}
                              {' · '}
                              {isActiveState(log.state)
                                ? `Open · ${log.submittedBy}`
                                : `Submitted by ${log.submittedBy}`}
                            </p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {formatShiftDate(log.shiftDate)}
                              {' · '}
                              {log.submittedAt ? formatPlantDateTime(log.submittedAt) : 'Not submitted yet'}
                              {' · '}{log.entryCount} entries
                              {log.overrideCount > 0 ? ` · ${log.overrideCount} overrides` : ''}
                            </p>
                          </div>
                          <StateBadge state={log.state} />
                        </div>
                      </button>

                      {expandedId === key && (
                        <div className="mt-3 rounded-xl border border-border bg-muted/10 p-4">
                          {reviewLoadingId === key ? (
                            <p className="text-sm text-muted-foreground">Loading shift summary…</p>
                          ) : reviewError ? (
                            <p className="text-sm text-destructive">{reviewError}</p>
                          ) : reviewById[key] ? (
                            <>
                              <ShiftReviewPanel
                                review={reviewById[key]}
                                onLoadMoreCompleted={() => { void loadMoreCompletedOrders(log); }}
                              />
                              {isActiveState(log.state) && (
                                <ShiftCompleteForm
                                  shiftLogId={log.id}
                                  review={reviewById[key]}
                                  onCompleted={() => {
                                    setExpandedId(null);
                                    setReviewById((prev) => {
                                      const next = { ...prev };
                                      delete next[key];
                                      return next;
                                    });
                                    void load();
                                  }}
                                />
                              )}
                            </>
                          ) : (
                            <p className="text-sm text-muted-foreground">No summary available.</p>
                          )}
                        </div>
                      )}
                    </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
    </MachineHeadShell>
  );
}
