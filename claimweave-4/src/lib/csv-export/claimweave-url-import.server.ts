// @polsia:user-owned — scoped CSV source for URL-import batches.

import 'server-only';

import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { type CsvExportColumn, defineCsvSource } from '@/modules/csv-export/server';

const filtersSchema = z
  .object({
    projectId: z.string().trim().min(1).max(128),
    batchId: z.string().trim().min(1).max(128),
  })
  .strict();

export type ClaimweaveUrlImportExportFilters = z.infer<typeof filtersSchema>;

type ExportRow = Prisma.ClaimweaveUrlImportRowGetPayload<{
  select: {
    id: true;
    rowNumber: true;
    rawValue: true;
    normalizedUrl: true;
    status: true;
    error: true;
    projectId: true;
    importedDocument: { select: { id: true } };
  };
}>;

const columns: readonly CsvExportColumn<ExportRow>[] = [
  {
    key: 'submitted_url',
    label: 'Submitted URL',
    kind: 'text',
    access: 'readonly',
    nullable: false,
    serialize: (row) => row.rawValue,
  },
  {
    key: 'normalized_url',
    label: 'Normalized URL',
    kind: 'text',
    access: 'readonly',
    nullable: true,
    serialize: (row) => row.normalizedUrl,
  },
  {
    key: 'validation_status',
    label: 'Validation status',
    kind: 'text',
    access: 'readonly',
    nullable: false,
    serialize: (row) => (row.status === 'error' ? 'invalid' : 'valid'),
  },
  {
    key: 'processing_status',
    label: 'Processing status',
    kind: 'text',
    access: 'readonly',
    nullable: false,
    serialize: (row) => (row.status === 'error' ? 'not_processed' : row.status),
  },
  {
    key: 'error_message',
    label: 'Error message',
    kind: 'text',
    access: 'readonly',
    nullable: true,
    serialize: (row) => row.error,
  },
  {
    key: 'project_reference',
    label: 'Project reference',
    kind: 'identifier',
    access: 'readonly',
    nullable: false,
    serialize: (row) => row.projectId,
  },
  {
    key: 'document_reference',
    label: 'Document reference',
    kind: 'identifier',
    access: 'readonly',
    nullable: true,
    serialize: (row) => row.importedDocument?.id ?? null,
  },
];

const columnKeys = columns.map((column) => column.key);

export const claimweaveUrlImportSource = defineCsvSource<
  ExportRow,
  ClaimweaveUrlImportExportFilters
>({
  id: 'claimweave-url-import',
  label: 'Claimweave URL import results',
  schemaVersion: '1',
  columns,
  parseFilters(raw) {
    const parsed = filtersSchema.safeParse(raw);
    return parsed.success ? { ok: true, value: parsed.data } : { ok: false };
  },
  async authorizeColumns() {
    return columnKeys;
  },
  keyOf: (row) => row.id,
  versionOf: (row) => `${row.status}:${row.error ?? ''}:${row.importedDocument?.id ?? ''}`,
  async readRows({ context, filters, limit }) {
    return prisma.$transaction(
      async (transaction) => {
        await transaction.$executeRaw`SET LOCAL statement_timeout = 30000`;
        const project = await transaction.claimweaveProject.findFirst({
          where: { id: filters.projectId, userId: context.actorId },
          select: { id: true },
        });
        if (!project) return [];
        return transaction.claimweaveUrlImportRow.findMany({
          where: { projectId: project.id, batchId: filters.batchId },
          orderBy: [{ rowNumber: 'asc' }, { id: 'asc' }],
          take: limit,
          select: {
            id: true,
            rowNumber: true,
            rawValue: true,
            normalizedUrl: true,
            status: true,
            error: true,
            projectId: true,
            importedDocument: { select: { id: true } },
          },
        });
      },
      { timeout: 30_000 },
    );
  },
});
