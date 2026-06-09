/** E2 line log-sheet layout config (one per process). */

export interface LineLogColumn {
  header: string;
  field: string;
  mandatory: boolean;
  unit?: string | null;
}

export interface LineLogSection {
  title: string;
  startRow: number;
  columns: LineLogColumn[];
}

export interface LineLogLayout {
  processCode: string;
  documentNumber: string;
  title: string;
  version: string;
  headerFields: LineLogColumn[];
  body: LineLogSection;
  stoppages: LineLogSection;
  crew: LineLogSection;
  signOff: {
    row: number;
    roles: string[];
  };
}

export interface LineLogBodyRow {
  [key: string]: string | number | null;
}

export interface LineLogShiftBundle {
  shiftLogId: string;
  prodDate: string;
  shiftCode: string;
  bodyRows: LineLogBodyRow[];
  stoppages: Record<string, unknown>[];
  crew: Record<string, unknown>[];
  defects: Record<string, unknown>[];
}

export interface LineLogRdm {
  report: 'LINE_LOG';
  processCode: string;
  documentNumber: string;
  title: string;
  dateFrom: string;
  dateTo: string;
  shiftCode?: string;
  shifts: LineLogShiftBundle[];
  generatedAt: string;
}
