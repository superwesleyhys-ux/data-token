// @polsia:user-owned — authenticated API-key management route.
import 'server-only';

import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { generateApiKey } from '@/lib/api-key-auth';
import { ApiKeyCreate, ApiKeyCreateResponse, ApiKeyList } from '@/lib/contracts/api-keys';
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

export async function GET(request: Request) {
  let user: Awaited<ReturnType<typeof requireAuth>>;
  try {
    user = await requireAuth(request);
  } catch (response) {
    return response as Response;
  }

  try {
    const apiKeys = await prisma.apiKey.findMany({
      where: { userId: user.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return NextResponse.json(ApiKeyList.parse({ items: apiKeys.map(serializeApiKey) }));
  } catch {
    return NextResponse.json({ error: 'Could not load your API keys.' }, { status: 500 });
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
      { errors: { applicationName: 'Submit a JSON application name.' } },
      { status: 400 },
    );
  }

  const parsed = ApiKeyCreate.safeParse(body);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const [field, messages] of Object.entries(parsed.error.flatten().fieldErrors)) {
      if (messages?.[0]) errors[field] = messages[0];
    }
    return NextResponse.json({ errors }, { status: 400 });
  }

  const generated = generateApiKey();
  try {
    const apiKey = await prisma.apiKey.create({
      data: {
        userId: user.id,
        applicationName: parsed.data.applicationName,
        keyHash: generated.keyHash,
        keyPrefix: generated.keyPrefix,
      },
    });
    return NextResponse.json(
      ApiKeyCreateResponse.parse({
        apiKey: serializeApiKey(apiKey),
        secret: generated.secret,
      }),
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json(
        { error: 'Could not create a unique API key. Please try again.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: 'Could not create your API key.' }, { status: 500 });
  }
}
