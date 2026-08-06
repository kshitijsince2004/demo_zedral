/** HRS/CRS fan-out identity. Must exist in coil.coil before prod_*_slit FK insert. */
export function derivedChildCoilNo(motherCoilNo: string, slot: string): string {
  return `${motherCoilNo}-${slot.trim().toUpperCase()}`;
}
