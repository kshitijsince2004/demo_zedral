import { useEffect, useState } from 'react';
import { useAuthStore } from './authStore';
import { fetchMachineRegistry } from './machineRegistry';
import { apiClient } from './apiClient';
import { isPlantWideDeskRole, useEffectiveSessionRole } from './sessionRole';

const DB_SCOPED_ROLES = new Set(['MACHINE_HEAD', 'OPERATOR']);

/**
 * Assigned machines that are currently operational (not OFFLINE).
 * Machine heads/operators load live assignments from /machine-access/me
 * so the UI never falls back to showing the full plant machine list.
 * Plant-wide desk roles (PH / Admin / Supervisor) use JWT/registry scope —
 * they must not hit /machine-access/me as an MH-only endpoint race.
 */
export function useOperationalMachineAccess(): string[] {
  const machineAccess = useAuthStore((s) => s.machineAccess);
  const { role } = useEffectiveSessionRole();
  const [codes, setCodes] = useState<string[]>(machineAccess);

  useEffect(() => {
    let cancelled = false;

    const applyOperationalFilter = (assigned: string[]) => {
      void fetchMachineRegistry()
        .then((machines) => {
          if (cancelled) return;
          const operational = new Set(machines.map((m) => m.machineCode));
          // Plant-wide roles: all operational machines (JWT may already list them).
          if (isPlantWideDeskRole(role)) {
            setCodes(machines.map((m) => m.machineCode));
            return;
          }
          setCodes(assigned.filter((code) => operational.has(code)));
        })
        .catch(() => {
          if (!cancelled) setCodes(assigned);
        });
    };

    if (role && DB_SCOPED_ROLES.has(role)) {
      void apiClient
        .get<{ machines: string[] }>('/machine-access/me')
        .then((res) => {
          if (cancelled) return;
          applyOperationalFilter(res.machines ?? []);
        })
        .catch(() => {
          if (!cancelled) applyOperationalFilter(machineAccess);
        });
      return () => {
        cancelled = true;
      };
    }

    applyOperationalFilter(machineAccess);
    return () => {
      cancelled = true;
    };
  }, [machineAccess, role]);

  return codes;
}