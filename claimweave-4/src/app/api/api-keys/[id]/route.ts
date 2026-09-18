// @polsia:user-owned — authenticated owner-scoped API-key revocation route.
import 'server-only';

import { NextResponse } from 'next/server';
import { ApiKeyRevokeResponse } from '@/lib/contracts/api-keys';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/require-auth';

export const dynamic = 'force-dynamic';

function serializeApiKey(apiKey: {
  id: string;
  applicationName: string;
  keyPrefix: string;
  createdAt: Date;
  revokedAt: Date | null;
}) {
  return {
    id: apiKey.id,
    applicationName: apiKey.applicationName,
    keyPrefix: apiKey.keyPrefix,
    createdAt: apiKey.createdAt.toISOString(),
    revokedAt: apiKey.revokedAt?.toISOString() ?? null,
  };
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let user: Awaited<ReturnType<typeof requireAuth>>;
  try {
    user = await requireAuth(request);
  } catch (response) {
    return response as Response;
  }

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'API key not found.' }, { status: 404 });

  try {
    const existing = await prisma.apiKey.findFirst({ where: { id, userId: user.id } });
    if (!existing) return NextResponse.json({ error: 'API key not found.' }, { status: 404 });

    if (!existing.revokedAt) {
      await prisma.apiKey.updateMany({
        where: { id, userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    const revoked = await prisma.apiKey.findFirst({ where: { id, userId: user.id } });
    if (!revoked) return NextResponse.json({ error: 'API key not found.' }, { status: 404 });
    return NextResponse.json(ApiKeyRevokeResponse.parse({ apiKey: serializeApiKey(revoked) }));
  } catch {
    return NextResponse.json({ error: 'Could not revoke your API key.' }, { status: 500 });
  }
}
