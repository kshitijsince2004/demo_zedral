import { useEffect, useState } from 'react';
import { formatPlantTime, plantMinutesOfDay } from '@m1/shared-validation';
import { ZButton } from '../../primitives/ZButton';
import { ZInput } from '../../primitives/ZInput';
import { apiClient } from '../../../lib/apiClient';
import { useShiftStore } from '../../../store/shiftStore';

const CHART_INTERVALS = [0, 120, 240, 360]; // minutes from midnight — 1st/3rd/5th/7th hour blocks simplified

export function PklChartGrid() {
  const { shiftLogId } = useShiftStore();
  const [chartTime, setChartTime] = useState(formatPlantTime());
  const [duePrompt, setDuePrompt] = useState(false);
  const [tanks, setTanks] = useState([
    { tankNo: 1, tankTempDegc: '', acidStrengthPct: '' },
    { tankNo: 2, tankTempDegc: '', acidStrengthPct: '' },
    { tankNo: 3, tankTempDegc: '', acidStrengthPct: '' },
  ]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const mins = plantMinutesOfDay();
    const nearInterval = CHART_INTERVALS.some((i) => Math.abs(mins - i) < 15);
    setDuePrompt(nearInterval);
  }, []);

  async function saveChart() {
    if (!shiftLogId) return;
    setSaving(true);
    try {
      await apiClient.post('/stations/pkl/chart', {
        shiftLogId,
        chartTime,
        tanks: tanks.map((t) => ({
          tankNo: t.tankNo,
          tankTempDegc: t.tankTempDegc === '' ? undefined : Number(t.tankTempDegc),
          acidStrengthPct: t.acidStrengthPct === '' ? undefined : Number(t.acidStrengthPct),
        })),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4 space-y-4">
      {duePrompt && (
        <p className="text-sm bg-blue-50 border border-blue-200 text-blue-800 rounded-lg px-3 py-2">
          Process chart reading due — capture T1–T3 when ready (does not block coil capture).
        </p>
      )}

      <ZInput label="Chart Time (HH:mm)" value={chartTime} onChange={(e) => setChartTime(e.target.value)} />

      <div className="grid gap-3 md:grid-cols-3">
        {tanks.map((tank, i) => (
          <div key={tank.tankNo} className="border rounded-xl p-3 space-y-2">
            <p className="font-bold">Tank {tank.tankNo}</p>
            <ZInput label="Temp °C" value={tank.tankTempDegc} onChange={(e) => {
              setTanks(tanks.map((t, j) => j === i ? { ...t, tankTempDegc: e.target.value } : t));
            }} />
            <ZInput label="Acid %" value={tank.acidStrengthPct} onChange={(e) => {
              setTanks(tanks.map((t, j) => j === i ? { ...t, acidStrengthPct: e.target.value } : t));
            }} />
          </div>
        ))}
      </div>

      <ZButton type="button" onClick={() => void saveChart()} disabled={saving || !shiftLogId}>
        Save Chart Reading
      </ZButton>
    </div>
  );
}
