// @polsia:framework-owned

import type { CsvField, CsvIssue } from './contracts';
import type { MappedCsvRow } from './parser';

export type RowValidation<Row> =
  | { ok: true; value: Row }
  | { ok: false; issues: Array<{ field: string | null; message: string }> };

export interface CsvRowValidator<Row> {
  fields: readonly CsvField[];
  parseRow(raw: Record<string, string>): RowValidation<Row>;
  keyOf(row: Row): string;
}

export interface ValidatedCsvRow<Row> extends MappedCsvRow {
  value: Row;
  key: string;
}

export interface CsvRowValidationResult<Row> {
  rows: ValidatedCsvRow<Row>[];
  issues: CsvIssue[];
  invalid: number;
}

export function validateRows<Row>(
  mappedRows: readonly MappedCsvRow[],
  target: CsvRowValidator<Row>,
): CsvRowValidationResult<Row> {
  const issues: CsvIssue[] = [];
  const invalidRecords = new Set<number>();
  const candidates: ValidatedCsvRow<Row>[] = [];

  for (const mapped of mappedRows) {
    let requiredMissing = false;
    for (const field of target.fields) {
      if (field.required && !mapped.values[field.key]?.trim()) {
        issues.push({
          record: mapped.record,
          field: field.key,
          message: `Le champ « ${field.label} » est obligatoire.`,
        });
        invalidRecords.add(mapped.record);
        requiredMissing = true;
      }
    }
    if (requiredMissing) {
      continue;
    }

    const parsed = target.parseRow(mapped.values);
    if (!parsed.ok) {
      invalidRecords.add(mapped.record);
      if (parsed.issues.length === 0) {
        issues.push({
          record: mapped.record,
          field: null,
          message: 'Cet enregistrement est invalide.',
        });
      }
      for (const issue of parsed.issues) {
        issues.push({ record: mapped.record, ...issue });
      }
      continue;
    }

    const key = target.keyOf(parsed.value).trim();
    if (!key) {
      invalidRecords.add(mapped.record);
      issues.push({
        record: mapped.record,
        field: null,
        message: 'La clé métier de cet enregistrement est vide.',
      });
      continue;
    }
    candidates.push({ ...mapped, value: parsed.value, key });
  }

  const rowsByKey = new Map<string, ValidatedCsvRow<Row>[]>();
  for (const row of candidates) {
    const duplicates = rowsByKey.get(row.key) ?? [];
    duplicates.push(row);
    rowsByKey.set(row.key, duplicates);
  }

  for (const duplicates of rowsByKey.values()) {
    if (duplicates.length < 2) {
      continue;
    }
    for (const duplicate of duplicates) {
      invalidRecords.add(duplicate.record);
      issues.push({
        record: duplicate.record,
        field: null,
        message: 'Cette clé métier est répétée dans le fichier.',
      });
    }
  }

  return {
    rows: candidates.filter((row) => !invalidRecords.has(row.record)),
    issues,
    invalid: invalidRecords.size,
  };
}
