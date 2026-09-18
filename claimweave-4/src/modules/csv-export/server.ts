// @polsia:framework-owned

import { z } from 'zod';
import {
  CSV_EXPORT_ERRORS,
  CSV_EXPORT_FORMAT,
  CSV_EXPORT_LIMITS,
  type CsvColumnDescription,
  type CsvDelimiter,
  CsvExportError,
  type CsvExportInput,
  type CsvSourceDescription,
  exportResponseSchema,
  RESERVED_COLUMNS,
} from './contracts';
import { encodeCell, serializeRecord } from './serialization';

export { CsvExportError } from './contracts';
export interface ExportContext {
  actorId: string;
  scopeId: string;
}
export interface CsvExportColumn<Row> extends CsvColumnDescription {
  serialize(row: Row): string | null;
}
export type CsvFilterResult<Filters> = { ok: true; value: Filters } | { ok: false };
export interface CsvSource<Row, Filters> {
  id: string;
  label: string;
  schemaVersion: string;
  columns: readonly CsvExportColumn<Row>[];
  parseFilters(raw: unknown): CsvFilterResult<Filters>;
  authorizeColumns(context: ExportContext): Promise<readonly string[]>;
  keyOf(row: Row): string;
  versionOf(row: Row): string;
  // One projected, scoped, ordered statement snapshot. Never apply UI pagination.
  // Honor limit and signal; configure a database statement timeout <= 30 seconds.
  readRows(input: {
    context: ExportContext;
    filters: Filters;
    columns: readonly string[];
    limit: number;
    signal: AbortSignal;
  }): Promise<readonly Row[]>;
}
export interface CsvExportResult {
  csv: string;
  records: number;
}
export interface CsvServerSource {
  id: string;
  describe(context: ExportContext): Promise<CsvSourceDescription>;
  export(
    input: Omit<CsvExportInput, 'sourceId'>,
    context: ExportContext,
    signal?: AbortSignal,
  ): Promise<CsvExportResult>;
}
export interface CsvExportHandlersOptions {
  sources: readonly CsvServerSource[];
  authorize(request: Request, sourceId: string): Promise<ExportContext>;
  allowedOrigin: string;
}
export class CsvAccessError extends Error {
  readonly status: 401 | 403;
  constructor(status: 401 | 403) {
    super('Accès refusé.');
    this.status = status;
  }
}

const keySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,63}$/)
  .refine((key) => !['constructor', 'prototype'].includes(key));
const idSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
const columnSchema = z.object({
  key: keySchema,
  label: z.string().min(1).max(256),
  kind: z.enum(['text', 'identifier', 'number', 'boolean', 'date', 'datetime']),
  access: z.enum(['editable', 'readonly']),
  nullable: z.boolean(),
});
const requestSchema = z
  .object({
    sourceId: idSchema,
    filters: z.unknown().refine((value) => value !== undefined),
    columns: z
      .array(keySchema)
      .min(1)
      .max(CSV_EXPORT_LIMITS.columns - RESERVED_COLUMNS.length)
      .refine((keys) => new Set(keys).size === keys.length)
      .optional(),
    delimiter: z.enum([',', ';']).default(','),
  })
  .strict();

function assertContext(context: ExportContext): void {
  if (
    !context ||
    typeof context.actorId !== 'string' ||
    !context.actorId ||
    typeof context.scopeId !== 'string' ||
    !context.scopeId
  )
    throw new CsvAccessError(403);
}
function nonEmpty(value: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new CsvExportError('INVALID_SOURCE');
  encodeCell(value);
  return value;
}
function validateValue(value: string | null, column: CsvColumnDescription): void {
  if (value === null) {
    if (!column.nullable) throw new CsvExportError('INVALID_SOURCE');
    return;
  }
  if (typeof value !== 'string') throw new CsvExportError('INVALID_SOURCE');
  let valid = true;
  switch (column.kind) {
    case 'identifier':
      valid = value.length > 0;
      break;
    case 'number':
      valid = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value);
      break;
    case 'boolean':
      valid = value === 'true' || value === 'false';
      break;
    case 'date': {
      const date = new Date(`${value}T00:00:00.000Z`);
      valid =
        /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        Number.isFinite(date.getTime()) &&
        date.toISOString().slice(0, 10) === value;
      break;
    }
    case 'datetime': {
      const date = new Date(value);
      valid =
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
        Number.isFinite(date.getTime()) &&
        date.toISOString() === value;
      break;
    }
  }
  if (!valid) throw new CsvExportError('INVALID_SOURCE');
}

async function boundedRead<Row>(
  read: (signal: AbortSignal) => Promise<readonly Row[]>,
  signal?: AbortSignal,
): Promise<readonly Row[]> {
  if (signal?.aborted) throw new CsvExportError('CANCELLED');
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort = () => {};
  try {
    return await Promise.race([
      new Promise<never>((_, reject) => {
        onAbort = () => {
          controller.abort();
          reject(new CsvExportError('CANCELLED'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        timer = setTimeout(() => {
          controller.abort();
          reject(new CsvExportError('TIMEOUT'));
        }, CSV_EXPORT_LIMITS.readMilliseconds);
      }),
      Promise.resolve()
        .then(() => read(controller.signal))
        .catch(() => {
          throw new CsvExportError('READ_FAILED');
        }),
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export function defineCsvSource<Row, Filters>(source: CsvSource<Row, Filters>): CsvServerSource {
  if (
    !idSchema.safeParse(source.id).success ||
    !source.label?.trim() ||
    source.columns.length < 1 ||
    source.columns.length > CSV_EXPORT_LIMITS.columns - RESERVED_COLUMNS.length ||
    new Set(source.columns.map((column) => column.key)).size !== source.columns.length ||
    source.columns.some(
      (column) => !columnSchema.safeParse(column).success || typeof column.serialize !== 'function',
    ) ||
    [
      source.parseFilters,
      source.authorizeColumns,
      source.keyOf,
      source.versionOf,
      source.readRows,
    ].some((fn) => typeof fn !== 'function')
  ) {
    throw new CsvExportError('INVALID_SOURCE');
  }
  nonEmpty(source.schemaVersion);
  // Capture the declaration so callers cannot accidentally widen columns after registration.
  const columns = source.columns.map((column) => ({ ...column }));
  async function permitted(context: ExportContext, requested?: readonly string[]) {
    assertContext(context);
    const keys = await source.authorizeColumns(context);
    if (
      !Array.isArray(keys) ||
      new Set(keys).size !== keys.length ||
      keys.some((key) => !columns.some((column) => column.key === key))
    )
      throw new CsvExportError('INVALID_SOURCE');
    if (keys.length === 0 || requested?.some((key) => !keys.includes(key)))
      throw new CsvAccessError(403);
    const selected = columns.filter(
      (column) => keys.includes(column.key) && (!requested || requested.includes(column.key)),
    );
    if (!selected.length) throw new CsvAccessError(403);
    return selected;
  }
  return {
    id: source.id,
    async describe(context) {
      const selected = await permitted(context);
      return {
        id: source.id,
        label: source.label,
        schemaVersion: source.schemaVersion,
        columns: selected.map((column) => columnSchema.parse(column)),
        limits: CSV_EXPORT_LIMITS,
        format: CSV_EXPORT_FORMAT,
      };
    },
    async export(input, context, signal) {
      const selected = await permitted(context, input.columns);
      const parsed = source.parseFilters(input.filters);
      if (!parsed.ok) throw new CsvExportError('INVALID_FILTERS');
      const rows = await boundedRead(
        (readSignal) =>
          source.readRows({
            context,
            filters: parsed.value,
            columns: selected.map((column) => column.key),
            limit: CSV_EXPORT_LIMITS.records + 1,
            signal: readSignal,
          }),
        signal,
      );
      if (!Array.isArray(rows)) throw new CsvExportError('INVALID_SOURCE');
      if (rows.length > CSV_EXPORT_LIMITS.records) throw new CsvExportError('ROW_LIMIT');
      if (rows.length === 0) throw new CsvExportError('NO_RESULTS');
      const keys = new Set<string>();
      const identified = rows
        .map((row) => {
          const key = nonEmpty(source.keyOf(row));
          if (keys.has(key)) throw new CsvExportError('INVALID_SOURCE');
          keys.add(key);
          return { row, key, version: nonEmpty(source.versionOf(row)) };
        })
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      const delimiter: CsvDelimiter = input.delimiter ?? ',';
      const chunks = ['\uFEFF'];
      const encoder = new TextEncoder();
      let bytes = 3;
      function append(cells: string[]) {
        const record = serializeRecord(cells, delimiter);
        bytes += encoder.encode(record).byteLength;
        if (bytes > CSV_EXPORT_LIMITS.bytes) throw new CsvExportError('BYTE_LIMIT');
        chunks.push(record);
      }
      append([...RESERVED_COLUMNS, ...selected.map((column) => column.key)]);
      for (const { row, key, version } of identified) {
        if (signal?.aborted) throw new CsvExportError('CANCELLED');
        const values = selected.map((column) => {
          const value = column.serialize(row);
          validateValue(value, column);
          return encodeCell(value);
        });
        append(
          [CSV_EXPORT_FORMAT, source.id, source.schemaVersion, context.scopeId, key, version]
            .map(encodeCell)
            .concat(values),
        );
      }
      return { csv: chunks.join(''), records: rows.length };
    },
  };
}

async function readJson(request: Request): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json')
    throw new CsvExportError('INVALID_REQUEST');
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length))))
    throw new CsvExportError('INVALID_REQUEST');
  if (length !== null && Number(length) > CSV_EXPORT_LIMITS.requestBytes)
    throw new CsvExportError('BODY_LIMIT');
  if (!request.body) throw new CsvExportError('INVALID_REQUEST');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > CSV_EXPORT_LIMITS.requestBytes) {
        await reader.cancel();
        throw new CsvExportError('BODY_LIMIT');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new CsvExportError('INVALID_REQUEST');
  }
}
const noStore = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
function failure(error: unknown): Response {
  const code =
    error instanceof CsvAccessError
      ? error.status === 401
        ? 'UNAUTHENTICATED'
        : 'FORBIDDEN'
      : error instanceof CsvExportError
        ? error.code
        : 'INVALID_SOURCE';
  return Response.json(
    { ok: false, error: { code, message: CSV_EXPORT_ERRORS[code].message } },
    { status: CSV_EXPORT_ERRORS[code].status, headers: noStore },
  );
}
export function createCsvExportHandlers(options: CsvExportHandlersOptions): {
  GET(request: Request): Promise<Response>;
  POST(request: Request): Promise<Response>;
} {
  if (
    new URL(options.allowedOrigin).origin !== options.allowedOrigin ||
    !/^https?:\/\//.test(options.allowedOrigin)
  )
    throw new Error('Origine CSV invalide.');
  const sources = new Map(options.sources.map((source) => [source.id, source]));
  if (sources.size !== options.sources.length) throw new Error('Source CSV dupliquée.');
  async function authorized(request: Request, id: string) {
    const context = await options.authorize(request, id);
    assertContext(context);
    const source = sources.get(id);
    if (!source) throw new CsvExportError('SOURCE_NOT_FOUND');
    return { source, context };
  }
  return {
    async GET(request) {
      try {
        const query = new URL(request.url).searchParams;
        const id = query.get('source');
        if ([...query].length !== 1 || !idSchema.safeParse(id).success || !id)
          throw new CsvExportError('INVALID_REQUEST');
        const { source, context } = await authorized(request, id);
        return Response.json(
          { ok: true, data: await source.describe(context) },
          { headers: noStore },
        );
      } catch (error) {
        return failure(error);
      }
    },
    async POST(request) {
      try {
        if (request.headers.get('origin') !== options.allowedOrigin) throw new CsvAccessError(403);
        const parsed = requestSchema.safeParse(await readJson(request));
        if (!parsed.success) throw new CsvExportError('INVALID_REQUEST');
        const { sourceId, ...input } = parsed.data;
        const { source, context } = await authorized(request, sourceId);
        const result = await source.export(input, context, request.signal);
        const body = exportResponseSchema.parse({
          ok: true,
          data: {
            ...result,
            filename: `${source.id}.csv`,
          },
        });
        return Response.json(body, { headers: noStore });
      } catch (error) {
        return failure(error);
      }
    },
  };
}
