// @polsia:user-owned — owner-scoped URL-import CSV download.

import 'server-only';

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { csvExportSources } from '@/lib/csv-export/sources.server';
import { prisma } from '@/lib/db';
import { requireAuth, type SessionUser } from '@/lib/require-auth';
import {
  CSV_EXPORT_ERRORS,
  CsvExportError,
  exportResponseSchema,
} from '@/modules/csv-export/contracts';

export const dynamic = 'force-dynamic';

const requestSchema = z.object({ batchId: z.string().trim().min(1).max(128) }).strict();
const sourceId = 'claimweave-url-import';

function errorResponse(error: unknown) {
  const code =
    error instanceof CsvExportError && error.code in CSV_EXPORT_ERRORS ? error.code : 'READ_FAILED';
  return NextResponse.json(
    { ok: false, error: { code, message: CSV_EXPORT_ERRORS[code].message } },
    { status: CSV_EXPORT_ERRORS[code].status, headers: { 'cache-control': 'no-store' } },
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  let user: SessionUser;
  try {
    user = await requireAuth(request);
  } catch (response) {
    return response as Response;
  }

  const { projectId } = await params;
  const project = await prisma.claimweaveProject.findFirst({
    where: { id: projectId, userId: user.id },
    select: { id: true },
  });
  if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: 'INVALID_REQUEST', message: CSV_EXPORT_ERRORS.INVALID_REQUEST.message },
      },
      { status: CSV_EXPORT_ERRORS.INVALID_REQUEST.status },
    );
  }

  const batch = await prisma.claimweaveUrlImportBatch.findFirst({
    where: { id: parsed.data.batchId, projectId: project.id },
    select: { id: true },
  });
  if (!batch) return NextResponse.json({ error: 'Batch not found.' }, { status: 404 });

  const source = csvExportSources.find((candidate) => candidate.id === sourceId);
  if (!source) return errorResponse(new CsvExportError('INVALID_SOURCE'));

  try {
    const result = await source.export(
      {
        filters: { projectId: project.id, batchId: batch.id },
        columns: [
          'submitted_url',
          'normalized_url',
          'validation_status',
          'processing_status',
          'error_message',
          'project_reference',
          'document_reference',
        ],
        delimiter: ',',
      },
      { actorId: user.id, scopeId: project.id },
      request.signal,
    );
    return NextResponse.json(
      exportResponseSchema.parse({
        ok: true,
        data: {
          ...result,
          filename: `claimweave-url-import-${batch.id.slice(-8)}.csv`,
        },
      }),
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
