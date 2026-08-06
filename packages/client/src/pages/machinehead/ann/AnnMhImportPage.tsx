import { LineMhImportPage } from '../LineMhImportPage';

/** ANN MH Import — Annealing plan file only, line-scoped. */
export function AnnMhImportPage() {
  return (
    <LineMhImportPage
      line="ANN"
      title="Import"
      subtitle="ANN plan file only — fail-safe import; skips coils already advanced past ANN"
      lockedSheetType="ANNEALING"
    />
  );
}
