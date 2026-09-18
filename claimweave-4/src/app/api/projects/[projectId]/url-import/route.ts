// @polsia:user-owned — owner-scoped CSV Import endpoint for project URLs.

import 'server-only';

import { NextResponse } from 'next/server';
import { claimweaveUrlImportTarget } from '@/lib/csv-import/claimweave-url-import.server';
import { prisma } from '@/lib/db';
import { requireAuth, type SessionUser } from '@/lib/require-auth';
import { siteUrl } from '@/lib/site';
import { createCsvImportHandlers, type ImportContext } from '@/modules/csv-import/server';

export const dynamic = 'force-dynamic';

async function ownerContext(
  request: Request,
  projectId: string,
): Promise<ImportContext | Response> {
  let user: SessionUser;
  try {
    user = await requireAuth(request);
  } catch (response) {
    return response as Response;
  }
  const project = await prisma.claimweaveProject.findFirst({
    where: { id: projectId, userId: user.id },
    select: { id: true },
  });
  if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  return { actorId: user.id, scopeId: projectId };
}

function handlers(context: ImportContext) {
  return createCsvImportHandlers({
    targets: [claimweaveUrlImportTarget],
    authorize: async () => context,
    allowedOrigin: new URL(siteUrl).origin,
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const context = await ownerContext(request, projectId);
  if (context instanceof Response) return context;
  return handlers(context).GET(request);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const context = await ownerContext(request, projectId);
  if (context instanceof Response) return context;
  return handlers(context).POST(request);
}
