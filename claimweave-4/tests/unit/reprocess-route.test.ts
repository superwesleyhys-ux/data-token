// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findUnique, requireAuth, reprocessProject, ClaimweaveError } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  requireAuth: vi.fn(),
  reprocessProject: vi.fn(),
  ClaimweaveError: class ClaimweaveError extends Error {
    status: number;

    constructor(message: string, status = 422) {
      super(message);
      this.name = 'ClaimweaveError';
      this.status = status;
    }
  },
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ prisma: { claimweaveProject: { findUnique } } }));
vi.mock('@/lib/require-auth', () => ({ requireAuth }));
vi.mock('@/lib/business/claim-extraction', () => ({ ClaimweaveError, reprocessProject }));

import { POST } from '@/app/api/projects/[projectId]/reprocess/route';

const result = {
  projectId: 'project-1',
  documentId: 'document-1',
  sourceType: 'text' as const,
  sourceUrl: null,
  extractedAt: '2026-09-17T00:00:00.000Z',
  normalizedContentLength: 64,
  processingRoute: 'legacy-unknown' as const,
  processingTrace: null,
  claims: [
    {
      id: 'claim-1',
      projectId: 'project-1',
      text: 'A saved claim.',
      sourceSpan: { start: 0, end: 14, quote: 'A saved claim.' },
      citationLinks: [],
      sourceUrl: null,
      extractedAt: '2026-09-17T00:00:00.000Z',
    },
  ],
};

function request() {
  return new Request('http://test/api/projects/project-1/reprocess', { method: 'POST' });
}

function params() {
  return { params: Promise.resolve({ projectId: 'project-1' }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAuth.mockResolvedValue({ id: 'owner-1' });
  findUnique.mockResolvedValue({ userId: 'owner-1' });
  reprocessProject.mockResolvedValue(result);
});

describe('POST /api/projects/[projectId]/reprocess', () => {
  it('returns 401 when there is no session', async () => {
    requireAuth.mockRejectedValue(Response.json({ error: 'Unauthorized' }, { status: 401 }));

    const response = await POST(request(), params());

    expect(response.status).toBe(401);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown or non-owned project', async () => {
    findUnique.mockResolvedValueOnce(null);
    expect((await POST(request(), params())).status).toBe(404);

    findUnique.mockResolvedValueOnce({ userId: 'other-user' });
    expect((await POST(request(), params())).status).toBe(404);
    expect(reprocessProject).not.toHaveBeenCalled();
  });

  it('returns the validated project result for the owner', async () => {
    const response = await POST(request(), params());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(result);
    expect(reprocessProject).toHaveBeenCalledWith('project-1', 'owner-1');
  });

  it('returns the upstream processing failure without mutating authorization', async () => {
    reprocessProject.mockRejectedValue(new ClaimweaveError('AI unavailable', 502));

    const response = await POST(request(), params());

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: 'AI unavailable' });
  });
});
