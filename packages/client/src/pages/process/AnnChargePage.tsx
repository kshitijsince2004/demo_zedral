import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ZButton } from '../../components/primitives/ZButton';
import { ZInput } from '../../components/primitives/ZInput';
import { apiClient } from '../../lib/apiClient';
import { useProcessWorkspaceBase } from '../../hooks/useProcessWorkspaceBase';
import { useProcessStore, type ProcessQueueCard } from '../../store/processStore';

export function AnnChargePage() {
  const { chargeNo = '' } = useParams();
  const navigate = useNavigate();
  const { basePath } = useProcessWorkspaceBase();
  const { queue, loadQueue } = useProcessStore();
  const [detail, setDetail] = useState<{ charge: Record<string, unknown>; roster: Array<Record<string, unknown>> } | null>(null);
  const [coilToAdd, setCoilToAdd] = useState('');
  const [furnaceId, setFurnaceId] = useState<number | ''>('');
  const [temperature, setTemperature] = useState<number | ''>('');

  useEffect(() => {
    void loadQueue();
    void apiClient.get(`/stations/ann/charges/${encodeURIComponent(chargeNo)}`).then(setDetail);
  }, [chargeNo, loadQueue]);

  async function rosterCoil(coilNo: string) {
    await apiClient.post('/stations/ann/charges', { action: 'roster', chargeNo, coilNo });
    const d = await apiClient.get(`/stations/ann/charges/${encodeURIComponent(chargeNo)}`);
    setDetail(d);
  }

  async function transition(status: 'IN_PROCESS' | 'FOR_ANN' | 'RW' | 'DONE') {
    await apiClient.post('/stations/ann/charges', {
      action: 'transition',
      chargeNo,
      status,
      furnaceId: furnaceId === '' ? undefined : Number(furnaceId),
      temperatureDegc: temperature === '' ? undefined : Number(temperature),
    });
    const d = await apiClient.get(`/stations/ann/charges/${encodeURIComponent(chargeNo)}`);
    setDetail(d);
    if (status === 'DONE') navigate(basePath);
  }

  const pendingCoils = queue.filter((c: ProcessQueueCard) => c.status === 'PENDING');

  return (
    <div className="p-4 space-y-4 overflow-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Charge {chargeNo}</h1>
        <ZButton type="button" variant="secondary" onClick={() => navigate(basePath)}>Back</ZButton>
      </div>

      {detail && (
        <>
          <p className="text-sm">Status: <strong>{String(detail.charge.status)}</strong></p>
          <div className="grid grid-cols-2 gap-3 max-w-md">
            <ZInput label="Furnace ID" type="number" value={furnaceId} onChange={(e) => setFurnaceId(e.target.value === '' ? '' : Number(e.target.value))} />
            <ZInput label="Temperature °C" type="number" value={temperature} onChange={(e) => setTemperature(e.target.value === '' ? '' : Number(e.target.value))} />
          </div>

          <div className="flex flex-wrap gap-2">
            {(['FOR_ANN', 'RW', 'DONE'] as const).map((s) => (
              <ZButton key={s} type="button" onClick={() => void transition(s)}>{s.replace('_', ' ')}</ZButton>
            ))}
          </div>

          <section>
            <h2 className="font-semibold mb-2">Roster</h2>
            <ul className="space-y-1">
              {detail.roster.map((r) => (
                <li key={String(r.coil_no)} className="text-sm border rounded px-3 py-2">{String(r.coil_no)} · {String(r.grade_code ?? '')}</li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="font-semibold mb-2">Add from queue</h2>
            <div className="flex gap-2">
              <select className="border rounded-lg px-3 flex-1" value={coilToAdd} onChange={(e) => setCoilToAdd(e.target.value)}>
                <option value="">Select coil…</option>
                {pendingCoils.map((c) => (
                  <option key={c.coilNo} value={c.coilNo}>{c.coilNo}</option>
                ))}
              </select>
              <ZButton type="button" onClick={() => coilToAdd && void rosterCoil(coilToAdd)}>Add</ZButton>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
