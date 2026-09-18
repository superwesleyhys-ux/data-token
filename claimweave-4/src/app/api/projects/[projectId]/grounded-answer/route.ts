// @polsia:user-owned — protected citation-ready grounded answer endpoint.
import 'server-only';

import { NextResponse } from 'next/server';
import { findActiveApiKey, parseApiKeyAuthorization } from '@/lib/api-key-auth';
import { createGroundedAnswer, GroundedAnswerError } from '@/lib/business/grounded-answer';
import { GroundedAnswerRequest, GroundedAnswerResponse } from '@/lib/contracts/grounded-answer';
import { prisma } from '@/lib/db';
import { requireAuth, type SessionUser } from '@/lib/require-auth';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const authorization = request.headers.get('authorization');
  let ownerId: string;
  let apiKeyPrincipal = false;

  if (authorization !== null) {
    const presentedSecret = parseApiKeyAuthorization(authorization);
    if (!presentedSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const apiKey = await findActiveApiKey(presentedSecret);
    if (!apiKey) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    ownerId = apiKey.userId;
    apiKeyPrincipal = true;
  } else {
    let user: SessionUser;
    try {
      user = await requireAuth(request);
    } catch (response) {
      return response as Response;
    }
    ownerId = user.id;
  }

  let existingProject: { userId: string | null } | null;
  try {
    existingProject = await prisma.claimweaveProject.findFirst({
      where: { id: projectId },
      select: { userId: true },
    });
  } catch {
    return NextResponse.json({ error: 'Could not create a grounded answer.' }, { status: 500 });
  }
  if (!existingProject) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }
  if (existingProject.userId !== ownerId) {
    return apiKeyPrincipal
      ? NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      : NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Grounded answer request is invalid.' }, { status: 400 });
  }
  const parsed = GroundedAnswerRequest.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Grounded answer request is invalid.' },
      { status: 400 },
    );
  }

  try {
    const response = await createGroundedAnswer(projectId, ownerId, parsed.data.question);
    return NextResponse.json(GroundedAnswerResponse.parse(response));
  } catch (error) {
    if (error instanceof GroundedAnswerError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: 'Could not create a grounded answer.' }, { status: 500 });
  }
}
