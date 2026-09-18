// @polsia:user-owned — authenticated project processing trigger.
import 'server-only';

import { NextResponse } from 'next/server';
import {
  ClaimweaveError,
  claimProjectForProcessing,
  markProjectProcessingFailed,
  processExistingProject,
} from '@/lib/business/claim-extraction';
import { ProjectProcessRequest, ProjectWorkspaceStatus } from '@/lib/contracts/projects';
import { prisma } from '@/lib/db';
import { requireAuth, type SessionUser } from '@/lib/require-auth';

export const dynamic = 'force-dynamic';

async function readStatus(projectId: string, ownerId: string) {
  const project = await prisma.claimweaveProject.findFirst({
    where: { id: projectId, userId: ownerId },
    select: {
      id: true,
      createdAt: true,
      source: { select: { url: true, status: true, processingError: true } },
    },
  });
  if (!project?.source) return null;
  return ProjectWorkspaceStatus.parse({
    projectId: project.id,
    sourceType: project.source.url ? 'url' : 'text',
    sourceUrl: project.source.url,
    createdAt: project.createdAt.toISOString(),
    status: project.source.status,
    error: project.source.status === 'failed' ? project.source.processingError : null,
  });
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
  const parsed = ProjectProcessRequest.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid processing request.' }, { status: 400 });
  }

  try {
    const claim = await claimProjectForProcessing(projectId, user.id, parsed.data.retry);
    if (claim.kind === 'complete') {
      const status = await readStatus(projectId, user.id);
      return status
        ? NextResponse.json(status)
        : NextResponse.json({ error: 'Project not found.' }, { status: 404 });
    }
    if (claim.kind === 'failed') {
      return NextResponse.json(
        { error: claim.error ?? 'Processing failed. Try again.' },
        { status: 422 },
      );
    }
    if (claim.kind === 'conflict') {
      return NextResponse.json(
        { error: 'This project is already being processed.' },
        { status: 409 },
      );
    }

    try {
      await processExistingProject({
        projectId,
        ownerId: user.id,
        processingClaim: claim.token,
      });
    } catch (error) {
      const failure = await markProjectProcessingFailed(projectId, user.id, claim.token, error);
      if (failure.status === 404 || failure.status === 409) {
        return NextResponse.json({ error: failure.message }, { status: failure.status });
      }
      return NextResponse.json({ error: failure.message }, { status: 422 });
    }

    const status = await readStatus(projectId, user.id);
    return status
      ? NextResponse.json(status)
      : NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  } catch (error) {
    if (error instanceof ClaimweaveError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: 'Project processing failed.' }, { status: 500 });
  }
}
