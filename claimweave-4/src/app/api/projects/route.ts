// @polsia:user-owned — Claimweave project list and creation boundary.
import 'server-only';

import { NextResponse } from 'next/server';
import { ClaimweaveError, createQueuedProject } from '@/lib/business/claim-extraction';
import { attachFirstProjectId, recordFirstProjectStarted } from '@/lib/business/journey';
import { JourneyEntryPoint, JourneyVisitorId } from '@/lib/contracts/journey';
import { ProjectCreate, ProjectIntakeResponse, ProjectList } from '@/lib/contracts/projects';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/require-auth';

export const dynamic = 'force-dynamic';

function readJourneyHeaders(request: Request) {
  const visitorId = JourneyVisitorId.safeParse(
    request.headers.get('x-claimweave-visitor-id') ?? undefined,
  );
  const entryPoint = JourneyEntryPoint.safeParse(
    request.headers.get('x-claimweave-entry-point') ?? undefined,
  );
  return {
    visitorId: visitorId.success ? visitorId.data : undefined,
    entryPoint: entryPoint.success ? entryPoint.data : undefined,
  };
}

function validationErrors(result: ReturnType<typeof ProjectCreate.safeParse>) {
  if (result.success) return {};
  const flattened = result.error.flatten();
  const errors: Record<string, string> = {};
  for (const [field, messages] of Object.entries(flattened.fieldErrors)) {
    if (messages?.[0]) errors[field] = messages[0];
  }
  if (Object.keys(errors).length === 0) {
    const message = flattened.formErrors[0] ?? 'Submit exactly one source.';
    errors.url = message;
    errors.text = message;
  }
  return errors;
}

export async function GET(request: Request) {
  let user: Awaited<ReturnType<typeof requireAuth>>;
  try {
    user = await requireAuth(request);
  } catch (response) {
    return response as Response;
  }

  try {
    const projects = await prisma.claimweaveProject.findMany({
      where: { userId: user.id },
      include: { source: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const response = ProjectList.parse({
      items: projects.flatMap((project) =>
        project.source
          ? [
              {
                id: project.id,
                sourceType: project.source.url ? 'url' : 'text',
                sourceUrl: project.source.url,
                createdAt: project.createdAt.toISOString(),
                status: project.source.status,
              },
            ]
          : [],
      ),
    });
    return NextResponse.json(response);
  } catch {
    return NextResponse.json({ error: 'Could not load your projects.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let user: Awaited<ReturnType<typeof requireAuth>>;
  try {
    user = await requireAuth(request);
  } catch (response) {
    return response as Response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { errors: { url: 'Submit a URL or pasted text.', text: 'Submit a URL or pasted text.' } },
      { status: 400 },
    );
  }
  const parsed = ProjectCreate.safeParse(body);
  if (!parsed.success)
    return NextResponse.json({ errors: validationErrors(parsed) }, { status: 400 });
  const journey = readJourneyHeaders(request);
  if (journey.visitorId) {
    try {
      await recordFirstProjectStarted(journey.visitorId, journey.entryPoint);
    } catch {
      // Anonymous telemetry must never block a project submission.
    }
  }
  try {
    const result = await createQueuedProject(parsed.data, user.id);
    if (journey.visitorId) {
      try {
        await attachFirstProjectId(journey.visitorId, result.projectId);
      } catch {
        // The project is already saved; telemetry can be retried only by a later request.
      }
    }
    return NextResponse.json(ProjectIntakeResponse.parse(result), { status: 201 });
  } catch (error) {
    if (error instanceof ClaimweaveError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: 'Claim extraction failed. Please try again.' },
      { status: 500 },
    );
  }
}
