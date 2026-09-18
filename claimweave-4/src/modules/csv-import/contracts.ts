// @polsia:framework-owned

import { z } from 'zod';

export const CSV_LIMITS = {
  bytes: 10_485_760,
  records: 10_000,
  columns: 50,
  cellCharacters: 16_384,
} as const;

export const CSV_MAX_BODY_BYTES = 67_108_864;
export const CSV_SNAPSHOT_BYTES = 4_194_304;

export type CsvDelimiter = ',' | ';';
export type CsvMapping = Record<string, number>;
export type CsvImportMode = 'create' | 'update' | 'upsert';
export type CsvVersions = Record<string, string | null>;
export interface CsvFieldChange {
  field: string;
  before: string | null;
  after: string | null;
}

export interface CsvField {
  key: string;
  label: string;
  required: boolean;
  aliases?: string[];
  example?: string;
}

export interface CsvIssue {
  record: number | null;
  field: string | null;
  message: string;
}

export interface CsvInput {
  targetId: string;
  csv: string;
  delimiter: CsvDelimiter;
  mapping: CsvMapping;
  mode?: CsvImportMode;
  expectedVersions?: CsvVersions;
}

export interface ImportCounts {
  created: number;
  updated?: number;
  skipped: number;
}

export interface CsvDescription {
  id: string;
  label: string;
  fields: CsvField[];
  limits: typeof CSV_LIMITS;
  modes?: CsvImportMode[];
  updateKeyFields?: string[];
}

export interface CsvPreview {
  total: number;
  valid: number;
  invalid: number;
  existing: number;
  toCreate: number;
  toUpdate?: number;
  expectedVersions?: CsvVersions;
  rows: Array<{
    record: number;
    values: Record<string, string>;
    status: 'create' | 'update' | 'skip' | 'error';
    changes?: CsvFieldChange[];
  }>;
  issues: CsvIssue[];
  issueCount: number;
}

export type CsvApiError = {
  ok: false;
  error: { code: string; message: string; issues?: CsvIssue[] };
};

export type CsvApiSuccess<T> = { ok: true; data: T };

const fieldKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,63}$/)
  .refine((key) => !['__proto__', 'constructor', 'prototype'].includes(key));
const fieldSchema = z
  .object({
    key: fieldKeySchema,
    label: z.string().min(1),
    required: z.boolean(),
    aliases: z.array(z.string().min(1)).optional(),
    example: z.string().optional(),
  })
  .strict();
const issueSchema = z
  .object({
    record: z.number().int().positive().nullable(),
    field: z.string().nullable(),
    message: z.string().min(1),
  })
  .strict();
const limitsSchema = z
  .object({
    bytes: z.literal(CSV_LIMITS.bytes),
    records: z.literal(CSV_LIMITS.records),
    columns: z.literal(CSV_LIMITS.columns),
    cellCharacters: z.literal(CSV_LIMITS.cellCharacters),
  })
  .strict();
const modeSchema = z.enum(['create', 'update', 'upsert']);
const versionsSchema = z
  .record(
    z.string().min(1).max(CSV_LIMITS.cellCharacters),
    z.string().min(1).max(CSV_LIMITS.cellCharacters).nullable(),
  )
  .refine((versions) => Object.keys(versions).length <= CSV_LIMITS.records)
  .refine(
    (versions) =>
      new TextEncoder().encode(JSON.stringify(versions)).byteLength <= CSV_SNAPSHOT_BYTES,
  );
const countsSchema = z
  .object({
    created: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative().optional(),
    skipped: z.number().int().nonnegative(),
  })
  .strict();

export const csvRequestSchema = z
  .object({
    action: z.enum(['preview', 'commit']),
    mode: modeSchema.optional(),
    expectedVersions: versionsSchema.optional(),
    targetId: z.string().min(1).max(64),
    csv: z.string(),
    delimiter: z.enum([',', ';']),
    mapping: z
      .record(
        fieldKeySchema,
        z
          .number()
          .int()
          .min(0)
          .max(CSV_LIMITS.columns - 1),
      )
      .refine((mapping) => Object.keys(mapping).length <= CSV_LIMITS.columns),
  })
  .strict();

export const descriptionResponseSchema = z
  .object({
    ok: z.literal(true),
    data: z
      .object({
        id: z.string().min(1).max(64),
        label: z.string().min(1),
        fields: z.array(fieldSchema).max(CSV_LIMITS.columns),
        limits: limitsSchema,
        modes: z.array(modeSchema).min(1).max(3).optional(),
        updateKeyFields: z.array(fieldKeySchema).max(CSV_LIMITS.columns).optional(),
      })
      .strict(),
  })
  .strict();

export const previewResponseSchema = z
  .object({
    ok: z.literal(true),
    data: z
      .object({
        total: z.number().int().nonnegative(),
        valid: z.number().int().nonnegative(),
        invalid: z.number().int().nonnegative(),
        existing: z.number().int().nonnegative(),
        toCreate: z.number().int().nonnegative(),
        toUpdate: z.number().int().nonnegative().optional(),
        expectedVersions: versionsSchema.optional(),
        rows: z
          .array(
            z
              .object({
                record: z.number().int().positive(),
                values: z.record(fieldKeySchema, z.string()),
                status: z.enum(['create', 'update', 'skip', 'error']),
                changes: z
                  .array(
                    z
                      .object({
                        field: fieldKeySchema,
                        before: z.string().nullable(),
                        after: z.string().nullable(),
                      })
                      .strict(),
                  )
                  .max(CSV_LIMITS.columns)
                  .optional(),
              })
              .strict(),
          )
          .max(20),
        issues: z.array(issueSchema).max(100),
        issueCount: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export const commitResponseSchema = z.object({ ok: z.literal(true), data: countsSchema }).strict();

export const errorResponseSchema = z
  .object({
    ok: z.literal(false),
    error: z
      .object({
        code: z.string().min(1),
        message: z.string().min(1),
        issues: z.array(issueSchema).max(100).optional(),
      })
      .strict(),
  })
  .strict();
