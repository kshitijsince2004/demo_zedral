import { useEffect, useState } from 'react';

import { useNavigate } from 'react-router-dom';
import { useWorkspaceBase } from '../../hooks/useWorkspaceBase';
import { useSixHiStore } from '../../store/sixHiStore';

import type { SixHiShiftSummary } from '@m1/shared-validation';

import { apiClient } from '../../lib/apiClient';

import { useShiftStore } from '../../store/shiftStore';

import { ZButton } from '../../components/primitives/ZButton';

import { ZInput } from '../../components/primitives/ZInput';

import { FieldWrapper } from '../../components/forms/FieldWrapper';

import { CrewSubForm } from '../../components/forms/CrewSubForm';



export function SixHiShiftSummaryPage() {

  const navigate = useNavigate();
  const machineCode = useSixHiStore((s) => s.machineCode);
  const { basePath: millHome } = useWorkspaceBase();

  const { shiftLogId } = useShiftStore();

  const [summary, setSummary] = useState<SixHiShiftSummary | null>(null);

  const [scrapKg, setScrapKg] = useState('');

  const [coolantTemp, setCoolantTemp] = useState('');

  const [coolantPress, setCoolantPress] = useState('');

  const [busy, setBusy] = useState(false);



  const currentShiftLogId = shiftLogId ?? '';



  useEffect(() => {

    if (!currentShiftLogId) return;

    apiClient.get(`/6hi/shift-summary/${currentShiftLogId}`)

      .then((s: SixHiShiftSummary) => {

        setSummary(s);

        if (s.scrapKg) setScrapKg(String(s.scrapKg));

        if (s.coolantTempDegC) setCoolantTemp(String(s.coolantTempDegC));

        if (s.coolantPressKgCm2) setCoolantPress(String(s.coolantPressKgCm2));

      })

      .catch(console.error);

  }, [currentShiftLogId]);



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

    <div className="flex flex-col flex-1 p-4 md:p-6 gap-4 max-w-2xl mx-auto w-full pb-8 overflow-auto">

        <h1 className="text-xl font-bold text-foreground">Shift Summary — {machineCode}</h1>

        <p className="text-sm text-muted-foreground">
          Submit after idle shift close or when completing manual entries. Handover transfers responsibility separately.
        </p>

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

