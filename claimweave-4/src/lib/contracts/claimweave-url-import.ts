// @polsia:user-owned — shared client/server contracts for project URL intake.
import { z } from 'zod';

export const UrlImportRowStatus = z.enum(['queued', 'error', 'processing', 'completed', 'failed']);
export const UrlImportBatchStatus = z.enum(['queued', 'processing', 'completed', 'failed']);

export const UrlImportRow = z
  .object({
    id: z.string().min(1),
    rowNumber: z.number().int().positive(),
    rawValue: z.string(),
    normalizedUrl: z.string().url().nullable(),
    status: UrlImportRowStatus,
    error: z.string().min(1).nullable(),
    processingStartedAt: z.string().datetime().nullable(),
    completedAt: z.string().datetime().nullable(),
    failedAt: z.string().datetime().nullable(),
    documentId: z.string().min(1).nullable(),
    claimCount: z.number().int().nonnegative(),
    extractedAt: z.string().datetime().nullable(),
  })
  .superRefine((row, context) => {
    if (row.status === 'error' && row.error === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['error'],
        message: 'Rejected rows need an error.',
      });
    }
    if (row.status === 'processing' && row.processingStartedAt === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['processingStartedAt'],
        message: 'Processing rows need a start timestamp.',
      });
    }
    if (row.status === 'completed') {
      if (row.documentId === null) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['documentId'],
          message: 'Completed rows need a document.',
        });
      }
      if (row.completedAt === null || row.extractedAt === null) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['completedAt'],
          message: 'Completed rows need completion metadata.',
        });
      }
      if (row.error !== null) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['error'],
          message: 'Completed rows cannot have an error.',
        });
      }
    }
    if (row.status === 'failed') {
      if (row.error === null || row.failedAt === null) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['error'],
          message: 'Failed rows need failure metadata.',
        });
      }
      if (row.documentId !== null || row.extractedAt !== null) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['documentId'],
          message: 'Failed rows cannot expose a partial document.',
        });
      }
    }
  });

export const UrlImportBatch = z.object({
  id: z.string().min(1),
  createdAt: z.string().datetime(),
  totalRows: z.number().int().nonnegative(),
  acceptedRows: z.number().int().nonnegative(),
  errorRows: z.number().int().nonnegative(),
  status: UrlImportBatchStatus,
  rows: z.array(UrlImportRow),
});

export const UrlImportStatus = z.object({ batches: z.array(UrlImportBatch) });

export const UrlImportProcessRequest = z
  .object({
    rowId: z.string().trim().min(1).optional(),
    batchId: z.string().trim().min(1).optional(),
    retry: z.boolean().optional().default(false),
  })
  .strict()
  .superRefine((request, context) => {
    if (request.retry && (!request.rowId || !request.batchId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['retry'],
        message: 'Retry requests need a row and batch.',
      });
    }
  });

export const UrlImportProcessResponse = z.object({ row: UrlImportRow });

export type UrlImportRow = z.infer<typeof UrlImportRow>;
export type UrlImportBatch = z.infer<typeof UrlImportBatch>;
export type UrlImportStatus = z.infer<typeof UrlImportStatus>;
export type UrlImportProcessRequest = z.infer<typeof UrlImportProcessRequest>;
export type UrlImportProcessResponse = z.infer<typeof UrlImportProcessResponse>;
