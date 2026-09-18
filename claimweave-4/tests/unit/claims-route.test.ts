// @polsia:user-owned — focused contract tests for the claims export route.
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  claimFindFirst,
  claimFindMany,
  claimCount,
  claimUpdate,
  claimUpdateMany,
  prismaTransaction,
  apiKeyFindFirst,
  findFirst,
  getLatestVerification,
  recordClaimsViewReached,
  requireAuth,
} = vi.hoisted(() => ({
  claimFindFirst: vi.fn(),
  claimFindMany: vi.fn(),
  claimCount: vi.fn(),
  claimUpdate: vi.fn(),
  claimUpdateMany: vi.fn(),
  prismaTransaction: vi.fn(),
  apiKeyFindFirst: vi.fn(),
  findFirst: vi.fn(),
  getLatestVerification: vi.fn(),
  recordClaimsViewReached: vi.fn(),
  requireAuth: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({
  prisma: {
    apiKey: { findFirst: apiKeyFindFirst },
    claimweaveClaim: {
      count: claimCount,
      findFirst: claimFindFirst,
      findMany: claimFindMany,
      update: claimUpdate,
      updateMany: claimUpdateMany,
    },
    claimweaveProject: { findFirst },
    $transaction: prismaTransaction,
  },
}));
vi.mock('@/lib/require-auth', () => ({ requireAuth }));
vi.mock('@/lib/business/evidence-verification', () => ({ getLatestVerification }));
vi.mock('@/lib/business/journey', () => ({ recordClaimsViewReached }));

import { GET, PATCH } from '@/app/api/projects/[projectId]/claims/route';
import { hashApiKey } from '@/lib/api-key-auth';
import { traceForProcessingRoute } from '@/lib/contracts/local-first';

const extractedAt = '2026-09-18T12:00:00.000Z';
const validApiKeySecret = 'cw_live_valid-secret';
const sourceUrl = 'https://example.com/source';
const storedTrace = {
  ...traceForProcessingRoute('model-fallback'),
  modelCallCount: 1,
  providerUsage: {
    attempts: 1,
    inputTokens: 120,
    outputTokens: 24,
    totalTokens: 144,
    costUsd: 0.0012,
  },
  latencyMs: 84,
  transferredBytes: 2048,
};

const project = {
  id: 'project-1',
  userId: 'owner-1',
  source: {
    id: 'source-1',
    url: sourceUrl,
    documentText: null,
    normalizedContent: 'The source passage.',
    extractedAt: new Date(extractedAt),
    processingRoute: 'model-fallback',
    processingTrace: storedTrace,
    claims: [
      {
        id: 'claim-1',
        text: 'The source passage.',
        sourceStart: 0,
        sourceEnd: 19,
        sourceQuote: 'The source passage.',
        citationLinks: [sourceUrl],
        sourceUrl,
        extractedAt: new Date(extractedAt),
        approvalStatus: 'pending',
        reviewedAt: null,
        reviewerId: null,
      },
    ],
  },
};

const verification = {
  verification: {
    id: 'run-1',
    projectId: 'project-1',
    startedAt: extractedAt,
    completedAt: extractedAt,
    mode: 'deterministic' as const,
    policyVersion: 'independence-v1/freshness-365d',
    status: 'completed' as const,
    accuracy: null,
    results: [
      {
        id: 'result-1',
        claimId: 'claim-1',
        classification: 'supported' as const,
        freshness: 'fresh' as const,
        verifiedAt: extractedAt,
        errorState: null,
        excerpts: [
          {
            id: 'excerpt-1',
            passageId: 'passage-1',
            documentId: 'evidence-1',
            documentTitle: 'Independent source',
            role: 'supporting' as const,
            text: 'The independent evidence supports the passage.',
            sourceUrl: 'https://example.com/evidence',
            evidenceDate: extractedAt,
          },
        ],
      },
    ],
  },
};

function request() {
  return new Request('http://test/api/projects/project-1/claims');
}

function params() {
  return { params: Promise.resolve({ projectId: 'project-1' }) };
}

function activeApiKey(userId: string) {
  return { userId, keyHash: hashApiKey(validApiKeySecret) };
}

function mockOwnedProject(value: unknown) {
  findFirst.mockReset();
  findFirst.mockResolvedValueOnce({ userId: 'owner-1' }).mockResolvedValueOnce(value);
  const source = (value as { source?: { claims?: unknown[] } } | null)?.source;
  claimCount.mockResolvedValue(source?.claims?.length ?? 0);
  claimFindMany.mockResolvedValue(source?.claims ?? []);
}

beforeEach(() => {
  vi.clearAllMocks();
  findFirst.mockReset();
  apiKeyFindFirst.mockReset();
  requireAuth.mockResolvedValue({ id: 'owner-1' });
  findFirst.mockResolvedValueOnce({ userId: 'owner-1' }).mockResolvedValueOnce(project);
  apiKeyFindFirst.mockResolvedValue(null);
  getLatestVerification.mockResolvedValue(verification);
  claimCount.mockResolvedValue(1);
  claimFindMany.mockResolvedValue(project.source.claims);
  claimFindFirst.mockResolvedValue({ id: 'claim-1' });
  claimUpdate.mockResolvedValue({
    id: 'claim-1',
    approvalStatus: 'approved',
    reviewedAt: new Date(extractedAt),
    reviewerId: 'owner-1',
  });
  claimUpdateMany.mockResolvedValue({ count: 1 });
  prismaTransaction.mockImplementation(async (callback: (transaction: unknown) => unknown) =>
    callback({ claimweaveClaim: { updateMany: claimUpdateMany } }),
  );
});

describe('GET /api/projects/[projectId]/claims', () => {
  it('returns 401 before querying for anonymous callers', async () => {
    requireAuth.mockRejectedValue(Response.json({ error: 'Unauthorized' }, { status: 401 }));

    const response = await GET(request(), params());

    expect(response.status).toBe(401);
    expect(findFirst).not.toHaveBeenCalled();
    expect(getLatestVerification).not.toHaveBeenCalled();
  });

  it.each([
    ['unknown', null, null],
    ['foreign', { userId: 'other-owner' }, null],
    ['source-less', { userId: 'owner-1' }, { ...project, source: null }],
  ])('returns 404 for a %s project', async (_label, existing, value) => {
    findFirst.mockReset();
    findFirst.mockResolvedValueOnce(existing).mockResolvedValueOnce(value);

    const response = await GET(request(), params());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Project not found.' });
    expect(getLatestVerification).not.toHaveBeenCalled();
  });

  it('queries by both project id and authenticated owner id', async () => {
    await GET(request(), params());

    expect(findFirst).toHaveBeenNthCalledWith(1, {
      where: { id: 'project-1' },
      select: { userId: true },
    });
    expect(findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: 'project-1', userId: 'owner-1' },
        include: {
          source: {
            select: {
              id: true,
              url: true,
              documentText: true,
              normalizedContent: true,
              extractedAt: true,
              processingRoute: true,
              processingTrace: true,
            },
          },
        },
      }),
    );
    expect(claimCount).toHaveBeenCalledWith({ where: { sourceId: 'source-1' } });
    expect(claimFindMany).toHaveBeenCalledWith({
      where: { sourceId: 'source-1' },
      orderBy: [{ sourceStart: 'asc' }, { id: 'asc' }],
      skip: 0,
      take: 50,
      select: {
        id: true,
        text: true,
        sourceStart: true,
        sourceEnd: true,
        sourceQuote: true,
        citationLinks: true,
        sourceUrl: true,
        extractedAt: true,
        approvalStatus: true,
        reviewedAt: true,
        reviewerId: true,
      },
    });
  });

  it.each([
    'page=',
    'page=0',
    'page=-1',
    'page=1.5',
    'pageSize=',
    'pageSize=0',
    'pageSize=-1',
    'pageSize=1.5',
    'pageSize=101',
  ])('rejects invalid pagination query %s without reading claims', async (query) => {
    const response = await GET(
      new Request(`http://test/api/projects/project-1/claims?${query}`),
      params(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid pagination parameters.',
    });
    expect(claimCount).not.toHaveBeenCalled();
    expect(claimFindMany).not.toHaveBeenCalled();
    expect(getLatestVerification).not.toHaveBeenCalled();
  });

  it('uses bounded pagination and keeps the stable claim ordering', async () => {
    claimCount.mockResolvedValue(201);

    const response = await GET(
      new Request('http://test/api/projects/project-1/claims?page=2&pageSize=100'),
      params(),
    );

    expect(response.status).toBe(200);
    expect(claimFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sourceId: 'source-1' },
        orderBy: [{ sourceStart: 'asc' }, { id: 'asc' }],
        skip: 100,
        take: 100,
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      pagination: {
        page: 2,
        pageSize: 100,
        total: 201,
        totalPages: 3,
        hasNextPage: true,
        hasPreviousPage: true,
      },
    });
  });

  it('applies conjunctive approval, verification, and contradiction filters before pagination', async () => {
    const claims = [
      { ...project.source.claims[0], id: 'claim-pending' },
      { ...project.source.claims[0], id: 'claim-approved', approvalStatus: 'approved' },
      { ...project.source.claims[0], id: 'claim-rejected', approvalStatus: 'rejected' },
    ];
    mockOwnedProject({ ...project, source: { ...project.source, claims } });
    claimFindMany
      .mockResolvedValueOnce(claims.map(({ id }) => ({ id })))
      .mockResolvedValueOnce([claims[1]]);
    claimCount.mockResolvedValue(1);
    getLatestVerification.mockResolvedValue({
      verification: {
        ...verification.verification,
        results: [
          {
            ...verification.verification.results[0],
            claimId: 'claim-approved',
            classification: 'contradicted',
            excerpts: [
              {
                ...verification.verification.results[0]?.excerpts[0],
                role: 'contradicting',
              },
            ],
          },
          {
            ...verification.verification.results[0],
            id: 'result-rejected',
            claimId: 'claim-rejected',
            classification: 'supported',
            excerpts: [],
          },
        ],
      },
    });

    const response = await GET(
      new Request(
        'http://test/api/projects/project-1/claims?approvalStatus=approved&verificationStatus=contradicted&contradictionStatus=found',
      ),
      params(),
    );

    expect(response.status).toBe(200);
    expect(claimCount).toHaveBeenCalledWith({
      where: {
        sourceId: 'source-1',
        approvalStatus: 'approved',
        id: { in: ['claim-approved'] },
      },
    });
    expect(claimFindMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          sourceId: 'source-1',
          approvalStatus: 'approved',
          id: { in: ['claim-approved'] },
        },
        skip: 0,
        take: 50,
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      pagination: { total: 1 },
      claims: [{ id: 'claim-approved', approvalStatus: 'approved', verificationStatus: 'contradicted' }],
    });
  });

  it('returns a truthful empty result for an inverse or contradiction filter with no matches', async () => {
    const claims = [project.source.claims[0]];
    mockOwnedProject({ ...project, source: { ...project.source, claims } });
    claimFindMany
      .mockResolvedValueOnce([{ id: 'claim-1' }])
      .mockResolvedValueOnce([]);
    claimCount.mockResolvedValue(0);
    getLatestVerification.mockResolvedValue({ verification: null });

    const response = await GET(
      new Request(
        'http://test/api/projects/project-1/claims?verificationStatus=supported&contradictionStatus=found',
      ),
      params(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      pagination: { total: 0, totalPages: 0 },
      claims: [],
    });
    expect(claimCount).toHaveBeenCalledWith({
      where: { sourceId: 'source-1', id: { in: [] } },
    });
  });

  it.each([
    'approvalStatus=approved&approvalStatus=rejected',
    'verificationStatus=',
    'verificationStatus=unknown',
    'contradictionStatus=unknown',
  ])('rejects invalid claim filters before verification or claim reads: %s', async (query) => {
    const response = await GET(
      new Request(`http://test/api/projects/project-1/claims?${query}`),
      params(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid claims query parameters.' });
    expect(getLatestVerification).not.toHaveBeenCalled();
    expect(claimCount).not.toHaveBeenCalled();
    expect(claimFindMany).not.toHaveBeenCalled();
  });

  it('returns the unchanged export for a valid API key owner', async () => {
    apiKeyFindFirst.mockResolvedValue(activeApiKey('owner-1'));

    const response = await GET(
      new Request('http://test/api/projects/project-1/claims', {
        headers: { authorization: `Bearer ${validApiKeySecret}` },
      }),
      params(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      projectId: 'project-1',
      documentId: 'source-1',
      sourceType: 'url',
      sourceUrl,
      extractedAt,
      normalizedContentLength: 19,
      processingRoute: 'model-fallback',
      processingTrace: storedTrace,
      pagination: {
        page: 1,
        pageSize: 50,
        total: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
      claims: [
        {
          id: 'claim-1',
          projectId: 'project-1',
          text: 'The source passage.',
          sourceSpan: { start: 0, end: 19, quote: 'The source passage.' },
          sourcePassage: 'The source passage.',
          citationLinks: [sourceUrl],
          citationTargets: [
            {
              url: sourceUrl,
              href: `${sourceUrl}#:~:text=The%20source%20passage.`,
              status: 'available',
              reason: 'located',
            },
          ],
          sourceUrl,
          extractedAt,
          evidenceExcerpts: verification.verification.results[0]?.excerpts ?? [],
          verificationStatus: 'supported',
          approvalStatus: 'pending',
          reviewedAt: null,
          reviewerId: null,
        },
      ],
    });
    expect(getLatestVerification).toHaveBeenCalledWith('project-1', 'owner-1');
    expect(requireAuth).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed', 'Basic cw_live_valid-secret'],
    ['unknown', 'Bearer cw_live_unknown-secret'],
    ['revoked', 'Bearer cw_live_revoked-secret'],
  ])(
    'returns 401 before project reads for an explicit %s API key',
    async (_label, authorization) => {
      const response = await GET(
        new Request('http://test/api/projects/project-1/claims', { headers: { authorization } }),
        params(),
      );

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
      expect(findFirst).not.toHaveBeenCalled();
      expect(getLatestVerification).not.toHaveBeenCalled();
      expect(requireAuth).not.toHaveBeenCalled();
    },
  );

  it('returns 403 for a valid key targeting a known foreign project before source reads', async () => {
    apiKeyFindFirst.mockResolvedValue(activeApiKey('key-owner'));
    findFirst.mockReset();
    findFirst.mockResolvedValueOnce({ userId: 'project-owner' });

    const response = await GET(
      new Request('http://test/api/projects/project-1/claims', {
        headers: { authorization: `Bearer ${validApiKeySecret}` },
      }),
      params(),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' });
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'project-1' },
      select: { userId: true },
    });
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(getLatestVerification).not.toHaveBeenCalled();
  });

  it('returns 403 for a valid key targeting an ownerless project', async () => {
    apiKeyFindFirst.mockResolvedValue(activeApiKey('key-owner'));
    findFirst.mockReset();
    findFirst.mockResolvedValueOnce({ userId: null });

    const response = await GET(
      new Request('http://test/api/projects/project-1/claims', {
        headers: { authorization: `Bearer ${validApiKeySecret}` },
      }),
      params(),
    );

    expect(response.status).toBe(403);
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(getLatestVerification).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown project with a valid API key', async () => {
    apiKeyFindFirst.mockResolvedValue(activeApiKey('key-owner'));
    findFirst.mockReset();
    findFirst.mockResolvedValueOnce(null);

    const response = await GET(
      new Request('http://test/api/projects/unknown/claims', {
        headers: { authorization: `Bearer ${validApiKeySecret}` },
      }),
      { params: Promise.resolve({ projectId: 'unknown' }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Project not found.' });
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(getLatestVerification).not.toHaveBeenCalled();
  });

  it('returns persisted route measurements and the latest completed verification data', async () => {
    const response = await GET(request(), params());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      projectId: 'project-1',
      documentId: 'source-1',
      sourceType: 'url',
      sourceUrl,
      extractedAt,
      normalizedContentLength: 19,
      processingRoute: 'model-fallback',
      processingTrace: storedTrace,
      pagination: {
        page: 1,
        pageSize: 50,
        total: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
      claims: [
        {
          id: 'claim-1',
          projectId: 'project-1',
          text: 'The source passage.',
          sourceSpan: { start: 0, end: 19, quote: 'The source passage.' },
          sourcePassage: 'The source passage.',
          citationLinks: [sourceUrl],
          citationTargets: [
            {
              url: sourceUrl,
              href: `${sourceUrl}#:~:text=The%20source%20passage.`,
              status: 'available',
              reason: 'located',
            },
          ],
          sourceUrl,
          extractedAt,
          evidenceExcerpts: verification.verification.results[0]?.excerpts ?? [],
          verificationStatus: 'supported',
          approvalStatus: 'pending',
          reviewedAt: null,
          reviewerId: null,
        },
      ],
    });
    expect(getLatestVerification).toHaveBeenCalledWith('project-1', 'owner-1');
    expect(recordClaimsViewReached).not.toHaveBeenCalled();
  });

  it('serializes a persisted approval decision without dropping claim evidence or provenance', async () => {
    const reviewedAt = '2026-09-18T13:30:00.000Z';
    mockOwnedProject({
      ...project,
      source: {
        ...project.source,
        claims: [
          {
            ...project.source.claims[0],
            approvalStatus: 'approved',
            reviewedAt: new Date(reviewedAt),
            reviewerId: 'reviewer-1',
          },
        ],
      },
    });

    const response = await GET(request(), params());
    const body = (await response.json()) as { claims: Array<Record<string, unknown>> };

    expect(response.status).toBe(200);
    expect(body.claims[0]).toMatchObject({
      id: 'claim-1',
      text: 'The source passage.',
      sourceSpan: { start: 0, end: 19, quote: 'The source passage.' },
      sourcePassage: 'The source passage.',
      citationLinks: [sourceUrl],
      citationTargets: [
        {
          url: sourceUrl,
          href: `${sourceUrl}#:~:text=The%20source%20passage.`,
          status: 'available',
          reason: 'located',
        },
      ],
      sourceUrl,
      extractedAt,
      evidenceExcerpts: verification.verification.results[0]?.excerpts ?? [],
      verificationStatus: 'supported',
      approvalStatus: 'approved',
      reviewedAt,
      reviewerId: 'reviewer-1',
    });
  });

  it('derives only route-level trace facts when no trace was persisted', async () => {
    mockOwnedProject({
      ...project,
      source: { ...project.source, processingTrace: null },
    });

    const response = await GET(request(), params());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      processingRoute: 'model-fallback',
      processingTrace: traceForProcessingRoute('model-fallback'),
    });
  });

  it.each([
    ['legacy route', 'legacy-unknown', storedTrace],
    ['invalid route', 'not-a-route', storedTrace],
  ])(
    'normalizes %s to unavailable metadata without dropping claims',
    async (_label, route, trace) => {
      mockOwnedProject({
        ...project,
        source: { ...project.source, processingRoute: route, processingTrace: trace },
      });

      const response = await GET(request(), params());
      const body = (await response.json()) as {
        processingRoute: string | null;
        processingTrace: unknown;
        claims: unknown[];
      };

      expect(response.status).toBe(200);
      expect(body.processingRoute).toBeNull();
      expect(body.processingTrace).toBeNull();
      expect(body.claims).toHaveLength(1);
    },
  );

  it('ignores malformed persisted trace JSON for a known route', async () => {
    mockOwnedProject({
      ...project,
      source: { ...project.source, processingTrace: { modelCallCount: 'unknown' } },
    });

    const response = await GET(request(), params());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      processingRoute: 'model-fallback',
      processingTrace: traceForProcessingRoute('model-fallback'),
    });
  });

  it('returns explicit empty verification fields when no completed run exists', async () => {
    getLatestVerification.mockResolvedValue({ verification: null });

    const response = await GET(request(), params());
    const body = (await response.json()) as { claims: Array<Record<string, unknown>> };

    expect(response.status).toBe(200);
    const firstClaim = body.claims[0];
    expect(firstClaim).toBeDefined();
    if (!firstClaim) throw new Error('Expected one claim in the export.');
    expect(firstClaim).toMatchObject({
      evidenceExcerpts: [],
      verificationStatus: null,
      approvalStatus: 'pending',
      reviewedAt: null,
      reviewerId: null,
    });
  });

  it('uses documentText for a legacy source and returns an unchanged fallback when the quote is stale', async () => {
    const staleQuote = 'A passage that is no longer present.';
    mockOwnedProject({
      ...project,
      source: {
        ...project.source,
        normalizedContent: null,
        documentText: 'The legacy source still has different content.',
        claims: [{ ...project.source.claims[0], sourceQuote: staleQuote, sourceEnd: staleQuote.length }],
      },
    });

    const response = await GET(request(), params());
    const body = (await response.json()) as {
      claims: Array<{ citationTargets: unknown[]; citationLinks: string[] }>;
    };

    expect(response.status).toBe(200);
    expect(body.claims[0]).toMatchObject({
      citationLinks: [sourceUrl],
      citationTargets: [
        {
          url: sourceUrl,
          href: sourceUrl,
          status: 'fallback',
          reason: 'quote-not-found',
        },
      ],
    });
  });
});

function patchRequest(body: unknown) {
  return new Request('http://test/api/projects/project-1/claims', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function malformedPatchRequest() {
  return new Request('http://test/api/projects/project-1/claims', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: '{',
  });
}

describe('PATCH /api/projects/[projectId]/claims', () => {
  it('rejects API-key credentials without reading a claim', async () => {
    const response = await PATCH(
      new Request('http://test/api/projects/project-1/claims', {
        method: 'PATCH',
        headers: {
          authorization: 'Bearer cw_live_valid-secret',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ claimId: 'claim-1', status: 'approved' }),
      }),
      params(),
    );

    expect(response.status).toBe(401);
    expect(claimFindFirst).not.toHaveBeenCalled();
    expect(claimUpdate).not.toHaveBeenCalled();
    expect(requireAuth).not.toHaveBeenCalled();
  });

  it('returns 401 before reading a claim for anonymous callers', async () => {
    requireAuth.mockRejectedValue(Response.json({ error: 'Unauthorized' }, { status: 401 }));

    const response = await PATCH(
      patchRequest({ claimId: 'claim-1', status: 'approved' }),
      params(),
    );

    expect(response.status).toBe(401);
    expect(claimFindFirst).not.toHaveBeenCalled();
    expect(claimUpdate).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON and invalid review input before claim lookup', async () => {
    const malformed = await PATCH(malformedPatchRequest(), params());
    const invalidStatus = await PATCH(
      patchRequest({ claimId: 'claim-1', status: 'pending' }),
      params(),
    );
    const missingClaimId = await PATCH(patchRequest({ status: 'rejected' }), params());

    expect(malformed.status).toBe(400);
    expect(invalidStatus.status).toBe(400);
    expect(missingClaimId.status).toBe(400);
    expect(claimFindFirst).not.toHaveBeenCalled();
  });

  it.each(['unknown', 'foreign', 'ownerless', 'source-less'])(
    'returns 404 for a %s claim boundary',
    async () => {
      claimFindFirst.mockResolvedValue(null);

      const response = await PATCH(
        patchRequest({ claimId: 'claim-1', status: 'approved' }),
        params(),
      );

      expect(response.status).toBe(404);
      expect(claimUpdate).not.toHaveBeenCalled();
    },
  );

  it('queries through project ownership and persists an approval decision', async () => {
    const response = await PATCH(
      patchRequest({ claimId: 'claim-1', status: 'approved' }),
      params(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      claimId: 'claim-1',
      approvalStatus: 'approved',
      reviewedAt: extractedAt,
      reviewerId: 'owner-1',
    });
    expect(claimFindFirst).toHaveBeenCalledWith({
      where: {
        id: 'claim-1',
        source: { project: { id: 'project-1', userId: 'owner-1' } },
      },
      select: { id: true },
    });
    expect(claimUpdate).toHaveBeenCalledWith({
      where: { id: 'claim-1' },
      data: {
        approvalStatus: 'approved',
        reviewedAt: expect.any(Date),
        reviewerId: 'owner-1',
      },
      select: { id: true, approvalStatus: true, reviewedAt: true, reviewerId: true },
    });
  });

  it('allows a later rejection and returns a persistence failure as 500', async () => {
    claimUpdate.mockResolvedValue({
      id: 'claim-1',
      approvalStatus: 'rejected',
      reviewedAt: new Date(extractedAt),
      reviewerId: 'owner-1',
    });
    const rejection = await PATCH(
      patchRequest({ claimId: 'claim-1', status: 'rejected' }),
      params(),
    );
    expect(rejection.status).toBe(200);
    await expect(rejection.json()).resolves.toMatchObject({
      claimId: 'claim-1',
      approvalStatus: 'rejected',
      reviewerId: 'owner-1',
    });

    claimUpdate.mockRejectedValue(new Error('database unavailable'));
    const failed = await PATCH(patchRequest({ claimId: 'claim-1', status: 'approved' }), params());
    expect(failed.status).toBe(500);
    await expect(failed.json()).resolves.toEqual({ error: 'Could not save the claim review.' });
  });

  it('atomically approves every scoped claim in a valid bulk request', async () => {
    claimFindMany.mockResolvedValue([{ id: 'claim-1' }, { id: 'claim-2' }]);
    claimUpdateMany.mockResolvedValue({ count: 2 });

    const response = await PATCH(
      patchRequest({ claimIds: ['claim-1', 'claim-2'], status: 'approved' }),
      params(),
    );
    const body = (await response.json()) as {
      claimIds: string[];
      reviewedAt: string;
      reviewerId: string;
    };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      claimIds: ['claim-1', 'claim-2'],
      reviewerId: 'owner-1',
    });
    const transactionUpdate = claimUpdateMany.mock.calls[0]?.[0] as {
      where: unknown;
      data: { approvalStatus: string; reviewedAt: Date; reviewerId: string };
    };
    expect(transactionUpdate).toEqual({
      where: {
        id: { in: ['claim-1', 'claim-2'] },
        source: { project: { id: 'project-1', userId: 'owner-1' } },
      },
      data: {
        approvalStatus: 'approved',
        reviewedAt: expect.any(Date),
        reviewerId: 'owner-1',
      },
    });
    expect(new Date(body.reviewedAt).getTime()).toBe(transactionUpdate.data.reviewedAt.getTime());
    expect(prismaTransaction).toHaveBeenCalledTimes(1);
  });

  it('supports bulk rejection and rejects an unknown or foreign claim before mutation', async () => {
    claimFindMany.mockResolvedValue([{ id: 'claim-1' }]);

    const response = await PATCH(
      patchRequest({ claimIds: ['claim-1', 'claim-foreign'], status: 'rejected' }),
      params(),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Claim not found.' });
    expect(claimUpdateMany).not.toHaveBeenCalled();
    expect(prismaTransaction).not.toHaveBeenCalled();
    expect(claimFindMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['claim-1', 'claim-foreign'] },
        source: { project: { id: 'project-1', userId: 'owner-1' } },
      },
      select: { id: true },
    });
  });

  it('atomically rejects every scoped claim in a valid bulk request', async () => {
    claimFindMany.mockResolvedValue([{ id: 'claim-1' }, { id: 'claim-2' }]);
    claimUpdateMany.mockResolvedValue({ count: 2 });

    const response = await PATCH(
      patchRequest({ claimIds: ['claim-1', 'claim-2'], status: 'rejected' }),
      params(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      claimIds: ['claim-1', 'claim-2'],
      approvalStatus: 'rejected',
      reviewerId: 'owner-1',
    });
  });

  it.each([
    { claimIds: [], status: 'approved' },
    { claimIds: ['claim-1', 'claim-1'], status: 'approved' },
    { claimIds: ['claim-1'], status: 'pending' },
  ])('rejects malformed bulk review input before claim lookup', async (body) => {
    const response = await PATCH(patchRequest(body), params());

    expect(response.status).toBe(400);
    expect(claimFindMany).not.toHaveBeenCalled();
    expect(claimUpdateMany).not.toHaveBeenCalled();
  });

  it('does not report success when the bulk transaction fails', async () => {
    claimFindMany.mockResolvedValue([{ id: 'claim-1' }, { id: 'claim-2' }]);
    claimUpdateMany.mockRejectedValue(new Error('database unavailable'));

    const response = await PATCH(
      patchRequest({ claimIds: ['claim-1', 'claim-2'], status: 'rejected' }),
      params(),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Could not save the claim review.' });
  });
});
