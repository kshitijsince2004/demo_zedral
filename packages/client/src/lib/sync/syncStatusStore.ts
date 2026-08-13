import { create } from 'zustand';

interface SyncStatusState {
  isSyncing: boolean;
  pending: number;
  parked: number;
  lastSuccessAt: number | null;
  lastReason: string | null;
  pendingByAggregate: Record<string, number>;
  set: (patch: Partial<Omit<SyncStatusState, 'set'>>) => void;
}

export const useSyncStatus = create<SyncStatusState>((set) => ({
  isSyncing: false,
  pending: 0,
  parked: 0,
  lastSuccessAt: null,
  lastReason: null,
  pendingByAggregate: {},
  set: (patch) => set(patch),
}));
