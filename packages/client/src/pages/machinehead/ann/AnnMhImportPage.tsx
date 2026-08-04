import { LineMhImportPage } from '../LineMhImportPage';

/** ANN MH Import — Annealing PPC sheet only, line-scoped. */
export function AnnMhImportPage() {
  return (
    <LineMhImportPage
      line="ANN"
      title="Import"
      subtitle="Import Annealing sheet from the PPC workbook into the ANN queue"
      lockedSheetType="ANNEALING"
    />
  );
}
