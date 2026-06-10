export function getIntraSheetFormulas(row: number) {
  return {
    F: `C${row}+D${row}+E${row}`
    // Add other formula mappings here based on row
  };
}
