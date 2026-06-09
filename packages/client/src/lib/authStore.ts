import { create } from 'zustand';
import type { UserRole } from '@m1/shared-validation';
import { useShiftStore } from '../store/shiftStore';
import { useSixHiStore } from '../store/sixHiStore';
import { getEffectiveMachineAccess } from './machineRouting';
import { isCrmMillCode } from './millConfig';

function resetSessionStores() {
  useShiftStore.getState().resetSession();
  useSixHiStore.getState().resetSession();
}

/**
 * Canonical role model from M1-05 / Requirement 14.1.
 * (Replaces the earlier invented "MANAGER" role.)
 */
export type Role = UserRole;

/**
 * authStore is the SINGLE SOURCE OF SESSION TRUTH for the client
 * (Requirement 8.4). It owns the auth token, the user's role, the
 * user's line-access scope, and the screen-lock state. No other store
 * may hold session/authentication state — the former `store/sessionStore.ts`
 * duplicate has been removed.
 *
 * Consumers read role + lineAccess from here (sidebar scoping, route
 * guards, line-scoped capture) rather than from any hardcoded session data.
 */
interface AuthState {
  token: string | null;
  username: string | null;
  role: Role | null;
  /** Process lines this user may access (M1-05 line-scoping). */
  lineAccess: string[];
  /** Machines assigned to this user. */
  machineAccess: string[];
  /** Currently selected machine inside /username.role workspace. */
  activeMachine: string | null;
  isLocked: boolean;
  login: (
    token: string,
    role: Role,
    lineAccess?: string[],
    refreshToken?: string,
    machineAccess?: string[],
    username?: string,
  ) => void;
  setActiveMachine: (machineCode: string) => void;
  logout: () => void;
  lockScreen: () => void;
  unlockScreen: (pin: string) => boolean;
  hasRole: (...roles: Role[]) => boolean;
  hasLineAccess: (processId: string) => boolean;
}

function loadLineAccess(): string[] {
  try {
    const raw = sessionStorage.getItem('mock_line_access');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function loadMachineAccess(): string[] {
  try {
    const raw = sessionStorage.getItem('mock_machine_access');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function loadActiveMachine(): string | null {
  return sessionStorage.getItem('mock_active_machine');
}

function pickDefaultMachine(role: Role | null, machineAccess: string[]): string | null {
  const machines = getEffectiveMachineAccess(role, machineAccess);
  return machines[0] ?? null;
}

// In a real app, this would be a secure JWT parser, but we mock it here.
export const useAuthStore = create<AuthState>((set, get) => ({
  token: sessionStorage.getItem('mock_jwt'),
  username: sessionStorage.getItem('mock_username'),
  role: (sessionStorage.getItem('mock_role') as Role) || null,
  lineAccess: loadLineAccess(),
  machineAccess: loadMachineAccess(),
  activeMachine: loadActiveMachine(),
  isLocked: false,

  login: (token, role, lineAccess = [], refreshToken, machineAccess = [], username) => {
    resetSessionStores();
    const activeMachine = pickDefaultMachine(role, machineAccess);
    sessionStorage.setItem('mock_jwt', token);
    sessionStorage.setItem('mock_role', role);
    sessionStorage.setItem('mock_line_access', JSON.stringify(lineAccess));
    sessionStorage.setItem('mock_machine_access', JSON.stringify(machineAccess));
    if (username) sessionStorage.setItem('mock_username', username);
    else sessionStorage.removeItem('mock_username');
    if (activeMachine) sessionStorage.setItem('mock_active_machine', activeMachine);
    else sessionStorage.removeItem('mock_active_machine');
    if (refreshToken) sessionStorage.setItem('mock_refresh', refreshToken);
    set({ token, username: username ?? null, role, lineAccess, machineAccess, activeMachine, isLocked: false });

    startInactivityTimer(get().lockScreen);
  },

  setActiveMachine: (machineCode) => {
    sessionStorage.setItem('mock_active_machine', machineCode);
    set({ activeMachine: machineCode });
    if (isCrmMillCode(machineCode)) {
      useSixHiStore.getState().setMachineCode(machineCode);
    }
  },

  logout: () => {
    sessionStorage.removeItem('mock_jwt');
    sessionStorage.removeItem('mock_refresh');
    sessionStorage.removeItem('mock_role');
    sessionStorage.removeItem('mock_username');
    sessionStorage.removeItem('mock_line_access');
    sessionStorage.removeItem('mock_machine_access');
    sessionStorage.removeItem('mock_active_machine');
    resetSessionStores();
    set({
      token: null,
      username: null,
      role: null,
      lineAccess: [],
      machineAccess: [],
      activeMachine: null,
      isLocked: false,
    });
    stopInactivityTimer();
  },

  lockScreen: () => {
    set({ isLocked: true });
  },

  unlockScreen: (pin) => {
    if (pin === '1234') {
      set({ isLocked: false });
      resetInactivityTimer();
      return true;
    }
    return false;
  },

  hasRole: (...roles) => {
    const { role } = get();
    if (!role) return false;
    if (role === 'ADMIN') return true;
    return roles.includes(role);
  },

  hasLineAccess: (processId) => {
    const { role, lineAccess } = get();
    if (role === 'ADMIN' || role === 'PLANT_HEAD') return true;
    if (role === 'SUPERVISOR') return true;
    if (lineAccess.length === 0) return false;
    return lineAccess.some((code) => code.toUpperCase() === processId.toUpperCase());
  },
}));

// --- Inactivity Logic (15 min lock) ---
let timeoutId: ReturnType<typeof setTimeout> | undefined;
const INACTIVITY_TIMEOUT = 15 * 60 * 1000;

function startInactivityTimer(lockCallback: () => void) {
  stopInactivityTimer();

  const reset = () => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      lockCallback();
    }, INACTIVITY_TIMEOUT);
  };

  window.addEventListener('mousemove', reset);
  window.addEventListener('keydown', reset);
  window.addEventListener('touchstart', reset);

  reset();
}

function stopInactivityTimer() {
  clearTimeout(timeoutId);
}

function resetInactivityTimer() {
  if (timeoutId) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      useAuthStore.getState().lockScreen();
    }, INACTIVITY_TIMEOUT);
  }
}
