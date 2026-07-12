import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import { useWorkspaceBase } from '../../hooks/useWorkspaceBase';
import { useSixHiStore } from '../../store/sixHiStore';
import type { SixHiQueueCard, SixHiShiftSummary } from '@m1/shared-validation';
import { apiClient } from '../../lib/apiClient';
import { useShiftStore } from '../../store/shiftStore';
import { formatShiftDate } from '../../lib/dateFormat';
import { ZButton } from '../../components/primitives/ZButton';
import { ZInput } from '../../components/primitives/ZInput';
import { FieldWrapper } from '../../components/forms/FieldWrapper';
import { CrewSubForm } from '../../components/forms/CrewSubForm';
import { SixHiStatusPill } from '../../components/sixHi/SixHiStatusPill';
import { displayMotherCoilId, selectIdOf } from '../../lib/sixHiOrderIdentity';

export function SixHiShiftSummaryPage() {
  const navigate = useNavigate();
  const machineCode = useSixHiStore((s) => s.machineCode);
  const { basePath: millHome } = useWorkspaceBase();
  const { shiftLogId, shiftDate, shiftCode } = useShiftStore();

  const [summary, setSummary] = useState<SixHiShiftSummary | null>(null);
  const [scrapKg, setScrapKg] = useState('');
  const [coolantTemp, setCoolantTemp] = useState('');
  const [coolantPress, setCoolantPress] = useState('');
  const [busy, setBusy] = useState(false);

  const currentShiftLogId = shiftLogId ?? '';
  const queueDate = formatShiftDate(shiftDate);
  const queueShift = shiftCode || 'A';

  const { data: queueItems = [] } = useSWR(
    machineCode ? ['shift-summary-queue', machineCode, queueDate, queueShift] : null,
    async () => {
      const params = `machine=${machineCode}&date=${queueDate}&shift=${queueShift}`;
      const [rolling, skinPass] = await Promise.all([
        apiClient.get(`/6hi/queue?${params}&subProcess=ROLLING`),
        apiClient.get(`/6hi/queue?${params}&subProcess=SKIN_PASS`),
      ]);
      const merged: SixHiQueueCard[] = [
        ...(rolling.queue ?? []),
        ...(skinPass.queue ?? []),
      ].sort((a, b) => a.queuePosition - b.queuePosition);
      return merged.filter((q) => q.status === 'PENDING' || q.status === 'PREPARING');
    },
  );

  useEffect(() => {
    if (!currentShiftLogId) return;
    const qs = machineCode ? `?machine=${encodeURIComponent(machineCode)}` : '';
    apiClient.get(`/6hi/shift-summary/${currentShiftLogId}${qs}`)
      .then((s: SixHiShiftSummary) => {
        setSummary(s);
        if (s.scrapKg) setScrapKg(String(s.scrapKg));
        if (s.coolantTempDegC) setCoolantTemp(String(s.coolantTempDegC));
        if (s.coolantPressKgCm2) setCoolantPress(String(s.coolantPressKgCm2));
      })
      .catch(console.error);
  }, [currentShiftLogId, machineCode]);

  const handleSubmit = async () => {
    if (!currentShiftLogId) return;
    setBusy(true);
    try {
      const result = await apiClient.post(`/6hi/shift-summary/${currentShiftLogId}`, {
        scrapKg: scrapKg ? Number(scrapKg) : undefined,
        coolantTempDegC: coolantTemp ? Number(coolantTemp) : undefined,
        coolantPressKgCm2: coolantPress ? Number(coolantPress) : undefined,
      });
      setSummary(result);
      navigate(millHome);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col flex-1 p-4 md:p-6 gap-4 max-w-3xl mx-auto w-full pb-8 overflow-auto">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">Shift Summary — {machineCode}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Submit after idle shift close or when completing manual entries. Handover transfers responsibility separately.
          </p>
        </div>
        <div className="shrink-0 rounded-full border border-border bg-secondary px-4 py-2 text-sm font-bold whitespace-nowrap">
          {queueItems.length} upcoming order{queueItems.length === 1 ? '' : 's'}
        </div>
      </div>

      <div className="bg-white border border-border rounded-2xl p-4">
        <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">
          Upcoming Production Queue
        </h2>
        {queueItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">No pending or preparing orders in queue.</p>
        ) : (
          <ul className="space-y-2 max-h-56 overflow-auto">
            {queueItems.map((order) => (
              <li key={order.batchNumber} className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2">
                <div className="min-w-0">
                  <p className="font-mono text-sm font-bold truncate">{displayMotherCoilId(order)}</p>
                  <p className="text-[10px] text-muted-foreground">
                    Slit ID {selectIdOf(order)} · Pos {order.queuePosition}
                  </p>
                </div>
                <SixHiStatusPill status={order.status} prepReady={order.prepReady} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {summary && (
        <>
          {(summary.totalStoppageMinutes != null || summary.machineUtilizationPct != null) && (
            <div className="bg-white border border-border rounded-2xl p-4 space-y-2">
              <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Shift metrics</h2>
              <div className="grid grid-cols-2 gap-2 text-sm">
                {summary.totalStoppageMinutes != null && (
                  <div>Stoppage: <strong className="font-mono">{summary.totalStoppageMinutes} min</strong></div>
                )}
                {summary.totalBreakdownMinutes != null && (
                  <div>Breakdown: <strong className="font-mono">{summary.totalBreakdownMinutes} min</strong></div>
                )}
                {summary.machineUtilizationPct != null && (
                  <div>Runtime utilization: <strong className="font-mono">{summary.machineUtilizationPct}%</strong></div>
                )}
              </div>
            </div>
          )}

          {summary.ordersInProgress && summary.ordersInProgress.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
              <h2 className="text-[10px] font-bold uppercase tracking-widest text-amber-800 mb-2">In progress (continues next shift)</h2>
              <ul className="space-y-1 text-sm">
                {summary.ordersInProgress.map((o) => (
                  <li key={o.batchNumber} className="flex justify-between font-mono text-xs">
                    <span>{o.batchNumber}</span>
                    <span>{o.status} · {o.machineCode}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="bg-white border border-border rounded-2xl p-4 space-y-2">
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">From Completed Orders</h2>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>Total Production: <strong className="font-mono">{summary.totalProdMt.toFixed(1)} MT</strong></div>
              <div>Rolling: <strong className="font-mono">{summary.totalRollingMt.toFixed(1)} MT</strong></div>
              <div>Re-Rolling: <strong className="font-mono">{summary.totalRerollMt.toFixed(1)} MT</strong></div>
              <div>Skin Pass: <strong className="font-mono">{summary.totalSkinpassMt.toFixed(1)} MT</strong></div>
            </div>
          </div>

          {summary.completedOrders && summary.completedOrders.length > 0 && (
            <div className="bg-white border border-border rounded-2xl p-4 max-h-48 overflow-auto">
              <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Orders</h2>
              <ul className="space-y-1 text-sm">
                {summary.completedOrders.map((o) => (
                  <li key={o.batchNumber} className="flex justify-between font-mono text-xs">
                    <span>{o.batchNumber}</span>
                    <span>{o.weightMt.toFixed(1)} MT · {o.durationMin ?? 0} min</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <div className="bg-white border border-border rounded-2xl p-4 space-y-3">
        <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Manual Entry</h2>
        <FieldWrapper label="Scrap (Kg)">
          <ZInput type="number" value={scrapKg} onChange={(e) => setScrapKg(e.target.value)} className="min-h-14" />
        </FieldWrapper>
        <FieldWrapper label="Coolant Temp (°C)">
          <ZInput type="number" value={coolantTemp} onChange={(e) => setCoolantTemp(e.target.value)} className="min-h-14" />
        </FieldWrapper>
        <FieldWrapper label="Coolant Pressure (kg/cm²)">
          <ZInput type="number" value={coolantPress} onChange={(e) => setCoolantPress(e.target.value)} className="min-h-14" />
        </FieldWrapper>
      </div>

      {currentShiftLogId && (
        <div className="bg-white border border-border rounded-2xl p-4">
          <h2 className="text-sm font-semibold mb-3">Crew</h2>
          <CrewSubForm shiftLogId={currentShiftLogId} />
        </div>
      )}

      <div className="flex gap-2">
        <ZButton variant="ghost" onClick={() => navigate(millHome)}>Back</ZButton>
        <ZButton variant="accent" size="lg" fullWidth onClick={handleSubmit} disabled={busy || !currentShiftLogId} className="min-h-14">
          Submit Shift
        </ZButton>
      </div>
    </div>
  );
}
