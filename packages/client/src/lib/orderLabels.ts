/** User-facing order status and action labels (internal codes unchanged). */

export const HOLD_ACTION_LABEL = 'Hold';
export const ORDER_HOLD_STATUS_LABEL = 'Order Hold';

export function formatOrderStatusLabel(status: string): string {
  switch (status) {
    case 'REJECTED':
      return ORDER_HOLD_STATUS_LABEL;
    case 'IN_PROGRESS':
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
      return status.replace(/_/g, ' ');
  }
}

export function formatProcessFilterLabel(process: 'ALL' | 'ROLLING' | 'SKIN_PASS'): string {
  if (process === 'ROLLING') return 'Cold Rolling';
  if (process === 'SKIN_PASS') return 'Skin Pass';
  return 'All Processes';
}
