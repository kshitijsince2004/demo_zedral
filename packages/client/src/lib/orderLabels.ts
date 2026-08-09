/** User-facing order status and action labels (internal codes unchanged). */

export const HOLD_ACTION_LABEL = 'Hold';
export const ORDER_HOLD_STATUS_LABEL = 'Order Hold';

export function formatOrderStatusLabel(status: string): string {
  switch ((status ?? '').toUpperCase()) {
    case 'REJECTED':
    case 'HOLD':
      return ORDER_HOLD_STATUS_LABEL;
    case 'IN_PROGRESS':
    case 'RUNNING':
      return 'In Progress';
    case 'STOPPAGE':
      return 'Stoppage';
    case 'PREPARING':
      return 'Preparing';
    case 'COMPLETED':
      return 'Completed';
    case 'PENDING':
      return 'Pending';
    default:
      return (status ?? '').replace(/_/g, ' ') || '—';
  }
}

export function formatProcessFilterLabel(
  process: 'ALL' | 'ROLLING' | 'SKIN_PASS' | 'MANUAL_REROLL',
): string {
  if (process === 'ROLLING') return 'Rolling';
  if (process === 'SKIN_PASS') return 'Skin Pass';
  if (process === 'MANUAL_REROLL') return 'Manual Re-Rolling';
  return 'All Processes';
}

/** MH live tile / Orders column — process currently running on CRM mills. */
export function formatActiveProcessType(
  type?: 'ROLLING' | 'SKIN_PASS' | 'MANUAL_REROLL' | 'REWINDING' | string | null,
): string | undefined {
  if (!type) return undefined;
  switch (type) {
    case 'ROLLING':
      return 'Rolling';
    case 'SKIN_PASS':
      return 'Skin Pass';
    case 'MANUAL_REROLL':
      return 'Re-Rolling';
    case 'REWINDING':
    case 'RWD':
      return 'Rewinding';
    default:
      return undefined;
  }
}

/** Orders table Process cell for CRM MH queue rows. */
export function formatOrderProcessLabel(
  subProcess?: string | null,
  fallback?: string | null,
): string {
  return formatActiveProcessType(subProcess) ?? fallback ?? '—';
}
