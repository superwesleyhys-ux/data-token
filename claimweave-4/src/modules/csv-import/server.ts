// @polsia:framework-owned

import type {
  CsvDescription,
  CsvField,
  CsvInput,
  CsvIssue,
  CsvPreview,
  ImportCounts,
} from './contracts';
import {
  CSV_LIMITS,
  CSV_MAX_BODY_BYTES,
  commitResponseSchema,
  csvRequestSchema,
  descriptionResponseSchema,
  errorResponseSchema,
  previewResponseSchema,
} from './contracts';
import type { MappedCsvRow } from './parser';
import { mapCsv, parseCsv, readCsvHeaders } from './parser';
import type { CsvUpdates } from './updates';
import { commitUpdates, prepareUpdates, validateUpdates } from './updates';

export type { CsvExportColumn, CsvRoundTrip } from './reimport';
export type { CsvChange, CsvExistingRow, CsvUpdates } from './updates';

import type { RowValidation } from './validation';
import { validateRows } from './validation';

export type { RowValidation } from './validation';

const LOOKUP_BATCH_SIZE = 500;
const MAX_DETAILED_ISSUES = 100;
const TARGET_ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export interface ImportContext {
  actorId: string;
  scopeId: string;
}

export interface CsvTarget<Row> {
  id: string;
  label: string;
  fields: CsvField[];
  updates?: CsvUpdates<Row>;
  parseRow(raw: Record<string, string>): RowValidation<Row>;
  keyOf(row: Row): string;
  findExistingKeys(keys: readonly string[], context: ImportContext): Promise<string[]>;
  insertNewRows(rows: readonly Row[], context: ImportContext): Promise<ImportCounts>;
}

export interface CsvServerTarget {
  id: string;
  describe(): CsvDescription;
  preview(input: CsvInput, context: ImportContext): Promise<CsvPreview>;
  commit(input: CsvInput, context: ImportContext): Promise<ImportCounts>;
}

export interface CsvHandlersOptions {
  targets: readonly CsvServerTarget[];
  authorize(request: Request, targetId: string): Promise<ImportContext>;
  allowedOrigin: string;
}

export class CsvAccessError extends Error {
  readonly status: 401 | 403;

  constructor(status: 401 | 403, message = 'Accès refusé.') {
    super(message);
    this.name = 'CsvAccessError';
    this.status = status;
  }
}

export class CsvImportError extends Error {
  readonly status: 400 | 409 | 413 | 422;
  readonly code: string;
  readonly issues?: CsvIssue[];

  constructor(
    status: 400 | 409 | 413 | 422,
    code: string,
    message: string,
    issues?: readonly CsvIssue[],
  ) {
    super(message);
    this.name = 'CsvImportError';
    this.status = status;
    this.code = code;
    this.issues = issues ? [...issues].slice(0, MAX_DETAILED_ISSUES) : undefined;
  }
}

function processInput<Row>(input: CsvInput, target: CsvTarget<Row>) {
  if (input.targetId !== target.id) {
    throw new CsvImportError(400, 'TARGET_MISMATCH', 'La destination ne correspond pas.');
  }
  let mapped: MappedCsvRow[];
  try {
    mapped = mapCsv(parseCsv(input.csv, input.delimiter), target.fields, input.mapping);
  } catch (error) {
    throw new CsvImportError(
      400,
      'INVALID_CSV',
      error instanceof Error ? error.message : 'Le fichier CSV est invalide.',
    );
  }
  return { mapped, validation: validateRows(mapped, target) };
}

export function defineCsvTarget<Row>(target: CsvTarget<Row>): CsvServerTarget {
  const fieldKeys = target.fields.map((field) => field.key);
  if (
    !TARGET_ID_PATTERN.test(target.id) ||
    RESERVED_KEYS.has(target.id) ||
    !target.label.trim() ||
    target.fields.length === 0 ||
    target.fields.length > CSV_LIMITS.columns ||
    new Set(fieldKeys).size !== fieldKeys.length ||
    typeof target.parseRow !== 'function' ||
    typeof target.keyOf !== 'function' ||
    typeof target.findExistingKeys !== 'function' ||
    typeof target.insertNewRows !== 'function'
  ) {
    throw new Error('Configuration CSV invalide.');
  }
  try {
    descriptionResponseSchema.parse({
      ok: true,
      data: {
        id: target.id,
        label: target.label,
        fields: target.fields,
        limits: CSV_LIMITS,
      },
    });
  } catch {
    throw new Error('Configuration CSV invalide.');
  }

  validateUpdates(target);
  function useUpdates(input: CsvInput) {
    if (input.mode !== undefined && !['create', 'update', 'upsert'].includes(input.mode)) {
      throw new CsvImportError(400, 'INVALID_REQUEST', 'Le mode d’import est invalide.');
    }
    if (input.mode && input.mode !== 'create') return true;
    try {
      return readCsvHeaders(input.csv, input.delimiter).some((header) =>
        header.trim().startsWith('__polsia_'),
      );
    } catch (error) {
      throw new CsvImportError(
        400,
        'INVALID_CSV',
        error instanceof Error ? error.message : 'Le fichier CSV est invalide.',
      );
    }
  }

  return {
    id: target.id,
    describe() {
      return {
        id: target.id,
        label: target.label,
        fields: target.fields.map((field) => ({
          ...field,
          aliases: field.aliases ? [...field.aliases] : undefined,
        })),
        limits: CSV_LIMITS,
        ...(target.updates
          ? {
              modes: ['create', 'update', 'upsert'] as Array<'create' | 'update' | 'upsert'>,
              updateKeyFields: [...target.updates.keyFields],
            }
          : {}),
      };
    },
    async preview(input, context) {
      if (useUpdates(input)) return (await prepareUpdates(input, target, context)).preview;
      const { mapped, validation } = processInput(input, target);
      const existingKeys = new Set<string>();
      for (let index = 0; index < validation.rows.length; index += LOOKUP_BATCH_SIZE) {
        const keys = validation.rows.slice(index, index + LOOKUP_BATCH_SIZE).map((row) => row.key);
        const existing = await target.findExistingKeys(keys, context);
        for (const key of existing) {
          existingKeys.add(key);
        }
      }

      const invalidRecords = new Set(
        validation.issues.flatMap((issue) => (issue.record === null ? [] : [issue.record])),
      );
      const keyByRecord = new Map(validation.rows.map((row) => [row.record, row.key]));
      const existing = validation.rows.filter((row) => existingKeys.has(row.key)).length;
      const valid = mapped.length - validation.invalid;

      return {
        total: mapped.length,
        valid,
        invalid: validation.invalid,
        existing,
        toCreate: valid - existing,
        rows: mapped.slice(0, 20).map((row) => ({
          record: row.record,
          values: row.values,
          status: invalidRecords.has(row.record)
            ? 'error'
            : existingKeys.has(keyByRecord.get(row.record) ?? '')
              ? 'skip'
              : 'create',
        })),
        issues: validation.issues.slice(0, MAX_DETAILED_ISSUES),
        issueCount: validation.issues.length,
      };
    },
    async commit(input, context) {
      if (useUpdates(input)) return commitUpdates(input, target, context);
      const { validation } = processInput(input, target);
      if (validation.invalid > 0) {
        throw new CsvImportError(
          422,
          'INVALID_ROWS',
          'Corrigez les lignes invalides avant l’import.',
          validation.issues,
        );
      }
      if (validation.rows.length === 0) {
        return { created: 0, skipped: 0 };
      }
      return target.insertNewRows(
        validation.rows.map((row) => row.value),
        context,
      );
    },
  };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    },
  });
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  issues?: CsvIssue[],
): Response {
  const body = {
    ok: false as const,
    error: { code, message, ...(issues ? { issues } : {}) },
  };
  const checked = errorResponseSchema.parse(body);
  return jsonResponse(checked, status);
}

async function readJsonBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim();
  if (contentType !== 'application/json') {
    throw new CsvImportError(400, 'INVALID_REQUEST', 'Le corps doit être du JSON.');
  }
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isFinite(length) || length < 0) {
      throw new CsvImportError(400, 'INVALID_REQUEST', 'Content-Length invalide.');
    }
    if (length > CSV_MAX_BODY_BYTES) {
      throw new CsvImportError(413, 'BODY_TOO_LARGE', 'Le corps de la requête dépasse 64 Mio.');
    }
  }

  if (!request.body) {
    throw new CsvImportError(400, 'INVALID_JSON', 'Le corps JSON est invalide.');
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > CSV_MAX_BODY_BYTES) {
      await reader.cancel();
      throw new CsvImportError(413, 'BODY_TOO_LARGE', 'Le corps de la requête dépasse 64 Mio.');
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new CsvImportError(400, 'INVALID_JSON', 'Le corps JSON doit être encodé en UTF-8.');
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new CsvImportError(400, 'INVALID_JSON', 'Le corps JSON est invalide.');
  }
}

function findTarget(targets: ReadonlyMap<string, CsvServerTarget>, id: string): CsvServerTarget {
  const target = targets.get(id);
  if (!target) {
    throw new CsvImportError(400, 'TARGET_NOT_FOUND', 'Destination inconnue.');
  }
  return target;
}

function handleError(error: unknown): Response {
  if (error instanceof CsvAccessError) {
    return errorResponse(
      error.status,
      error.status === 401 ? 'UNAUTHENTICATED' : 'FORBIDDEN',
      error.message,
    );
  }
  if (error instanceof CsvImportError) {
    const status = error.code === 'TARGET_NOT_FOUND' ? 404 : error.status;
    return errorResponse(status, error.code, error.message, error.issues);
  }
  return errorResponse(500, 'INTERNAL_ERROR', 'Une erreur interne est survenue.');
}

export function createCsvImportHandlers(options: CsvHandlersOptions): {
  GET(request: Request): Promise<Response>;
  POST(request: Request): Promise<Response>;
} {
  let trustedOrigin: string;
  try {
    const parsedOrigin = new URL(options.allowedOrigin);
    if (parsedOrigin.origin !== options.allowedOrigin) {
      throw new Error('not an origin');
    }
    trustedOrigin = parsedOrigin.origin;
  } catch {
    throw new Error('Configuration CSV invalide : allowedOrigin doit être une origine.');
  }
  const targets = new Map<string, CsvServerTarget>();
  for (const target of options.targets) {
    if (targets.has(target.id)) {
      throw new Error(`Configuration CSV invalide : destination dupliquée « ${target.id} ».`);
    }
    targets.set(target.id, target);
  }

  return {
    async GET(request) {
      try {
        const url = new URL(request.url);
        const targetIds = url.searchParams.getAll('target');
        const unexpected = [...url.searchParams.keys()].some((key) => key !== 'target');
        if (unexpected || targetIds.length !== 1 || !targetIds[0]) {
          throw new CsvImportError(400, 'INVALID_REQUEST', 'Destination manquante ou invalide.');
        }
        const target = findTarget(targets, targetIds[0]);
        await options.authorize(request, target.id);
        const body = descriptionResponseSchema.parse({ ok: true, data: target.describe() });
        return jsonResponse(body, 200);
      } catch (error) {
        return handleError(error);
      }
    },
    async POST(request) {
      try {
        if (request.headers.get('origin') !== trustedOrigin) {
          throw new CsvAccessError(403, 'Origine refusée.');
        }
        const raw = await readJsonBody(request);
        const parsedRequest = csvRequestSchema.safeParse(raw);
        if (!parsedRequest.success) {
          throw new CsvImportError(400, 'INVALID_REQUEST', 'La requête d’import est invalide.');
        }
        const { action, ...input } = parsedRequest.data;
        const target = findTarget(targets, input.targetId);
        const context = await options.authorize(request, target.id);

        if (action === 'preview') {
          const body = previewResponseSchema.parse({
            ok: true,
            data: await target.preview(input, context),
          });
          return jsonResponse(body, 200);
        }
        const body = commitResponseSchema.parse({
          ok: true,
          data: await target.commit(input, context),
        });
        return jsonResponse(body, 200);
      } catch (error) {
        return handleError(error);
      }
    },
  };
}
