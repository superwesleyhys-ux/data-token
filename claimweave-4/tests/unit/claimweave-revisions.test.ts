// @polsia:user-owned — focused revision change-detection coverage.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClaimweaveRevision } from '@/lib/business/claimweave-revisions';

const findFirst = vi.fn();
const create = vi.fn();

const document = {
  id: 'document-1',
  kind: 'primary' as const,
  url: 'https://example.com/source',
  documentText: null,
  normalizedContent: 'Source content.',
  status: 'complete',
  processingRoute: 'model-fallback',
  processingTrace: { latencyMs: 10 },
  extractedAt: new Date('2026-09-18T12:00:00.000Z'),
};

const claim = {
  id: 'claim-1',
  text: 'Source content.',
  sourceStart: 0,
  sourceEnd: 15,
  sourceQuote: 'Source content.',
  sourceUrl: 'https://example.com/source',
  citationLinks: ['https://example.com/source'],
  extractedAt: new Date('2026-09-18T12:00:00.000Z'),
  sourceDocumentId: 'document-1',
  documentKind: 'primary' as const,
};

function tx() {
  return {
    claimweaveRevision: { findFirst, create },
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  findFirst.mockResolvedValue({ version: 2 });
  create.mockResolvedValue({ id: 'revision-3', version: 3 });
});

describe('Claimweave revision persistence', () => {
  it('creates one owned event containing document and claim before/current values', async () => {
    await createClaimweaveRevision(tx(), {
      projectId: 'project-1',
      ownerId: 'owner-1',
      eventKind: 'ingestion',
      currentDocuments: [document],
      currentClaims: [claim],
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          projectId: 'project-1',
          ownerId: 'owner-1',
          version: 3,
          documentSnapshots: {
            create: [expect.objectContaining({ documentId: 'document-1', previous: undefined })],
          },
          claimSnapshots: {
            create: [
              expect.objectContaining({
                previousClaimId: null,
                currentClaimId: 'claim-1',
                current: expect.objectContaining({ text: 'Source content.' }),
              }),
            ],
          },
        }),
      }),
    );
  });

  it('treats replayed values as a no-op even when generated ids, traces, and timestamps differ', async () => {
    const replayedDocument = {
      ...document,
      processingTrace: { latencyMs: 99 },
      extractedAt: new Date('2026-09-18T12:01:00.000Z'),
    };
    const replayedClaim = {
      ...claim,
      id: 'claim-2',
      extractedAt: new Date('2026-09-18T12:01:00.000Z'),
    };

    await createClaimweaveRevision(tx(), {
      projectId: 'project-1',
      eventKind: 'ingestion',
      previousDocuments: [document],
      currentDocuments: [replayedDocument],
      previousClaims: [claim],
      currentClaims: [replayedClaim],
    });

    expect(create).not.toHaveBeenCalled();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('orders changed identities deterministically and records both sides', async () => {
    await createClaimweaveRevision(tx(), {
      projectId: 'project-1',
      eventKind: 'ingestion',
      previousClaims: [claim],
      currentClaims: [
        { ...claim, id: 'claim-new', text: 'Changed source content.' },
        { ...claim, id: 'claim-added', sourceStart: 20, sourceEnd: 25, text: 'Added.' },
      ],
    });

    const snapshots = create.mock.calls[0]?.[0].data.claimSnapshots.create;
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]).toMatchObject({ sourceStart: 0, previousClaimId: 'claim-1' });
    expect(snapshots[1]).toMatchObject({ sourceStart: 20, previousClaimId: null });
  });
});
