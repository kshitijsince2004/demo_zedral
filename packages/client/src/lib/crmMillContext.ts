/** Avoids circular imports between apiClient ↔ sixHiStore/authStore. */
let activeCrmMill: string | null = null;

export function setActiveCrmMill(machine: string | null): void {
  activeCrmMill = machine ? machine.toUpperCase() : null;
}

export function getActiveCrmMill(): string | null {
  return activeCrmMill;
}
