// @polsia:user-owned — route-level auth and status coverage for grounded answers.
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createGroundedAnswer,
  findActiveApiKey,
  GroundedAnswerError,
  parseApiKeyAuthorization,
  prisma,
  requireAuth,
} = vi.hoisted(() => {
  class GroundedAnswerError extends Error {
    status: number;

    constructor(message: string, status = 500) {
      super(message);
      this.status = status;
    }
  }
  return {
    createGroundedAnswer: vi.fn(),
    findActiveApiKey: vi.fn(),
    GroundedAnswerError,
    parseApiKeyAuthorization: vi.fn(),
    prisma: { claimweaveProject: { findFirst: vi.fn() } },
    requireAuth: vi.fn(),
  };
});

vi.mock('server-only', () => ({}));
vi.mock('@/lib/business/grounded-answer', () => ({
  createGroundedAnswer,
  GroundedAnswerError,
}));
vi.mock('@/lib/api-key-auth', () => ({ findActiveApiKey, parseApiKeyAuthorization }));
vi.mock('@/lib/db', () => ({ prisma }));
vi.mock('@/lib/require-auth', () => ({ requireAuth }));

import { POST } from '@/app/api/projects/[projectId]/grounded-answer/route';

function request(body: string | object, authorization?: string) {
  return new Request('http://test/api/projects/project-1/grounded-answer', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      ...(authorization ? { authorization } : {}),
    },
  });
}

function params() {
  return { params: Promise.resolve({ projectId: 'project-1' }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAuth.mockResolvedValue({ id: 'owner-1' });
  parseApiKeyAuthorization.mockImplementation((value: string | null) =>
    value?.startsWith('Bearer cw_live_') ? value.slice('Bearer '.length) : null,
  );
  findActiveApiKey.mockImplementation(async (secret: string) =>
    secret === 'cw_live_valid-secret' ? { userId: 'owner-1' } : null,
  );
  prisma.claimweaveProject.findFirst.mockResolvedValue({ userId: 'owner-1' });
  createGroundedAnswer.mockResolvedValue({
    grounded: true,
    answer: 'Stored answer.',
    citations: [
      {
        claimId: 'claim-1',
        claimText: 'Stored claim.',
        excerpts: [
          {
            id: 'excerpt-1',
            passageId: 'passage-1',
            documentId: 'document-1',
            documentTitle: 'Evidence',
            role: 'supporting',
            text: 'Exact excerpt.',
            sourceUrl: 'https://evidence.example/1',
            evidenceDate: null,
          },
        ],
        citationUrls: ['https://evidence.example/1'],
      },
    ],
  });
});

describe('grounded-answer route', () => {
  it('returns 401 before parsing or reading for anonymous callers', async () => {
    requireAuth.mockRejectedValue(Response.json({ error: 'Unauthorized' }, { status: 401 }));

    const response = await POST(request('{'), params());

    expect(response.status).toBe(401);
    expect(createGroundedAnswer).not.toHaveBeenCalled();
    expect(prisma.claimweaveProject.findFirst).not.toHaveBeenCalled();
  });

  it('returns 401 for malformed, unknown, and revoked API keys before project reads', async () => {
    for (const authorization of [
      'Basic cw_live_valid-secret',
      'Bearer malformed',
      'Bearer cw_live_unknown-secret',
      'Bearer cw_live_revoked-secret',
    ]) {
      const response = await POST(request({ question: 'Question' }, authorization), params());

      expect(response.status).toBe(401);
    }

    expect(requireAuth).not.toHaveBeenCalled();
    expect(prisma.claimweaveProject.findFirst).not.toHaveBeenCalled();
    expect(createGroundedAnswer).not.toHaveBeenCalled();
  });

  it('accepts a valid API key without consulting the session', async () => {
    const response = await POST(
      request({ question: '  What is supported? ' }, 'Bearer cw_live_valid-secret'),
      params(),
    );

    expect(response.status).toBe(200);
    expect(requireAuth).not.toHaveBeenCalled();
    expect(findActiveApiKey).toHaveBeenCalledWith('cw_live_valid-secret');
    expect(createGroundedAnswer).toHaveBeenCalledWith('project-1', 'owner-1', 'What is supported?');
  });

  it('returns the project resource error before parsing the request body', async () => {
    prisma.claimweaveProject.findFirst.mockResolvedValueOnce(null);

    const response = await POST(request('{'), params());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Project not found.' });
    expect(createGroundedAnswer).not.toHaveBeenCalled();
  });

  it('masks a session mismatch and forbids an API-key mismatch', async () => {
    prisma.claimweaveProject.findFirst.mockResolvedValue({ userId: 'owner-2' });

    const sessionResponse = await POST(request({ question: 'Question' }), params());
    expect(sessionResponse.status).toBe(404);
    await expect(sessionResponse.json()).resolves.toEqual({ error: 'Project not found.' });

    const apiKeyResponse = await POST(
      request({ question: 'Question' }, 'Bearer cw_live_valid-secret'),
      params(),
    );
    expect(apiKeyResponse.status).toBe(403);
    await expect(apiKeyResponse.json()).resolves.toEqual({ error: 'Forbidden' });
    expect(createGroundedAnswer).not.toHaveBeenCalled();
  });

  it('forbids an API key from accessing an ownerless project', async () => {
    prisma.claimweaveProject.findFirst.mockResolvedValueOnce({ userId: null });

    const response = await POST(
      request({ question: 'Question' }, 'Bearer cw_live_valid-secret'),
      params(),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' });
    expect(createGroundedAnswer).not.toHaveBeenCalled();
  });

  it('returns 400 for malformed JSON and invalid questions', async () => {
    const malformed = await POST(request('{'), params());
    expect(malformed.status).toBe(400);

    const invalid = await POST(request({ question: '   ' }), params());
    expect(invalid.status).toBe(400);
    expect(createGroundedAnswer).not.toHaveBeenCalled();
  });

  it('passes the owner and path project to the business boundary', async () => {
    const response = await POST(request({ question: '  What is supported? ' }), params());

    expect(response.status).toBe(200);
    expect(createGroundedAnswer).toHaveBeenCalledWith('project-1', 'owner-1', 'What is supported?');
  });

  it.each([
    [404, 'Project not found.'],
    [503, 'Grounded answers are not configured.'],
    [502, 'Grounded answer generation failed.'],
  ])('maps business error %s without exposing evidence', async (status, message) => {
    createGroundedAnswer.mockRejectedValueOnce(new GroundedAnswerError(message, status));

    const response = await POST(request({ question: 'Question' }), params());

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error: message });
  });
});
