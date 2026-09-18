// @polsia:user-owned — owner-scoped persisted URL import status.

import 'server-only';

import type { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { UrlImportStatus } from '@/lib/contracts/claimweave-url-import';
import { prisma } from '@/lib/db';
import { requireAuth, type SessionUser } from '@/lib/require-auth';

export const dynamic = 'force-dynamic';

type RowWithDocument = Prisma.ClaimweaveUrlImportRowGetPayload<{
  include: { importedDocument: { include: { claims: { select: { id: true } } } } };
}>;

function rowResponse(row: RowWithDocument) {
  return {
    id: row.id,
    rowNumber: row.rowNumber,
    rawValue: row.rawValue,
    normalizedUrl: row.normalizedUrl,
    status: row.status,
    error: row.error,
    processingStartedAt: row.processingStartedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    failedAt: row.failedAt?.toISOString() ?? null,
    documentId: row.importedDocument?.id ?? null,
    claimCount: row.importedDocument?.claims.length ?? 0,
    extractedAt: row.importedDocument?.extractedAt.toISOString() ?? null,
  };
}

export async function GET(
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
  try {
    const ownsProject = await prisma.claimweaveProject.findFirst({
      where: { id: projectId, userId: user.id },
      select: { id: true },
    });
    if (!ownsProject) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
    const batches = await prisma.claimweaveUrlImportBatch.findMany({
      where: { projectId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        rows: {
          orderBy: [{ rowNumber: 'asc' }, { id: 'asc' }],
          include: { importedDocument: { include: { claims: { select: { id: true } } } } },
        },
      },
    });
    return NextResponse.json(
      UrlImportStatus.parse({
        batches: batches.map((batch) => ({
          id: batch.id,
          createdAt: batch.createdAt.toISOString(),
          totalRows: batch.totalRows,
          acceptedRows: batch.acceptedRows,
          errorRows: batch.errorRows,
          status: batch.status,
          rows: batch.rows.map(rowResponse),
        })),
      }),
    );
  } catch {
    return NextResponse.json({ error: 'Could not load URL import status.' }, { status: 500 });
  }
}
