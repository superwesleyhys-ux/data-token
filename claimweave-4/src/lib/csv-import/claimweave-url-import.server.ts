// @polsia:user-owned — CSV Import destination adapter for project URL intake.

import 'server-only';

import { Prisma } from '@prisma/client';
import { normalizeImportUrl } from '@/lib/business/claimweave-url-import';
import { prisma } from '@/lib/db';
import type { CsvInput, ImportCounts } from '@/modules/csv-import/contracts';
import { mapCsv, parseCsv } from '@/modules/csv-import/parser';
import {
  CsvImportError,
  type CsvServerTarget,
  defineCsvTarget,
  type ImportContext,
} from '@/modules/csv-import/server';
import { type RowValidation, validateRows } from '@/modules/csv-import/validation';

type UrlRow = { url: string };

function urlIssueMessage(message: string) {
  if (message === 'Cette clé métier est répétée dans le fichier.') {
    return 'This URL is repeated in this file.';
  }
  if (message.includes('obligatoire')) return 'URL is required.';
  return message;
}

const urlFields = [
  {
    key: 'url',
    label: 'URL',
    required: true,
    aliases: ['url', 'website', 'source', 'source_url'],
    example: 'https://example.com/article',
  },
];

function parseUrlRow(raw: Record<string, string>): RowValidation<UrlRow> {
  const validation = normalizeImportUrl(raw.url ?? '');
  return validation.ok
    ? { ok: true, value: { url: validation.normalizedUrl } }
    : { ok: false, issues: [{ field: 'url', message: validation.message }] };
}

function keyOf(row: UrlRow) {
  return row.url;
}

const baseTarget = defineCsvTarget({
  id: 'claimweave-url-intake',
  label: 'project URL intake',
  fields: urlFields,
  parseRow: parseUrlRow,
  keyOf,
  async findExistingKeys(keys, context) {
    const existing = await prisma.claimweaveUrlImportEntry.findMany({
      where: { projectId: context.scopeId, normalizedUrl: { in: [...keys] } },
      select: { normalizedUrl: true },
    });
    return existing.map((entry) => entry.normalizedUrl);
  },
  async insertNewRows(rows, _context): Promise<ImportCounts> {
    return { created: rows.length, skipped: 0 };
  },
});

function inputRows(input: CsvInput) {
  try {
    const parsed = parseCsv(input.csv, input.delimiter);
    const mapped = mapCsv(parsed, urlFields, input.mapping);
    return {
      mapped,
      validation: validateRows(mapped, { fields: urlFields, parseRow: parseUrlRow, keyOf }),
    };
  } catch (error) {
    throw new CsvImportError(
      400,
      'INVALID_CSV',
      error instanceof Error ? error.message : 'The CSV file is invalid.',
    );
  }
}

async function commitUrlBatch(input: CsvInput, context: ImportContext): Promise<ImportCounts> {
  const { mapped, validation } = inputRows(input);
  const candidateUrls = validation.rows.map((row) => row.key);
  const existing = new Set(
    (
      await prisma.claimweaveUrlImportEntry.findMany({
        where: { projectId: context.scopeId, normalizedUrl: { in: candidateUrls } },
        select: { normalizedUrl: true },
      })
    ).map((entry) => entry.normalizedUrl),
  );
  const issuesByRecord = new Map<number, string[]>();
  for (const issue of validation.issues) {
    if (issue.record === null) continue;
    const issues = issuesByRecord.get(issue.record) ?? [];
    issues.push(urlIssueMessage(issue.message));
    issuesByRecord.set(issue.record, issues);
  }
  const validatedByRecord = new Map(validation.rows.map((row) => [row.record, row]));
  const rows = mapped.map((row) => {
    const validated = validatedByRecord.get(row.record);
    const normalizedUrl =
      validated?.value.url ??
      (() => {
        const parsed = normalizeImportUrl(row.values.url ?? '');
        return parsed.ok ? parsed.normalizedUrl : null;
      })();
    const rowIssues = issuesByRecord.get(row.record) ?? [];
    if (validated && existing.has(validated.key)) {
      rowIssues.push('This URL is already imported in this project.');
    }
    const error = rowIssues.length > 0 ? [...new Set(rowIssues)].join(' ') : null;
    return {
      rowNumber: row.record,
      rawValue: row.values.url ?? '',
      normalizedUrl,
      status: error ? 'error' : 'queued',
      error,
      accepted: !error,
    } as const;
  });
  const accepted = rows.filter((row) => row.accepted);

  try {
    await prisma.$transaction(async (tx) => {
      const batch = await tx.claimweaveUrlImportBatch.create({
        data: {
          projectId: context.scopeId,
          totalRows: rows.length,
          acceptedRows: accepted.length,
          errorRows: rows.length - accepted.length,
          status: accepted.length > 0 ? 'queued' : 'completed',
        },
        select: { id: true },
      });
      const persistedRows = rows.map((row) => ({ ...row, id: crypto.randomUUID() }));
      await tx.claimweaveUrlImportRow.createMany({
        data: persistedRows.map((row) => ({
          id: row.id,
          batchId: batch.id,
          projectId: context.scopeId,
          rowNumber: row.rowNumber,
          rawValue: row.rawValue,
          normalizedUrl: row.normalizedUrl,
          status: row.status,
          error: row.error,
        })),
      });
      await tx.claimweaveUrlImportEntry.createMany({
        data: persistedRows
          .filter((row) => row.accepted)
          .map((row) => ({
            projectId: context.scopeId,
            batchId: batch.id,
            rowId: row.id,
            normalizedUrl: row.normalizedUrl as string,
          })),
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new CsvImportError(
        409,
        'URL_CONFLICT',
        'One or more URLs were imported by another request. Check the saved status and retry the remaining rows.',
      );
    }
    throw error;
  }

  return { created: accepted.length, skipped: rows.length - accepted.length };
}

export const claimweaveUrlImportTarget: CsvServerTarget = {
  ...baseTarget,
  async preview(input, context) {
    const preview = await baseTarget.preview(input, context);
    return {
      ...preview,
      issues: preview.issues.map((issue) => ({
        ...issue,
        message: urlIssueMessage(issue.message),
      })),
    };
  },
  commit: commitUrlBatch,
};
