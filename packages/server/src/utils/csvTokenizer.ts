/**
 * Shared RFC-style CSV tokenizer used by planning and PPC import parsers.
 * Unescapes doubled quotes ("" → ") and supports quoted fields spanning newlines.
 */
export function tokenizeCsvText(csvText: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const ch = csvText[i];
    if (ch === '"') {
      if (inQuotes && csvText[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && csvText[i + 1] === '\n') i++;
      row.push(current.trim());
      current = '';
      if (row.length > 1 || row[0]?.length > 0) {
        rows.push(row);
      }
      row = [];
      continue;
    }
    if (ch === ',' && !inQuotes) {
      row.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }

  row.push(current.trim());
  if (row.length > 1 || row[0]?.length > 0) {
    rows.push(row);
  }

  return rows;
}

/** Tokenize a single CSV record line (no embedded newlines). */
export function tokenizeCsvLine(line: string): string[] {
  const rows = tokenizeCsvText(line);
  return rows[0] ?? [];
}
