import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ZButton } from '../../primitives/ZButton';
import { apiClient } from '../../../lib/apiClient';
import { useProcessWorkspaceBase } from '../../../hooks/useProcessWorkspaceBase';
import { useShiftStore } from '../../../store/shiftStore';
import type { BodyProps } from '../../../lib/processConfig';

interface ChargeRow {
  charge_no: string;
  base_no: string | null;
  furnace_id: number | null;
  grade_code: string | null;
  no_of_coils: number | null;
  charge_wt_mt: number | string | null;
  status: string;
}

export function AnnChargeBoard(_props: BodyProps) {
  const navigate = useNavigate();
  const { basePath } = useProcessWorkspaceBase();
  const { shiftLogId } = useShiftStore();
  const [charges, setCharges] = useState<ChargeRow[]>([]);
  const [chargeNo, setChargeNo] = useState('');

  useEffect(() => {
    void apiClient.get('/stations/ann/charges').then((data) => setCharges(data.charges ?? []));
  }, []);

  async function createCharge() {
    if (!chargeNo || !shiftLogId) return;
    await apiClient.post('/stations/ann/charges', {
      action: 'create',
      chargeNo,
      shiftLogId,
    });
    const data = await apiClient.get('/stations/ann/charges');
    setCharges(data.charges ?? []);
    setChargeNo('');
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex gap-2">
        <input
          className="border rounded-lg px-3 py-2 flex-1"
          placeholder="New charge no"
          value={chargeNo}
          onChange={(e) => setChargeNo(e.target.value)}
        />
        <ZButton type="button" onClick={createCharge}>Create Charge</ZButton>
      </div>

      <div className="grid gap-3">
        {charges.map((c) => (
          <button
            key={c.charge_no}
            type="button"
            className="text-left border rounded-xl p-4 hover:bg-secondary/40"
            onClick={() => navigate(`${basePath}/charge/${encodeURIComponent(c.charge_no)}`)}
          >
            <div className="flex justify-between">
              <span className="font-bold">{c.charge_no}</span>
              <span className="text-xs uppercase">{c.status}</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Base {c.base_no ?? '—'} · Furnace {c.furnace_id ?? '—'} · {c.no_of_coils ?? 0} coils · {Number(c.charge_wt_mt ?? 0).toFixed(2)} MT
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}
