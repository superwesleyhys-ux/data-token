// @polsia:user-owned — focused authorization and serialization tests for project history.
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findFirst, findMany, requireAuth } = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
  requireAuth: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({
  prisma: {
    claimweaveProject: { findFirst },
    claimweaveRevision: { findMany },
  },
}));
vi.mock('@/lib/require-auth', () => ({ requireAuth }));

import { GET } from '@/app/api/projects/[projectId]/history/route';
import { ProjectHistory } from '@/lib/contracts/project-history';

const firstDate = new Date('2026-09-17T12:00:00.000Z');
const secondDate = new Date('2026-09-18T12:00:00.000Z');

const project = {
  id: 'project-1',
  source: {
    claims: [
      { id: 'claim-current', sourceStart: 0, sourceEnd: 12 },
      { id: 'claim-added', sourceStart: 20, sourceEnd: 27 },
    ],
  },
  processingRuns: [
    {
      id: 'run-1',
      version: 1,
      documentId: 'document-1',
      documentKind: 'primary',
      evidenceState: 'complete',
      processingRoute: 'model-fallback',
      createdAt: firstDate,
      snapshots: [
        {
          id: 'snapshot-before',
          text: 'Before text',
          sourceStart: 0,
          sourceEnd: 12,
          sourceQuote: 'Before text',
          sourceUrl: null,
          citationLinks: [],
          createdAt: firstDate,
        },
        {
          id: 'snapshot-removed',
          text: 'Removed text',
          sourceStart: 40,
          sourceEnd: 52,
          sourceQuote: 'Removed text',
          sourceUrl: null,
          citationLinks: [],
          createdAt: firstDate,
        },
      ],
    },
    {
      id: 'run-2',
      version: 2,
      documentId: 'document-1',
      documentKind: 'primary',
      evidenceState: 'needs-review',
      processingRoute: 'trusted-server-reuse',
      createdAt: secondDate,
      snapshots: [
        {
          id: 'snapshot-after',
          text: 'After text',
          sourceStart: 0,
          sourceEnd: 12,
          sourceQuote: 'After text',
          sourceUrl: null,
          citationLinks: [],
          createdAt: secondDate,
        },
        {
          id: 'snapshot-added',
          text: 'Added text',
          sourceStart: 20,
          sourceEnd: 27,
          sourceQuote: 'Added text',
          sourceUrl: null,
          citationLinks: [],
          createdAt: secondDate,
        },
      ],
    },
  ],
};

const revision = {
  id: 'revision-1',
  projectId: 'project-1',
  ownerId: 'owner-1',
  version: 1,
  eventKind: 'ingestion',
  createdAt: firstDate,
  documentSnapshots: [
    {
      id: 'document-revision-1',
      documentId: 'document-1',
      documentKind: 'primary',
      createdAt: firstDate,
      previous: null,
      current: {
        id: 'document-1',
        kind: 'primary',
        url: 'https://example.com/source',
        documentText: null,
        normalizedContent: 'Saved source content.',
        status: 'complete',
        processingRoute: 'model-fallback',
        processingTrace: null,
        extractedAt: firstDate.toISOString(),
      },
    },
  ],
  claimSnapshots: [
    {
      id: 'claim-revision-1',
      sourceDocumentId: 'document-1',
      documentKind: 'primary',
      identityKey: 'primary:document-1:0:20',
      previousClaimId: null,
      currentClaimId: 'claim-1',
      sourceStart: 0,
      sourceEnd: 20,
      createdAt: firstDate,
      previous: {
        id: 'claim-before',
        text: 'Before saved source content.',
        sourceStart: 0,
        sourceEnd: 20,
        sourceQuote: 'Before saved source content.',
        sourceUrl: 'https://example.com/previous-source',
        citationLinks: ['https://example.com/previous-citation'],
        extractedAt: firstDate.toISOString(),
      },
      current: {
        id: 'claim-1',
        text: 'Current saved source content.',
        sourceStart: 0,
        sourceEnd: 20,
        sourceQuote: 'Current saved source content.',
        sourceUrl: 'https://example.com/current-source',
        citationLinks: ['https://example.com/current-citation'],
        extractedAt: secondDate.toISOString(),
      },
    },
  ],
  evidenceSnapshots: [
    {
      id: 'evidence-revision-1',
      claimId: 'claim-1',
      verificationRunId: 'verification-1',
      verificationResultId: 'result-1',
      evidenceDocumentId: 'evidence-document-1',
      passageId: 'passage-1',
      identityKey: 'claim-1:evidence-document-1:passage-1:supporting',
      sourceUrl: 'https://example.com/current-evidence',
      evidenceDate: secondDate,
      classification: 'supported',
      freshness: 'fresh',
      errorState: null,
      createdAt: secondDate,
      previous: {
        claimId: 'claim-1',
        classification: 'unsupported',
        freshness: 'stale',
        errorState: 'previous evidence expired',
        excerpts: [
          {
            id: 'excerpt-before',
            passageId: 'passage-before',
            documentId: 'evidence-document-1',
            documentTitle: 'Earlier evidence',
            role: 'contradicting',
            text: 'The earlier evidence excerpt.',
            sourceUrl: 'https://example.com/previous-evidence',
            evidenceDate: firstDate.toISOString(),
          },
        ],
      },
      current: {
        claimId: 'claim-1',
        classification: 'supported',
        freshness: 'fresh',
        errorState: null,
        excerpts: [
          {
            id: 'excerpt-after',
            passageId: 'passage-1',
            documentId: 'evidence-document-1',
            documentTitle: 'Current evidence',
            role: 'supporting',
            text: 'The current evidence excerpt.',
            sourceUrl: 'https://example.com/current-evidence',
            evidenceDate: secondDate.toISOString(),
          },
        ],
      },
    },
  ],
};

const documentOnlyRevision = {
  id: 'revision-document-only',
  projectId: 'project-1',
  ownerId: 'owner-1',
  version: 2,
  eventKind: 'ingestion',
  createdAt: secondDate,
  documentSnapshots: [
    {
      id: 'document-revision-2',
      documentId: 'document-1',
      documentKind: 'primary',
      createdAt: secondDate,
      previous: {
        id: 'document-1',
        kind: 'primary',
        url: 'https://example.com/source',
        documentText: null,
        normalizedContent: 'Previous document.',
        status: 'complete',
        processingRoute: 'model-fallback',
        processingTrace: null,
        extractedAt: firstDate.toISOString(),
      },
      current: {
        id: 'document-1',
        kind: 'primary',
        url: 'https://example.com/current-source',
        documentText: null,
        normalizedContent: 'Current document.',
        status: 'complete',
        processingRoute: 'trusted-server-reuse',
        processingTrace: null,
        extractedAt: secondDate.toISOString(),
      },
    },
  ],
  claimSnapshots: [],
  evidenceSnapshots: [],
};

function request() {
  return new Request('http://test/api/projects/project-1/history');
}

function params() {
  return { params: Promise.resolve({ projectId: 'project-1' }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAuth.mockResolvedValue({ id: 'owner-1' });
  findFirst.mockResolvedValue(project);
  findMany.mockResolvedValue([revision, documentOnlyRevision]);
});

describe('GET /api/projects/[projectId]/history', () => {
  it('returns 401 before querying for anonymous callers', async () => {
    requireAuth.mockRejectedValue(Response.json({ error: 'Unauthorized' }, { status: 401 }));

    const response = await GET(request(), params());

    expect(response.status).toBe(401);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it.each(['missing', 'foreign', 'ownerless'])('returns 404 for a %s project', async () => {
    findFirst.mockResolvedValue(null);

    const response = await GET(request(), params());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Project not found.' });
  });

  it('queries only the authenticated owner and returns a validated response', async () => {
    const response = await GET(request(), params());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'project-1', userId: 'owner-1' } }),
    );
    expect(() => ProjectHistory.parse(body)).not.toThrow();
    expect(body.versions).toMatchObject([
      { version: 1, documentId: 'document-1', documentKind: 'primary' },
      { version: 2, documentId: 'document-1', documentKind: 'primary' },
    ]);
    expect(body.revisions).toHaveLength(2);
    expect(body.revisions[0]).toMatchObject({
      ownerId: 'owner-1',
      eventKind: 'ingestion',
      claims: [
        {
          previous: {
            text: 'Before saved source content.',
            sourceQuote: 'Before saved source content.',
            sourceUrl: 'https://example.com/previous-source',
            citationLinks: ['https://example.com/previous-citation'],
          },
          current: {
            text: 'Current saved source content.',
            sourceQuote: 'Current saved source content.',
            sourceUrl: 'https://example.com/current-source',
            citationLinks: ['https://example.com/current-citation'],
          },
        },
      ],
      evidence: [
        {
          previous: {
            classification: 'unsupported',
            freshness: 'stale',
            errorState: 'previous evidence expired',
            excerpts: [{ text: 'The earlier evidence excerpt.' }],
          },
          current: {
            classification: 'supported',
            freshness: 'fresh',
            excerpts: [{ text: 'The current evidence excerpt.' }],
          },
        },
      ],
    });
    expect(body.revisions[1]).toMatchObject({
      documents: [{ current: { normalizedContent: 'Current document.' } }],
      claims: [],
      evidence: [],
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: 'project-1', ownerId: 'owner-1' } }),
    );
    expect(body.comparison.evidenceState).toEqual({
      previous: 'complete',
      current: 'needs-review',
      changed: true,
    });
    expect(body.comparison.changed[0]).toMatchObject({
      currentClaimId: 'claim-current',
      currentClaimHref: '/projects/project-1#claim-claim-current',
    });
    expect(body.comparison.removed[0]).toMatchObject({
      currentClaimId: null,
      currentClaimHref: null,
      claimsHref: '/projects/project-1#claims',
    });
  });

  it('returns valid empty and one-run histories without a comparison', async () => {
    findFirst.mockResolvedValueOnce({ ...project, processingRuns: [] });
    const empty = await GET(request(), params());
    expect(empty.status).toBe(200);
    await expect(empty.json()).resolves.toMatchObject({
      projectId: 'project-1',
      versions: [],
      comparison: null,
    });

    findFirst.mockResolvedValueOnce({ ...project, processingRuns: [project.processingRuns[0]] });
    const oneRun = await GET(request(), params());
    expect(oneRun.status).toBe(200);
    await expect(oneRun.json()).resolves.toMatchObject({
      versions: [{ version: 1 }],
      comparison: null,
    });
  });

  it('preserves the explicit legacy identity fallback for older runs', async () => {
    findFirst.mockResolvedValueOnce({
      ...project,
      processingRuns: [{ ...project.processingRuns[0], documentId: null, documentKind: null }],
    });

    const response = await GET(request(), params());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      versions: [{ documentId: null, documentKind: null }],
    });
  });

  it('returns a safe 500 for database or contract serialization failures', async () => {
    findFirst.mockRejectedValueOnce(new Error('database unavailable'));
    const databaseFailure = await GET(request(), params());
    expect(databaseFailure.status).toBe(500);
    await expect(databaseFailure.json()).resolves.toEqual({
      error: 'Could not load project history.',
    });

    findFirst.mockResolvedValueOnce({
      ...project,
      processingRuns: [{ ...project.processingRuns[0], processingRoute: 'not-a-route' }],
    });
    const contractFailure = await GET(request(), params());
    expect(contractFailure.status).toBe(500);
    await expect(contractFailure.json()).resolves.toEqual({
      error: 'Could not load project history.',
    });
  });
});
