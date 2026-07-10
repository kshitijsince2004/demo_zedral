/**
 * Automatic boundary handovers are disabled by policy.
 * Operators submit outgoing handover manually; incoming operators accept.
 */
export class ShiftBoundaryScheduler {
  static start(): void {
    console.log('[ShiftBoundaryScheduler] Automatic boundary handovers are disabled per system policy.');
  }

  static stop(): void {
    // no-op — scheduler never arms a timer
  }
}
