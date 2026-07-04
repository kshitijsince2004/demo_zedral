import { create } from 'zustand';

interface SyncStatusState {
  isSyncing: boolean;
  pending: number;
  parked: number;
  lastSuccessAt: number | null;
  lastReason: string | null;
  set: (patch: Partial<Omit<SyncStatusState, 'set'>>) => void;
}

export const useSyncStatus = create<SyncStatusState>((set) => ({
  isSyncing: false,
  pending: 0,
  parked: 0,
  lastSuccessAt: null,
  lastReason: null,
  set: (patch) => set(patch),
}));
