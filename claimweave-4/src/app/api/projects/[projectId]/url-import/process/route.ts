// @polsia:user-owned — authenticated single-row URL processing boundary.
import 'server-only';

import type { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { ClaimweaveError, processUrlImportRow } from '@/lib/business/claim-extraction';
import {
  UrlImportProcessRequest,
  UrlImportProcessResponse,
} from '@/lib/contracts/claimweave-url-import';
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

function processError(error: unknown) {
  if (error instanceof ClaimweaveError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json({ error: 'URL processing failed. Please try again.' }, { status: 500 });
}

async function claimRow(
  projectId: string,
  rowId: string | undefined,
  batchId: string | undefined,
  retry: boolean,
) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.claimweaveUrlImportRow.findFirst({
      where: {
        projectId,
        ...(rowId ? { id: rowId } : {}),
        ...(batchId ? { batchId } : {}),
        ...(rowId ? {} : { status: 'queued', normalizedUrl: { not: null } }),
      },
      include: { importedDocument: { include: { claims: { select: { id: true } } } } },
      orderBy: [{ rowNumber: 'asc' }, { id: 'asc' }],
    });
    if (!row) return { kind: 'missing' as const };

    if (retry) {
      if (row.status === 'completed') {
        return { kind: 'terminal' as const, row };
      }
      if (row.status !== 'failed') return { kind: 'conflict' as const, row };

      const claimed = await tx.claimweaveUrlImportRow.updateMany({
        where: { id: row.id, projectId, batchId: row.batchId, status: 'failed' },
        data: {
          status: 'processing',
          processingStartedAt: new Date(),
          error: null,
          failedAt: null,
          completedAt: null,
        },
      });
      if (claimed.count !== 1) return { kind: 'conflict' as const, row };
      await tx.claimweaveUrlImportBatch.update({
        where: { id: row.batchId },
        data: { status: 'processing' },
      });
      return { kind: 'claimed' as const, rowId: row.id };
    }

    if (row.status !== 'queued') {
      return {
        kind: row.status === 'completed' || row.status === 'failed' ? 'terminal' : 'conflict',
        row,
      } as const;
    }
    if (!row.normalizedUrl) return { kind: 'conflict' as const, row };

    const claimed = await tx.claimweaveUrlImportRow.updateMany({
      where: { id: row.id, projectId, status: 'queued' },
      data: { status: 'processing', processingStartedAt: new Date(), error: null },
    });
    if (claimed.count !== 1) return { kind: 'conflict' as const, row };
    await tx.claimweaveUrlImportBatch.update({
      where: { id: row.batchId },
      data: { status: 'processing' },
    });
    return { kind: 'claimed' as const, rowId: row.id };
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  let user: SessionUser;
  let claimedRowId: string | null = null;
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

  const parsed = UrlImportProcessRequest.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid URL processing request.' }, { status: 400 });
  }

  try {
    const claim = await claimRow(
      projectId,
      parsed.data.rowId,
      parsed.data.batchId,
      parsed.data.retry,
    );
    if (claim.kind === 'missing') {
      return NextResponse.json({ error: 'No queued URL row was found.' }, { status: 404 });
    }
    if (claim.kind === 'terminal') {
      return NextResponse.json(UrlImportProcessResponse.parse({ row: rowResponse(claim.row) }));
    }
    if (claim.kind === 'conflict') {
      return NextResponse.json(
        { error: 'This URL row is already being processed or is not processable.' },
        { status: 409 },
      );
    }
    if (!claim.rowId) {
      return NextResponse.json({ error: 'No queued URL row was found.' }, { status: 404 });
    }
    claimedRowId = claim.rowId;

    const processed = await processUrlImportRow({
      rowId: claim.rowId,
      projectId,
      ownerId: user.id,
    });
    return NextResponse.json(UrlImportProcessResponse.parse({ row: rowResponse(processed) }));
  } catch (error) {
    if (claimedRowId) {
      const failedRow = await prisma.claimweaveUrlImportRow.findFirst({
        where: { id: claimedRowId, projectId, status: 'failed' },
        include: { importedDocument: { include: { claims: { select: { id: true } } } } },
      });
      if (failedRow) {
        return NextResponse.json(UrlImportProcessResponse.parse({ row: rowResponse(failedRow) }));
      }
    }
    return processError(error);
  }
}
