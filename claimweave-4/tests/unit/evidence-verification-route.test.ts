// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireAuth,
  verifyProjectEvidence,
  getLatestVerification,
  updateMinimumSupportingSources,
  findFirst,
} = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  verifyProjectEvidence: vi.fn(),
  getLatestVerification: vi.fn(),
  updateMinimumSupportingSources: vi.fn(),
  findFirst: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/require-auth', () => ({ requireAuth }));
vi.mock('@/lib/db', () => ({ prisma: { claimweaveProject: { findFirst } } }));
vi.mock('@/lib/business/evidence-verification', () => ({
  EvidenceVerificationError: class EvidenceVerificationError extends Error {
    status: number;

    constructor(message: string, status = 422) {
      super(message);
      this.name = 'EvidenceVerificationError';
      this.status = status;
    }
  },
  verifyProjectEvidence,
  getLatestVerification,
  updateMinimumSupportingSources,
}));

import { GET, PATCH, POST } from '@/app/api/projects/[projectId]/verify/route';
import { EvidenceVerificationError } from '@/lib/business/evidence-verification';

const verification = {
  minimumSupportingSources: 1,
  verification: {
    id: 'run-1',
    projectId: 'project-1',
    startedAt: '2026-09-18T12:00:00.000Z',
    completedAt: '2026-09-18T12:00:00.000Z',
    mode: 'deterministic' as const,
    policyVersion: 'independence-v1/freshness-365d',
    status: 'completed' as const,
    accuracy: null,
    outcomeSummary: {
      supported: 2,
      contradicted: 1,
      noIndependentEvidence: 1,
    },
    results: [],
  },
};

function request(body?: unknown, method?: 'POST' | 'PATCH') {
  return new Request('http://test/api/projects/project-1/verify', {
    method: body === undefined ? 'GET' : (method ?? 'POST'),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
  });
}

function params() {
  return { params: Promise.resolve({ projectId: 'project-1' }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAuth.mockResolvedValue({ id: 'owner-1' });
  verifyProjectEvidence.mockResolvedValue(verification);
  getLatestVerification.mockResolvedValue({ verification: null, minimumSupportingSources: 1 });
  updateMinimumSupportingSources.mockResolvedValue({ minimumSupportingSources: 2 });
  findFirst.mockResolvedValue({ id: 'project-1' });
});

describe('protected evidence verification routes', () => {
  it('returns 401 before reading an anonymous verification request', async () => {
    requireAuth.mockRejectedValue(Response.json({ error: 'Unauthorized' }, { status: 401 }));

    const response = await POST(request({ mode: 'deterministic' }), params());

    expect(response.status).toBe(401);
    expect(verifyProjectEvidence).not.toHaveBeenCalled();
  });

  it('returns a 404 for an unknown or non-owned project from the service', async () => {
    const serviceError = new EvidenceVerificationError('Project not found.', 404);
    verifyProjectEvidence.mockRejectedValue(serviceError);

    const response = await POST(request({ mode: 'deterministic' }), params());

    expect(response.status).toBe(404);
  });

  it('validates the mode and persists the owner-scoped deterministic result', async () => {
    const invalid = await POST(request({ mode: 'mock' }), params());
    expect(invalid.status).toBe(400);

    const response = await POST(request({ mode: 'deterministic' }), params());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(verification);
    expect(verifyProjectEvidence).toHaveBeenCalledWith('project-1', 'owner-1', {
      mode: 'deterministic',
    });
  });

  it('returns the latest persisted result through GET', async () => {
    getLatestVerification.mockResolvedValue(verification);

    const response = await GET(request(), params());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(verification);
    expect(getLatestVerification).toHaveBeenCalledWith('project-1', 'owner-1');
  });

  it('validates and persists the owner-scoped minimum source threshold through PATCH', async () => {
    for (const value of [0, -1, 1.5, 101, '2', undefined]) {
      const body = value === undefined ? {} : { minimumSupportingSources: value };
      const response = await PATCH(request(body, 'PATCH'), params());
      expect(response.status).toBe(400);
    }
    expect(updateMinimumSupportingSources).not.toHaveBeenCalled();

    const response = await PATCH(request({ minimumSupportingSources: 2 }, 'PATCH'), params());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ minimumSupportingSources: 2 });
    expect(updateMinimumSupportingSources).toHaveBeenCalledWith('project-1', 'owner-1', 2);
  });

  it('returns 401 before reading or updating an anonymous policy request', async () => {
    requireAuth.mockRejectedValue(Response.json({ error: 'Unauthorized' }, { status: 401 }));

    const response = await PATCH(request({ minimumSupportingSources: 2 }, 'PATCH'), params());

    expect(response.status).toBe(401);
    expect(updateMinimumSupportingSources).not.toHaveBeenCalled();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('keeps the non-disclosing 404 boundary for an unknown or foreign policy project', async () => {
    updateMinimumSupportingSources.mockRejectedValue(
      new EvidenceVerificationError('Project not found.', 404),
    );

    const response = await PATCH(request({ minimumSupportingSources: 2 }, 'PATCH'), params());

    expect(response.status).toBe(404);
  });
});
