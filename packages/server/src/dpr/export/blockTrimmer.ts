import { Worksheet } from 'exceljs';
import { BLOCK_STRIDE } from '../geometry/blockGeometry';

export function trimTrailingBlocks(sheet: Worksheet, daysInMonth: number) {
  if (daysInMonth >= 31) return;
  // Stub: remove blocks from the bottom
  const startRow = 49 + (daysInMonth - 1) * BLOCK_STRIDE;
}
