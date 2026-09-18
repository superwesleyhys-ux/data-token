// @polsia:user-owned — authenticated API-key route coverage.
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { create, findFirst, findMany, generateApiKey, requireAuth, updateMany } = vi.hoisted(() => ({
  create: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
  generateApiKey: vi.fn(),
  requireAuth: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ prisma: { apiKey: { create, findFirst, findMany, updateMany } } }));
vi.mock('@/lib/require-auth', () => ({ requireAuth }));
vi.mock('@/lib/api-key-auth', () => ({ generateApiKey }));

import { DELETE } from '@/app/api/api-keys/[id]/route';
import { GET, POST } from '@/app/api/api-keys/route';
import { ApiKeyList } from '@/lib/contracts/api-keys';

const createdAt = new Date('2026-09-18T12:00:00.000Z');
const active = {
  id: 'key-1',
  userId: 'owner-1',
  applicationName: 'Reporting dashboard',
  keyHash: 'hash-only',
  keyPrefix: 'cw_live_12345678',
  createdAt,
  revokedAt: null,
};

function request(body?: unknown) {
  return new Request('http://test/api/api-keys', {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function deleteRequest() {
  return new Request('http://test/api/api-keys/key-1', { method: 'DELETE' });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAuth.mockResolvedValue({ id: 'owner-1' });
  findMany.mockResolvedValue([active]);
  findFirst.mockResolvedValue(active);
  updateMany.mockResolvedValue({ count: 1 });
  generateApiKey.mockReturnValue({
    secret: 'cw_live_one-time-secret',
    keyHash: 'hash-only',
    keyPrefix: active.keyPrefix,
  });
  create.mockResolvedValue(active);
});

describe('GET /api/api-keys', () => {
  it('rejects anonymous reads before querying', async () => {
    requireAuth.mockRejectedValue(Response.json({ error: 'Unauthorized' }, { status: 401 }));
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('scopes reads to the current owner and never serializes the hash', async () => {
    const response = await GET(request());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(findMany).toHaveBeenCalledWith({
      where: { userId: 'owner-1' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    expect(() => ApiKeyList.parse(body)).not.toThrow();
    expect(body.items[0]).not.toHaveProperty('keyHash');
    expect(body.items[0]).not.toHaveProperty('secret');
  });
});

describe('POST /api/api-keys', () => {
  it('returns field errors for invalid and malformed input', async () => {
    const invalid = await POST(request({ applicationName: '' }));
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({
      errors: { applicationName: expect.any(String) },
    });

    const malformed = await POST(
      new Request('http://test/api/api-keys', { method: 'POST', body: '{' }),
    );
    expect(malformed.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('persists only the hash and returns the raw secret once', async () => {
    const response = await POST(request({ applicationName: 'Reporting dashboard' }));
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledWith({
      data: {
        userId: 'owner-1',
        applicationName: 'Reporting dashboard',
        keyHash: 'hash-only',
        keyPrefix: active.keyPrefix,
      },
    });
    expect(body.secret).toBe('cw_live_one-time-secret');
    expect(body.apiKey).not.toHaveProperty('keyHash');
  });
});

describe('DELETE /api/api-keys/:id', () => {
  it('rejects anonymous revocation and never queries', async () => {
    requireAuth.mockRejectedValue(Response.json({ error: 'Unauthorized' }, { status: 401 }));
    const response = await DELETE(deleteRequest(), { params: Promise.resolve({ id: 'key-1' }) });
    expect(response.status).toBe(401);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('returns 404 for a foreign or unknown key', async () => {
    findFirst.mockResolvedValue(null);
    const response = await DELETE(deleteRequest(), { params: Promise.resolve({ id: 'foreign' }) });
    expect(response.status).toBe(404);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('revokes an owner key and makes repeated revocation harmless', async () => {
    const revoked = { ...active, revokedAt: new Date('2026-09-18T12:01:00.000Z') };
    findFirst.mockResolvedValueOnce(active).mockResolvedValueOnce(revoked);
    const response = await DELETE(deleteRequest(), { params: Promise.resolve({ id: 'key-1' }) });
    expect(response.status).toBe(200);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'key-1', userId: 'owner-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    await expect(response.json()).resolves.toMatchObject({
      apiKey: { revokedAt: revoked.revokedAt.toISOString() },
    });

    vi.clearAllMocks();
    requireAuth.mockResolvedValue({ id: 'owner-1' });
    findFirst.mockResolvedValue(revoked);
    const repeated = await DELETE(deleteRequest(), { params: Promise.resolve({ id: 'key-1' }) });
    expect(repeated.status).toBe(200);
    expect(updateMany).not.toHaveBeenCalled();
  });
});
