// @polsia:user-owned — owner-protected project reprocessing boundary.
import 'server-only';

import { NextResponse } from 'next/server';
import { ClaimweaveError, reprocessProject } from '@/lib/business/claim-extraction';
import { ProjectResult } from '@/lib/contracts/claims';
import { prisma } from '@/lib/db';
import { requireAuth, type SessionUser } from '@/lib/require-auth';

export const dynamic = 'force-dynamic';

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
  let project: { userId: string | null } | null;
  try {
    project = await prisma.claimweaveProject.findUnique({
      where: { id: projectId },
      select: { userId: true },
    });
  } catch {
    return NextResponse.json({ error: 'Could not reprocess this project.' }, { status: 500 });
  }
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }

  try {
    const result = await reprocessProject(projectId, user.id);
    return NextResponse.json(ProjectResult.parse(result));
  } catch (error) {
    if (error instanceof ClaimweaveError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: 'Claim reprocessing failed. Please try again.' },
      { status: 500 },
    );
  }
}
