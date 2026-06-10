import { Cell } from 'exceljs';

export enum CellClass {
  Formula_Cell = 'Formula_Cell',
  Daily_Input_Cell = 'Daily_Input_Cell',
  Config_Cell = 'Config_Cell',
  Static_Cell = 'Static_Cell'
}

export function classifyCell(cell: Cell): CellClass {
  if (cell.type === 2 || cell.formula) return CellClass.Formula_Cell;

  // Simple MVP classification
  // Assume if it's not a formula and it's a number, it might be input or config
  // We'll zero it out if it is an input cell. For MVP, we treat most empty or numeric as input.
  return CellClass.Daily_Input_Cell;
}
