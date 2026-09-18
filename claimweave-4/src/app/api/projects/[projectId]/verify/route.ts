// @polsia:user-owned — owner-protected single-project evidence verification boundary.
import 'server-only';

import { NextResponse } from 'next/server';
import {
  EvidenceVerificationError,
  getLatestVerification,
  updateMinimumSupportingSources,
  verifyProjectEvidence,
} from '@/lib/business/evidence-verification';
import {
  LatestVerificationResponse,
  VerificationPolicyResponse,
  VerificationPolicyUpdate,
  VerificationRequest,
  VerificationResponse,
} from '@/lib/contracts/evidence-verification';
import { requireAuth, type SessionUser } from '@/lib/require-auth';

export const dynamic = 'force-dynamic';

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
  try {
    const response = await getLatestVerification((await params).projectId, user.id);
    return NextResponse.json(LatestVerificationResponse.parse(response));
  } catch (error) {
    if (error instanceof EvidenceVerificationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: 'Could not load verification results.' }, { status: 500 });
  }
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
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    // An empty body uses the deterministic default.
  }
  const parsed = VerificationRequest.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Verification request is invalid.' },
      { status: 400 },
    );
  }
  try {
    const response = await verifyProjectEvidence((await params).projectId, user.id, parsed.data);
    return NextResponse.json(VerificationResponse.parse(response));
  } catch (error) {
    if (error instanceof EvidenceVerificationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: 'Verification failed unexpectedly.' }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  let user: SessionUser;
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
      { error: 'A minimum supporting source count is required.' },
      { status: 400 },
    );
  }
  const parsed = VerificationPolicyUpdate.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          parsed.error.issues[0]?.message ??
          'Minimum supporting sources must be an integer from 1 to 100.',
      },
      { status: 400 },
    );
  }

  try {
    const response = await updateMinimumSupportingSources(
      (await params).projectId,
      user.id,
      parsed.data.minimumSupportingSources,
    );
    return NextResponse.json(VerificationPolicyResponse.parse(response));
  } catch (error) {
    if (error instanceof EvidenceVerificationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: 'Could not save verification policy.' }, { status: 500 });
  }
}
