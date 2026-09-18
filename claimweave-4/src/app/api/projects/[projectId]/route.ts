// @polsia:user-owned — owner-scoped project processing status boundary.
import 'server-only';

import { NextResponse } from 'next/server';
import { ProjectWorkspaceStatus } from '@/lib/contracts/projects';
import { prisma } from '@/lib/db';
import { requireAuth, type SessionUser } from '@/lib/require-auth';

export const dynamic = 'force-dynamic';

function statusResponse(project: {
  id: string;
  createdAt: Date;
  source: { url: string | null; status: string; processingError: string | null } | null;
}) {
  if (!project.source) return null;
  return ProjectWorkspaceStatus.parse({
    projectId: project.id,
    sourceType: project.source.url ? 'url' : 'text',
    sourceUrl: project.source.url,
    createdAt: project.createdAt.toISOString(),
    status: project.source.status,
    error: project.source.status === 'failed' ? project.source.processingError : null,
  });
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
    const project = await prisma.claimweaveProject.findFirst({
      where: { id: projectId, userId: user.id },
      select: {
        id: true,
        createdAt: true,
        source: {
          select: { url: true, status: true, processingError: true },
        },
      },
    });
    const response = project ? statusResponse(project) : null;
    if (!response) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
    return NextResponse.json(response);
  } catch {
    return NextResponse.json({ error: 'Could not load project status.' }, { status: 500 });
  }
}
