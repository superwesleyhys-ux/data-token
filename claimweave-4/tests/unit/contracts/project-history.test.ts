import { describe, expect, it } from 'vitest';
import { ProjectHistory } from '@/lib/contracts/project-history';

const snapshot = {
  id: 'snapshot-1',
  text: 'A saved claim.',
  sourceStart: 0,
  sourceEnd: 14,
  sourceQuote: 'A saved claim.',
  sourceUrl: null,
  citationLinks: [],
  createdAt: '2026-09-17T12:00:00.000Z',
};

const version = {
  id: 'run-1',
  version: 1,
  documentId: 'document-1',
  documentKind: 'primary' as const,
  createdAt: '2026-09-17T12:00:00.000Z',
  evidenceState: 'complete',
  processingRoute: 'model-fallback' as const,
  claimCount: 1,
  snapshots: [snapshot],
};

const item = {
  key: '0:14',
  sourceStart: 0,
  sourceEnd: 14,
  previous: null,
  current: snapshot,
  currentClaimId: 'claim-1',
  claimsHref: '/projects/project-1#claims',
  currentClaimHref: '/projects/project-1#claim-claim-1',
};

const previousClaim = {
  id: 'claim-before',
  text: 'The previous claim text.',
  sourceStart: 10,
  sourceEnd: 34,
  sourceQuote: 'Previous source passage.',
  sourceUrl: 'https://example.com/previous-source',
  citationLinks: ['https://example.com/previous-citation'],
  extractedAt: '2026-09-17T12:00:00.000Z',
};

const currentClaim = {
  id: 'claim-after',
  text: 'The current claim text.',
  sourceStart: 10,
  sourceEnd: 34,
  sourceQuote: 'Current source passage.',
  sourceUrl: 'https://example.com/current-source',
  citationLinks: ['https://example.com/current-citation'],
  extractedAt: '2026-09-18T12:00:00.000Z',
};

const revision = {
  id: 'revision-1',
  projectId: 'project-1',
  ownerId: 'owner-1',
  version: 1,
  eventKind: 'verification' as const,
  createdAt: '2026-09-17T12:00:00.000Z',
  documents: [],
  claims: [
    {
      id: 'claim-revision-1',
      sourceDocumentId: 'document-1',
      documentKind: 'primary' as const,
      identityKey: 'primary:document-1:10:34',
      previousClaimId: 'claim-before',
      currentClaimId: 'claim-after',
      sourceStart: 10,
      sourceEnd: 34,
      createdAt: '2026-09-18T12:00:00.000Z',
      previous: previousClaim,
      current: currentClaim,
    },
  ],
  evidence: [
    {
      id: 'evidence-revision-1',
      claimId: 'claim-1',
      verificationRunId: 'verification-1',
      verificationResultId: 'result-1',
      evidenceDocumentId: 'evidence-document-1',
      passageId: 'passage-1',
      identityKey: 'claim-1:evidence-document-1:passage-1:supporting',
      sourceUrl: 'https://evidence.example/source',
      evidenceDate: '2026-09-17T12:00:00.000Z',
      classification: 'supported',
      freshness: 'fresh',
      errorState: null,
      createdAt: '2026-09-17T12:00:00.000Z',
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
            documentTitle: 'Earlier independent evidence',
            role: 'contradicting' as const,
            text: 'The earlier passage did not support the claim.',
            sourceUrl: 'https://evidence.example/previous-source',
            evidenceDate: '2026-09-16T12:00:00.000Z',
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
            id: 'excerpt-1',
            passageId: 'passage-1',
            documentId: 'evidence-document-1',
            documentTitle: 'Independent evidence',
            role: 'supporting',
            text: 'The independent passage.',
            sourceUrl: 'https://evidence.example/source',
            evidenceDate: '2026-09-17T12:00:00.000Z',
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
  eventKind: 'ingestion' as const,
  createdAt: '2026-09-18T12:00:00.000Z',
  documents: [
    {
      id: 'document-revision-2',
      documentId: 'document-1',
      documentKind: 'primary' as const,
      createdAt: '2026-09-18T12:00:00.000Z',
      previous: {
        id: 'document-1',
        kind: 'primary' as const,
        url: 'https://example.com/previous-source',
        documentText: null,
        normalizedContent: 'Previous document text.',
        status: 'complete',
        processingRoute: 'model-fallback',
        processingTrace: null,
        extractedAt: '2026-09-17T12:00:00.000Z',
      },
      current: {
        id: 'document-1',
        kind: 'primary' as const,
        url: 'https://example.com/current-source',
        documentText: null,
        normalizedContent: 'Current document text.',
        status: 'complete',
        processingRoute: 'trusted-server-reuse',
        processingTrace: null,
        extractedAt: '2026-09-18T12:00:00.000Z',
      },
    },
  ],
  claims: [],
  evidence: [],
};

describe('project history contract', () => {
  it('accepts versions, snapshots, changed fields, and a nullable comparison', () => {
    expect(
      ProjectHistory.safeParse({
        projectId: 'project-1',
        versions: [version],
        comparison: null,
        revisions: [revision, documentOnlyRevision],
      }).success,
    ).toBe(true);
    const parsed = ProjectHistory.parse({
      projectId: 'project-1',
      versions: [version],
      comparison: null,
      revisions: [revision, documentOnlyRevision],
    });
    expect(parsed.revisions[0]?.claims[0]).toMatchObject({
      previous: {
        text: 'The previous claim text.',
        sourceQuote: 'Previous source passage.',
        sourceUrl: 'https://example.com/previous-source',
        citationLinks: ['https://example.com/previous-citation'],
      },
      current: {
        text: 'The current claim text.',
        sourceQuote: 'Current source passage.',
        sourceUrl: 'https://example.com/current-source',
        citationLinks: ['https://example.com/current-citation'],
      },
    });
    expect(parsed.revisions[1]).toMatchObject({
      documents: [{ current: { normalizedContent: 'Current document text.' } }],
      claims: [],
      evidence: [],
    });
    expect(
      ProjectHistory.safeParse({
        projectId: 'project-1',
        versions: [version, { ...version, id: 'run-2', version: 2, claimCount: 1 }],
        revisions: [],
        comparison: {
          previousVersion: 1,
          currentVersion: 2,
          added: [item],
          removed: [
            {
              ...item,
              previous: snapshot,
              current: null,
              currentClaimId: null,
              currentClaimHref: null,
            },
          ],
          changed: [{ ...item, previous: snapshot, current: { ...snapshot, text: 'Changed.' } }],
          evidenceState: { previous: 'complete', current: 'complete', changed: false },
        },
      }).success,
    ).toBe(true);
  });

  it('rejects invalid dates, statuses, and source ranges', () => {
    expect(
      ProjectHistory.safeParse({
        projectId: 'project-1',
        versions: [{ ...version, createdAt: 'yesterday' }],
        comparison: null,
        revisions: [],
      }).success,
    ).toBe(false);
    expect(
      ProjectHistory.safeParse({
        projectId: 'project-1',
        versions: [{ ...version, evidenceState: ' ' }],
        revisions: [],
        comparison: null,
      }).success,
    ).toBe(false);
    expect(
      ProjectHistory.safeParse({
        projectId: 'project-1',
        versions: [{ ...version, snapshots: [{ ...snapshot, sourceEnd: 0 }] }],
        revisions: [],
        comparison: null,
      }).success,
    ).toBe(false);
    expect(
      ProjectHistory.safeParse({
        projectId: 'project-1',
        versions: [{ ...version, processingRoute: 'unknown' }],
        revisions: [],
        comparison: null,
      }).success,
    ).toBe(false);
    expect(
      ProjectHistory.safeParse({
        projectId: 'project-1',
        versions: [{ ...version, documentId: '', documentKind: 'primary' }],
        comparison: null,
        revisions: [],
      }).success,
    ).toBe(false);
    expect(
      ProjectHistory.safeParse({
        projectId: 'project-1',
        versions: [{ ...version, documentId: null, documentKind: null }],
        comparison: null,
        revisions: [],
      }).success,
    ).toBe(true);
  });
});
