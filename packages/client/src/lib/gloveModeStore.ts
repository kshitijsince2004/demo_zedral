import { create } from 'zustand';

/**
 * Glove-mode store (Requirement 10.2).
 *
 * When glove mode is active, capture-form controls use larger hit areas and
 * increased spacing so the UI is usable with heavy work gloves.
 *
 * The preference is persisted to localStorage so it survives page reloads.
 */
interface GloveModeState {
  isGloveMode: boolean;
  toggle: () => void;
  setGloveMode: (value: boolean) => void;
}

const STORAGE_KEY = 'zedral_glove_mode';

function loadGloveMode(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export const useGloveModeStore = create<GloveModeState>((set) => ({
  isGloveMode: loadGloveMode(),

  toggle: () =>
    set((state) => {
      const next = !state.isGloveMode;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        /* ignore storage errors */
      }
      return { isGloveMode: next };
    }),

  setGloveMode: (value) => {
    try {
      localStorage.setItem(STORAGE_KEY, String(value));
    } catch {
      /* ignore storage errors */
    }
    set({ isGloveMode: value });
  },
}));
