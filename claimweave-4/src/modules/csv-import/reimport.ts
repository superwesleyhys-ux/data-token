// @polsia:framework-owned

import { CSV_LIMITS } from './contracts';
import type { ParsedCsv } from './parser';

export interface CsvExportColumn {
  key: string;
  kind: 'text' | 'identifier' | 'number' | 'boolean' | 'date' | 'datetime';
  access: 'editable' | 'readonly';
  nullable: boolean;
}

export interface CsvRoundTrip {
  schemaVersion: string;
  columns: readonly CsvExportColumn[];
}

const METADATA_HEADERS = [
  '__polsia_format',
  '__polsia_source',
  '__polsia_schema',
  '__polsia_scope',
  '__polsia_key',
  '__polsia_version',
] as const;
const KINDS = new Set(['text', 'identifier', 'number', 'boolean', 'date', 'datetime']);
const RESERVED_KEYS = new Set(['constructor', 'prototype']);

function hasUnsupportedCharacters(value: string): boolean {
  // The Unicode flag consumes valid surrogate pairs together.
  return value.includes('\0') || /[\uD800-\uDFFF]/u.test(value);
}

function matchesExactly(pattern: RegExp, value: string): boolean {
  // JavaScript's $ also matches before a final newline; wire tokens may not.
  return pattern.exec(value)?.[0] === value;
}

export function validateRoundTrip(
  config: CsvRoundTrip | undefined,
  fieldKeys: readonly string[],
  writableFields: readonly string[],
): void {
  if (config === undefined) {
    return;
  }
  if (
    !config ||
    typeof config.schemaVersion !== 'string' ||
    config.schemaVersion.length === 0 ||
    config.schemaVersion.length >= CSV_LIMITS.cellCharacters ||
    hasUnsupportedCharacters(config.schemaVersion) ||
    !Array.isArray(config.columns) ||
    config.columns.length === 0 ||
    config.columns.length > CSV_LIMITS.columns - METADATA_HEADERS.length
  ) {
    throw new Error(
      'La configuration du schéma de réimport est invalide. Vérifiez la déclaration serveur.',
    );
  }
  const fields = new Set(fieldKeys);
  const writable = new Set(writableFields);
  const seen = new Set<string>();
  for (const column of config.columns) {
    if (
      !column ||
      typeof column.key !== 'string' ||
      !matchesExactly(/^[a-z][a-z0-9_]{0,63}$/, column.key) ||
      RESERVED_KEYS.has(column.key) ||
      seen.has(column.key) ||
      !fields.has(column.key) ||
      !KINDS.has(column.kind) ||
      typeof column.nullable !== 'boolean' ||
      (column.access !== 'editable' && column.access !== 'readonly') ||
      (column.access === 'editable') !== writable.has(column.key)
    ) {
      throw new Error(
        'La configuration des colonnes de réimport est invalide. Vérifiez les champs et leurs droits d’écriture.',
      );
    }
    seen.add(column.key);
  }
}

type CsvRepresentation = 'v1' | 'v2-export' | 'v2-spreadsheet';

function decodeCell(cell: string, representation: CsvRepresentation): string | null {
  if (cell.length > CSV_LIMITS.cellCharacters || hasUnsupportedCharacters(cell)) {
    throw new Error(
      'Une cellule contient des caractères invalides ou dépasse la limite autorisée. Corrigez le fichier ou générez un nouvel export.',
    );
  }
  if (cell === '\\N') {
    return null;
  }
  let payload = cell;
  if (representation !== 'v2-spreadsheet') {
    if (!cell.startsWith("'")) {
      throw new Error(
        'La protection d’une cellule est absente. Conservez l’apostrophe initiale ou générez un nouvel export.',
      );
    }
    payload = cell.slice(1);
  }
  if (representation === 'v1') return payload;
  if (payload.startsWith('\\\\')) return payload.slice(1);
  if (payload.startsWith('\\')) {
    throw new Error(
      'L’échappement d’une cellule est ambigu. Doublez le premier antislash pour du texte littéral.',
    );
  }
  return payload;
}

function validScalar(value: string, kind: CsvExportColumn['kind']): boolean {
  switch (kind) {
    case 'text':
      return true;
    case 'identifier':
      return value.length > 0;
    case 'number':
      return matchesExactly(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/, value);
    case 'boolean':
      return value === 'true' || value === 'false';
    case 'date': {
      if (!matchesExactly(/^\d{4}-\d{2}-\d{2}$/, value)) {
        return false;
      }
      const date = new Date(`${value}T00:00:00.000Z`);
      return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
    }
    case 'datetime': {
      if (!matchesExactly(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, value)) {
        return false;
      }
      const date = new Date(value);
      return Number.isFinite(date.getTime()) && date.toISOString() === value;
    }
  }
}

export function decodeReimport(
  parsed: ParsedCsv,
  config: CsvRoundTrip | undefined,
  targetId: string,
  scopeId: string,
): {
  rows: Map<number, { key: string; version: string; values: Record<string, string | null> }>;
  columns: string[];
} | null {
  if (!parsed.headers.some((header) => header.trim().startsWith('__polsia_'))) {
    return null;
  }
  if (
    METADATA_HEADERS.some((header, index) => parsed.headers[index] !== header) ||
    parsed.headers.slice(METADATA_HEADERS.length).some((header) => header.startsWith('__polsia_'))
  ) {
    throw new Error(
      'Les en-têtes réservés de l’export sont incomplets ou altérés. Générez un nouvel export.',
    );
  }
  if (!config) {
    throw new Error(
      'Cette destination ne prend pas en charge le schéma d’export protégé. Choisissez une destination compatible.',
    );
  }
  const declarations = new Map(config.columns.map((column) => [column.key, column]));
  const columns = parsed.headers.slice(METADATA_HEADERS.length);
  if (columns.some((key) => !declarations.has(key))) {
    throw new Error(
      'Une colonne de l’export est inconnue du schéma serveur. Générez un nouvel export compatible.',
    );
  }

  const rows = new Map<
    number,
    { key: string; version: string; values: Record<string, string | null> }
  >();
  const seen = new Set<string>();
  let representation: CsvRepresentation | undefined;
  for (const row of parsed.rows) {
    const marker = row.cells[0];
    if (marker === 'polsia-csv-v1') {
      throw new Error(
        'Cet ancien export a perdu sa protection dans le tableur. Générez un nouvel export au format v2 avant de le modifier.',
      );
    }
    const current =
      marker === "'polsia-csv-v1"
        ? 'v1'
        : marker === "'polsia-csv-v2"
          ? 'v2-export'
          : marker === 'polsia-csv-v2'
            ? 'v2-spreadsheet'
            : undefined;
    if (!current || (representation !== undefined && representation !== current)) {
      throw new Error(
        'Le format ou la représentation des lignes est incohérent. Générez un nouvel export.',
      );
    }
    representation = current;
    const decoded = row.cells.map((cell) => decodeCell(cell, current));
    const [format, source, schema, scope, key, version] = decoded;
    if (
      [format, source, schema, scope].some((value) => typeof value !== 'string' || value === '')
    ) {
      throw new Error(
        'Une métadonnée obligatoire de l’export est vide ou nulle. Générez un nouvel export.',
      );
    }
    if (format !== (current === 'v1' ? 'polsia-csv-v1' : 'polsia-csv-v2')) {
      throw new Error(
        'Le format de l’export est invalide ou non pris en charge. Générez un nouvel export.',
      );
    }
    if (source !== targetId) {
      throw new Error(
        'La source de l’export ne correspond pas à la destination. Choisissez la destination de cet export.',
      );
    }
    if (schema !== config.schemaVersion) {
      throw new Error(
        'Le schéma de l’export est incompatible. Générez un nouvel export avec le schéma actuel.',
      );
    }
    if (scope !== scopeId) {
      throw new Error(
        'Le périmètre de l’export ne correspond pas au périmètre autorisé. Générez un export dans le périmètre actuel.',
      );
    }
    if (
      typeof key !== 'string' ||
      typeof version !== 'string' ||
      (key === '') !== (version === '')
    ) {
      throw new Error(
        'La clé et la version doivent être renseignées ensemble, ou toutes deux vides selon le format du fichier pour une création. Corrigez l’identité ou générez un nouvel export.',
      );
    }
    if (key !== '' && seen.has(key)) {
      throw new Error('Une clé est répétée dans l’export. Conservez une seule ligne par identité.');
    }
    if (key !== '') {
      seen.add(key);
    }
    const values: Record<string, string | null> = Object.create(null);
    for (let index = 0; index < columns.length; index += 1) {
      const columnKey = columns[index];
      const declaration = columnKey === undefined ? undefined : declarations.get(columnKey);
      const value = decoded[METADATA_HEADERS.length + index];
      if (
        columnKey === undefined ||
        declaration === undefined ||
        value === undefined ||
        (value === null ? !declaration.nullable : !validScalar(value, declaration.kind))
      ) {
        throw new Error(
          'Une valeur ne respecte pas le type ou la nullabilité de sa colonne. Corrigez la cellule selon le schéma de l’export.',
        );
      }
      values[columnKey] = value;
    }
    rows.set(row.record, { key, version, values });
  }
  return { rows, columns };
}
