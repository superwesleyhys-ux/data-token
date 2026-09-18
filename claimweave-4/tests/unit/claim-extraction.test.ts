import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  create,
  createRun,
  findProject,
  findLatestRun,
  updateSource,
  findLatestRevision,
  createRevision,
  transaction,
  generateObject,
} = vi.hoisted(() => ({
  create: vi.fn(),
  createRun: vi.fn(),
  findProject: vi.fn(),
  findLatestRun: vi.fn(),
  updateSource: vi.fn(),
  findLatestRevision: vi.fn(),
  createRevision: vi.fn(),
  transaction: vi.fn(),
  generateObject: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({
  prisma: {
    $transaction: transaction,
    claimweaveProject: { findFirst: findProject },
  },
}));
vi.mock('@/lib/ai/client', () => ({
  AiConfigurationError: class AiConfigurationError extends Error {},
  generateObject,
}));
vi.mock('node:dns/promises', () => ({
  default: { lookup: vi.fn().mockResolvedValue([{ address: '93.184.216.34' }]) },
  lookup: vi.fn().mockResolvedValue([{ address: '93.184.216.34' }]),
}));

import {
  createProjectFromText,
  createProjectFromUrl,
  extractReadableText,
  normalizeClaims,
  normalizePastedText,
} from '@/lib/business/claim-extraction';

const url = 'https://example.com/article';
const urlText = 'A readable URL source keeps its normalized content for later review.';
const text = '  Pasted evidence keeps its trimmed edges and exact internal spacing.  ';
const normalizedText = text.trim();

function mockPersistedProject(sourceUrl: string | null, normalizedContent: string) {
  create.mockResolvedValue({
    id: 'project-1',
    source: {
      id: 'document-1',
      url: sourceUrl,
      normalizedContent,
      status: 'complete',
      extractedAt: new Date('2026-09-17T00:00:00.000Z'),
      claims: [
        {
          id: 'claim-1',
          text: normalizedContent,
          sourceStart: 0,
          sourceEnd: normalizedContent.length,
          sourceQuote: normalizedContent,
          citationLinks: sourceUrl ? [sourceUrl] : [],
          sourceUrl,
          extractedAt: new Date('2026-09-17T00:00:00.000Z'),
        },
      ],
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  transaction.mockImplementation(
    async (
      callback: (client: {
        claimweaveProject: { create: typeof create };
        claimweaveProcessingRun: {
          create: typeof createRun;
          findFirst: typeof findLatestRun;
        };
        claimweaveSource: { update: typeof updateSource };
        claimweaveRevision: {
          findFirst: typeof findLatestRevision;
          create: typeof createRevision;
        };
      }) => unknown,
    ) =>
      callback({
        claimweaveProject: { create },
        claimweaveProcessingRun: { create: createRun, findFirst: findLatestRun },
        claimweaveSource: { update: updateSource },
        claimweaveRevision: { findFirst: findLatestRevision, create: createRevision },
      }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Claimweave extraction normalization', () => {
  it('turns HTML into bounded readable text', () => {
    expect(extractReadableText('<script>ignore()</script><h1>Evidence</h1><p>One claim.</p>')).toBe(
      'Evidence One claim.',
    );
  });

  it('derives an exact source span when the model gives a usable quote', () => {
    const source = 'Claimweave keeps evidence attached to each statement.';
    const claims = normalizeClaims(
      {
        claims: [
          {
            text: 'Evidence stays attached.',
            quote: 'evidence attached to each statement.',
            start: 0,
            end: 0,
            citationLinks: [],
          },
        ],
      },
      source,
      'https://example.com/article',
      new Date('2026-09-17T00:00:00.000Z'),
    );
    expect(claims[0]?.sourceSpan).toEqual({
      start: 17,
      end: 53,
      quote: 'evidence attached to each statement.',
    });
    expect(claims[0]?.citationLinks).toEqual(['https://example.com/article']);
  });

  it('trims pasted text edges without changing internal whitespace', () => {
    expect(normalizePastedText('  First sentence.\n\nSecond sentence with evidence.  ')).toBe(
      'First sentence.\n\nSecond sentence with evidence.',
    );
  });

  it('rejects pasted text outside the readable source budget', () => {
    expect(() => normalizePastedText('too short')).toThrow('at least 40 characters');
    expect(() => normalizePastedText('x'.repeat(80_001))).toThrow('80,000');
  });

  it('normalizes text claims without external citations', () => {
    const source = 'Pasted evidence stays exact, including its meaningful spacing.';
    const claims = normalizeClaims(
      {
        claims: [
          {
            text: 'Evidence stays exact.',
            quote: 'evidence stays exact',
            start: 0,
            end: 0,
            citationLinks: ['https://should-be-ignored.example'],
          },
        ],
      },
      source,
      null,
      new Date('2026-09-17T00:00:00.000Z'),
    );
    expect(claims[0]?.sourceUrl).toBeNull();
    expect(claims[0]?.citationLinks).toEqual([]);
    expect(claims[0]?.sourceSpan.quote).toBe('evidence stays exact');
  });

  it('rejects malformed AI output and claims without source support', () => {
    expect(() =>
      normalizeClaims(
        { claims: [{ text: 'No support', quote: 'not in source', start: 0, end: 13 }] },
        'A short source.',
        'https://example.com',
        new Date(),
      ),
    ).toThrow();
    expect(() =>
      normalizeClaims(
        { nope: [] },
        'A source with enough content to inspect.',
        'https://example.com',
        new Date(),
      ),
    ).toThrow();
  });

  it('passes readable URL content into the atomic document persistence write', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(`<p>${urlText}</p>`, {
          headers: { 'content-type': 'text/html' },
        }),
      ),
    );
    generateObject.mockResolvedValue({
      claims: [
        {
          text: urlText,
          quote: urlText,
          start: 0,
          end: urlText.length,
          citationLinks: [],
        },
      ],
    });
    mockPersistedProject(url, urlText);

    const result = await createProjectFromUrl({ url });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source: expect.objectContaining({
            create: expect.objectContaining({
              url,
              normalizedContent: urlText,
            }),
          }),
        }),
      }),
    );
    expect(result.documentId).toBe('document-1');
    expect(result.normalizedContentLength).toBe(urlText.length);
    expect(createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          version: 1,
          evidenceState: 'complete',
          documentId: 'document-1',
          documentKind: 'primary',
          createdAt: expect.any(Date),
          snapshots: {
            create: [
              expect.objectContaining({
                text: urlText,
                sourceQuote: urlText,
                sourceStart: 0,
                sourceEnd: urlText.length,
                sourceUrl: url,
                citationLinks: [url],
                createdAt: expect.any(Date),
              }),
            ],
          },
        }),
      }),
    );
  });

  it('passes trimmed pasted text into both original and normalized document fields', async () => {
    generateObject.mockResolvedValue({
      claims: [
        {
          text: normalizedText,
          quote: normalizedText,
          start: 0,
          end: normalizedText.length,
          citationLinks: [],
        },
      ],
    });
    mockPersistedProject(null, normalizedText);

    await createProjectFromText({ text });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source: expect.objectContaining({
            create: expect.objectContaining({
              url: null,
              documentText: normalizedText,
              normalizedContent: normalizedText,
            }),
          }),
        }),
      }),
    );
  });

  it('does not open a persistence transaction when extraction or AI validation fails', async () => {
    generateObject.mockRejectedValue(new Error('AI unavailable'));
    await expect(createProjectFromText({ text: normalizedText })).rejects.toThrow(
      'temporarily unavailable',
    );
    expect(transaction).not.toHaveBeenCalled();

    generateObject.mockResolvedValue({ invalid: true });
    await expect(createProjectFromText({ text: normalizedText })).rejects.toThrow(
      'converted into verifiable claims',
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it('surfaces persistence failures without returning a partially saved project', async () => {
    generateObject.mockResolvedValue({
      claims: [
        {
          text: normalizedText,
          quote: normalizedText,
          start: 0,
          end: normalizedText.length,
          citationLinks: [],
        },
      ],
    });
    transaction.mockRejectedValue(new Error('database unavailable'));

    await expect(createProjectFromText({ text: normalizedText })).rejects.toThrow(
      'We could not save the extracted claims',
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('appends a new version while replacing only the current projection', async () => {
    const firstText = normalizedText;
    const secondText = 'The refreshed interpretation is persisted for review.';
    const firstClaim = {
      text: firstText,
      quote: firstText,
      start: 0,
      end: firstText.length,
      citationLinks: [],
    };
    const secondClaim = {
      text: secondText,
      quote: firstText,
      start: 0,
      end: firstText.length,
      citationLinks: [],
    };
    generateObject.mockResolvedValueOnce({ claims: [firstClaim] }).mockResolvedValueOnce({
      claims: [secondClaim],
    });
    mockPersistedProject(null, firstText);
    await createProjectFromText({ text: firstText });

    findProject.mockResolvedValue({
      id: 'project-1',
      userId: 'owner-1',
      source: {
        id: 'document-1',
        url: null,
        documentText: firstText,
        normalizedContent: firstText,
        status: 'complete',
      },
    });
    findLatestRun.mockResolvedValue({ version: 1 });
    updateSource.mockResolvedValue({
      id: 'document-1',
      url: null,
      normalizedContent: secondText,
      extractedAt: new Date('2026-09-17T00:01:00.000Z'),
      claims: [
        {
          id: 'claim-2',
          text: secondText,
          sourceStart: 0,
          sourceEnd: firstText.length,
          sourceQuote: firstText,
          citationLinks: [],
          sourceUrl: null,
          extractedAt: new Date('2026-09-17T00:01:00.000Z'),
        },
      ],
    });

    const refreshed = await (await import('@/lib/business/claim-extraction')).reprocessProject(
      'project-1',
      'owner-1',
    );

    expect(refreshed.claims[0]?.text).toBe(secondText);
    expect(findLatestRun).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: 'project-1' },
        orderBy: { version: 'desc' },
      }),
    );
    expect(updateSource).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          documentText: firstText,
          claims: expect.objectContaining({ deleteMany: {}, create: expect.any(Array) }),
        }),
      }),
    );
    expect(createRun).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          projectId: 'project-1',
          version: 2,
          evidenceState: 'complete',
          documentId: 'document-1',
          documentKind: 'primary',
          snapshots: { create: [expect.objectContaining({ text: secondText })] },
        }),
      }),
    );
  });

  it('does not replace the current projection when reprocessing persistence fails', async () => {
    const sourceText = normalizedText;
    generateObject.mockResolvedValue({
      claims: [{ text: sourceText, quote: sourceText, start: 0, end: sourceText.length }],
    });
    findProject.mockResolvedValue({
      id: 'project-1',
      userId: 'owner-1',
      source: {
        id: 'document-1',
        url: null,
        documentText: sourceText,
        normalizedContent: sourceText,
        status: 'complete',
      },
    });
    transaction.mockRejectedValue(new Error('database unavailable'));

    await expect(
      (async () => {
        const { reprocessProject } = await import('@/lib/business/claim-extraction');
        return reprocessProject('project-1', 'owner-1');
      })(),
    ).rejects.toThrow('reprocessed claims');
    expect(updateSource).not.toHaveBeenCalled();
    expect(createRun).not.toHaveBeenCalled();
  });
});
