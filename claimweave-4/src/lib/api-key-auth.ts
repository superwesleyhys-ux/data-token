// @polsia:user-owned — server-only API-key verification seam.
//
// Claims export consumers present the full secret as:
// Authorization: Bearer cw_live_<base64url>
import 'server-only';

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { prisma } from '@/lib/db';

export const API_KEY_PREFIX = 'cw_live_';

const API_KEY_AUTHORIZATION = /^Bearer (cw_live_[A-Za-z0-9_-]+)$/;

type GeneratedApiKey = {
  secret: string;
  keyHash: string;
  keyPrefix: string;
};

export function hashApiKey(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

export function parseApiKeyAuthorization(value: string | null): string | null {
  return value ? (API_KEY_AUTHORIZATION.exec(value)?.[1] ?? null) : null;
}

export function generateApiKey(entropy?: Uint8Array): GeneratedApiKey {
  const encoded = Buffer.from(entropy ?? randomBytes(32)).toString('base64url');
  const secret = `${API_KEY_PREFIX}${encoded}`;
  return {
    secret,
    keyHash: hashApiKey(secret),
    keyPrefix: secret.slice(0, API_KEY_PREFIX.length + 8),
  };
}

export async function findActiveApiKey(presentedSecret: string) {
  const keyHash = hashApiKey(presentedSecret);
  const record = await prisma.apiKey.findFirst({
    where: { keyHash, revokedAt: null },
  });
  if (!record) return null;

  // Keep a constant-time comparison at the verification seam even though the
  // indexed hash lookup already identifies the row.
  const expected = Buffer.from(record.keyHash, 'hex');
  const actual = Buffer.from(keyHash, 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  return record;
}
