import { useEffect, useMemo, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { MachineComingSoon } from '../MachineComingSoon';
import { apiClient, ApiError } from '../../lib/apiClient';
import { useAuthStore } from '../../lib/authStore';
import { bootstrapShiftContext } from '../../lib/shiftDetection';
import { useShiftStore, type ProcessLine } from '../../store/shiftStore';
import { formatShiftDate } from '../../lib/dateFormat';
import {
  CtlCaptureForm,
  RwdCaptureForm,
} from './ProcessForms';

interface ActiveShiftResponse {
  shiftLogId: string;
  shiftDate: string;
  shiftCode: 'A' | 'B' | 'C';
  targetMt: number;
  producedMt: number;
}

/** HRS / CRS / PKL / ANN use process hub — not GenericCapture. */
const supportedMachines = ['SKP', 'RWD', 'CTL'] as const;
type SupportedMachine = (typeof supportedMachines)[number];

function isSupportedMachine(value: string): value is SupportedMachine {
  return supportedMachines.includes(value as SupportedMachine);
}

function formFor(machineCode: SupportedMachine, shiftLogId: string) {
  const props = { machineCode, shiftLogId };
  if (machineCode === 'RWD') return <RwdCaptureForm {...props} />;
  return <CtlCaptureForm {...props} />;
}

export function GenericCapturePage() {
  const { machineCode: rawMachineCode } = useParams<{ machineCode: string }>();
  const machineCode = (rawMachineCode ?? '').toUpperCase();
  const { role, machineAccess, activeMachine, setActiveMachine } = useAuthStore();
  const shiftLogId = useShiftStore((state) => state.shiftLogId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const hasMachineAccess = useMemo(() => {
    if (role === 'ADMIN' || role === 'PLANT_HEAD') return true;
    return machineAccess.includes(machineCode);
  }, [machineAccess, machineCode, role]);
  const canLoadCapture = Boolean(machineCode && isSupportedMachine(machineCode) && hasMachineAccess);

  useEffect(() => {
    if (!canLoadCapture) return;

    if (activeMachine !== machineCode) {
      setActiveMachine(machineCode);
    }

    async function loadActiveShift() {
      setLoading(true);
      setError(null);
      try {
        const detected = await bootstrapShiftContext(machineCode);
        const qs = `?date=${encodeURIComponent(formatShiftDate(detected.prodDate))}&shift=${encodeURIComponent(detected.shiftCode)}`;
        const active = await apiClient.get<ActiveShiftResponse>(`/shift-logs/active/${machineCode}${qs}`);
        useShiftStore.setState({
          shiftLogId: active.shiftLogId,
          shiftDate: formatShiftDate(active.shiftDate),
          shiftCode: active.shiftCode,
          targetMt: active.targetMt,
          producedMt: active.producedMt,
          processLine: machineCode as ProcessLine,
        });
      } catch (loadError) {
        const message = loadError instanceof ApiError && loadError.status === 404
          ? `No active ${machineCode} shift log is open for the current shift.`
          : loadError instanceof Error
            ? loadError.message
            : 'Failed to load active shift context';
        setError(message);
      } finally {
        setLoading(false);
      }
    }

    void loadActiveShift();
  }, [activeMachine, canLoadCapture, machineCode, setActiveMachine]);

  if (!rawMachineCode) {
    return <Navigate to="/" replace />;
  }

  // Plan — HRS/CRS/PKL/ANN capture lives on the process hub.
  if (machineCode === 'CRS' || machineCode === 'HRS' || machineCode === 'PKL' || machineCode === 'ANN') {
    return <Navigate to="/" replace />;
  }

  if (!canLoadCapture) {
    return <MachineComingSoon machineCode={machineCode || rawMachineCode} />;
  }

  return (
    <div className="min-h-screen bg-secondary p-4 md:p-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        {loading && (
          <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
            Loading active shift context...
          </div>
        )}

        {!loading && error && (
          <div className="rounded-xl border border-destructive/30 bg-card p-6">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {machineCode} Capture
            </p>
            <h1 className="mt-1 text-xl font-semibold text-foreground">Shift Context Required</h1>
            <p className="mt-2 text-sm text-destructive">{error}</p>
          </div>
        )}

        {!loading && !error && shiftLogId && formFor(machineCode, shiftLogId)}
      </div>
    </div>
  );
}
