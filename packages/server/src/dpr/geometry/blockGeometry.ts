export const BLOCK_STRIDE = 46;

export function titleRow(N: number): number {
  if (N === 1) return 2;
  return 49 + (N - 2) * BLOCK_STRIDE;
}

export function machineRow(N: number, offset: number): number {
  // offset is typically 0 to 25 for the 26 machine rows (4 to 29 relative to title)
  return titleRow(N) + 4 + offset;
}

export function delayBlockIndex(N: number, shiftIndex: number): number {
  // N is 1 to 31, shiftIndex is 0 to 2
  return (N - 1) * 3 + shiftIndex;
}
