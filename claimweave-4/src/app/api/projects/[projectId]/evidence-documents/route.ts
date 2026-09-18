// @polsia:user-owned — owner-scoped secondary evidence submission boundary.
import 'server-only';

import { NextResponse } from 'next/server';
import {
  createEvidenceDocument,
  EvidenceVerificationError,
  listEvidenceDocuments,
} from '@/lib/business/evidence-verification';
import {
  EvidenceDocumentCreate,
  EvidenceDocumentList,
} from '@/lib/contracts/evidence-verification';
import { requireAuth, type SessionUser } from '@/lib/require-auth';

export const dynamic = 'force-dynamic';

async function readProjectId(params: Promise<{ projectId: string }>) {
  return (await params).projectId;
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
  try {
    const documents = await listEvidenceDocuments(await readProjectId(params), user.id);
    return NextResponse.json(EvidenceDocumentList.parse(documents));
  } catch (error) {
    if (error instanceof EvidenceVerificationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: 'Could not load submitted evidence.' }, { status: 500 });
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
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Submit a JSON evidence document.' }, { status: 400 });
  }
  const parsed = EvidenceDocumentCreate.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Evidence document is invalid.' },
      { status: 400 },
    );
  }
  try {
    const document = await createEvidenceDocument(
      await readProjectId(params),
      user.id,
      parsed.data,
    );
    return NextResponse.json(document, { status: 201 });
  } catch (error) {
    if (error instanceof EvidenceVerificationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: 'Could not save submitted evidence.' }, { status: 500 });
  }
}
