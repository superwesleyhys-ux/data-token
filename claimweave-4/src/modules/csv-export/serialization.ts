// @polsia:framework-owned

import { CSV_EXPORT_LIMITS, type CsvDelimiter, CsvExportError } from './contracts';

// Escape a leading backslash before text protection so consuming one apostrophe
// in a spreadsheet cannot turn the literal string \\N into the null sentinel.
export function encodeCell(value: string | null): string {
  if (value === null) return '\\N';
  if (typeof value !== 'string' || value.includes('\0') || /[\uD800-\uDFFF]/u.test(value)) {
    throw new CsvExportError('INVALID_SOURCE');
  }
  const payload = value.startsWith('\\') ? `\\${value}` : value;
  const encoded = `'${payload}`;
  if (encoded.length > CSV_EXPORT_LIMITS.cellCharacters) throw new CsvExportError('CELL_LIMIT');
  return encoded;
}

// Codec only, not an import/update workflow. Validate types and permissions separately.
export function decodeCell(
  cell: string,
  representation: 'export' | 'spreadsheet' = 'export',
): string | null {
  if (cell === '\\N') return null;
  let payload = cell;
  if (representation === 'export') {
    if (!cell.startsWith("'")) throw new Error('Préfixe CSV manquant ou altéré.');
    payload = cell.slice(1);
  }
  if (payload.startsWith('\\\\')) return payload.slice(1);
  if (payload.startsWith('\\')) throw new Error('Échappement CSV manquant ou altéré.');
  return payload;
}

export function serializeRecord(cells: readonly string[], delimiter: CsvDelimiter): string {
  return `${cells.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(delimiter)}\r\n`;
}
