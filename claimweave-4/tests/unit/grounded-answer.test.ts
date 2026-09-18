// @polsia:user-owned — focused grounded-answer contract and business coverage.
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findFirst, generateObject, getLatestVerification, MockAiConfigurationError } = vi.hoisted(
  () => {
    class MockAiConfigurationError extends Error {}
    return {
      findFirst: vi.fn(),
      generateObject: vi.fn(),
      getLatestVerification: vi.fn(),
      MockAiConfigurationError,
    };
  },
);

vi.mock('@/lib/db', () => ({ prisma: { claimweaveProject: { findFirst } } }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/ai/client', () => ({
  AiConfigurationError: MockAiConfigurationError,
  generateObject,
}));
vi.mock('@/lib/business/evidence-verification', () => ({ getLatestVerification }));

import {
  assembleGroundedAnswer,
  createGroundedAnswer,
  selectEligibleClaims,
} from '@/lib/business/grounded-answer';
import type { VerificationExcerpt, VerificationRun } from '@/lib/contracts/evidence-verification';
import { GroundedAnswerRequest, GroundedAnswerResponse } from '@/lib/contracts/grounded-answer';

const currentDate = '2026-09-18T12:00:00.000Z';

function excerpt(id: string, sourceUrl: string | null = `https://evidence.example/${id}`) {
  return {
    id,
    passageId: `passage-${id}`,
    documentId: `document-${id}`,
    documentTitle: `Evidence ${id}`,
    role: 'supporting' as const,
    text: `Exact stored excerpt ${id}.`,
    sourceUrl,
    evidenceDate: currentDate,
  } satisfies VerificationExcerpt;
}

function verification(
  claimId: string,
  options: {
    classification?: 'supported' | 'unsupported' | 'contradicted' | 'stale';
    freshness?: 'fresh' | 'stale' | 'unknown';
    excerpts?: VerificationExcerpt[];
  } = {},
) {
  return {
    results: [
      {
        id: `result-${claimId}`,
        claimId,
        classification: options.classification ?? 'supported',
        freshness: options.freshness ?? 'fresh',
        verifiedAt: currentDate,
        errorState: null,
        excerpts: options.excerpts ?? [excerpt(claimId)],
      },
    ],
  } satisfies Pick<VerificationRun, 'results'>;
}

function firstResult(snapshot: Pick<VerificationRun, 'results'>) {
  const result = snapshot.results[0];
  if (!result) throw new Error('Fixture result is missing.');
  return result;
}

function claim(id: string, approvalStatus = 'approved', citationLinks: unknown = []) {
  return {
    id,
    text: `Claim text ${id}.`,
    approvalStatus,
    citationLinks,
    sourceUrl: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  findFirst.mockResolvedValue({
    id: 'project-1',
    source: { claims: [claim('claim-1', 'approved', ['https://claim.example/1'])] },
  });
  getLatestVerification.mockResolvedValue({ verification: verification('claim-1') });
});

describe('grounded-answer contract and business rules', () => {
  it('trims valid questions and rejects blank or oversized input', () => {
    expect(GroundedAnswerRequest.parse({ question: '  What is supported?  ' })).toEqual({
      question: 'What is supported?',
    });
    expect(GroundedAnswerRequest.safeParse({ question: '   ' }).success).toBe(false);
    expect(GroundedAnswerRequest.safeParse({ question: 'x'.repeat(4_001) }).success).toBe(false);
  });

  it('only selects approved, supported, fresh or unknown, citation-ready claims', () => {
    const claims = [
      claim('approved-fresh'),
      claim('pending', 'pending'),
      claim('rejected', 'rejected'),
      claim('stale'),
      claim('unsupported'),
      claim('contradicted'),
      claim('missing-excerpt'),
      claim('missing-url', 'approved', ['not-a-url']),
    ];
    const results = [
      firstResult(verification('approved-fresh')),
      firstResult(verification('pending')),
      firstResult(verification('rejected')),
      firstResult(verification('stale', { freshness: 'stale' })),
      firstResult(verification('unsupported', { classification: 'unsupported' })),
      firstResult(verification('contradicted', { classification: 'contradicted' })),
      firstResult(verification('missing-excerpt', { excerpts: [] })),
      firstResult(verification('missing-url', { excerpts: [excerpt('missing-url', null)] })),
      firstResult(verification('approved-unknown', { freshness: 'unknown' })),
    ];

    const eligible = selectEligibleClaims(claims.concat([claim('approved-unknown')]), {
      results,
    });

    expect(eligible.map((item) => item.id)).toEqual(['approved-fresh', 'approved-unknown']);
  });

  it('assembles citations entirely from stored excerpts and URLs', () => {
    const eligible = selectEligibleClaims(
      [claim('claim-1', 'approved', ['https://claim.example/1'])],
      verification('claim-1'),
    );
    const response = assembleGroundedAnswer(
      { grounded: true, answer: 'Stored answer.', claimIds: ['claim-1'], reason: null },
      eligible,
    );

    expect(GroundedAnswerResponse.parse(response)).toEqual({
      grounded: true,
      answer: 'Stored answer.',
      citations: [
        {
          claimId: 'claim-1',
          claimText: 'Claim text claim-1.',
          excerpts: [excerpt('claim-1')],
          citationUrls: ['https://evidence.example/claim-1', 'https://claim.example/1'],
        },
      ],
    });
  });

  it('returns no-grounding without calling AI when no eligible evidence exists', async () => {
    findFirst.mockResolvedValue({
      id: 'project-1',
      source: { claims: [claim('claim-1', 'pending')] },
    });

    await expect(
      createGroundedAnswer('project-1', 'owner-1', 'What is supported?'),
    ).resolves.toEqual({
      grounded: false,
      answer: null,
      citations: [],
      reason: 'insufficient-approved-evidence',
    });
    expect(generateObject).not.toHaveBeenCalled();
  });

  it('returns model no-grounding as the stable public shape', async () => {
    generateObject.mockResolvedValue({
      grounded: false,
      answer: null,
      claimIds: [],
      reason: 'insufficient-evidence',
    });

    await expect(
      createGroundedAnswer('project-1', 'owner-1', 'What is supported?'),
    ).resolves.toEqual({
      grounded: false,
      answer: null,
      citations: [],
      reason: 'insufficient-approved-evidence',
    });
  });

  it('rejects unknown claim IDs and malformed model output as 502 errors', () => {
    const eligible = selectEligibleClaims(
      [claim('claim-1', 'approved', ['https://claim.example/1'])],
      verification('claim-1'),
    );

    expect(() =>
      assembleGroundedAnswer(
        { grounded: true, answer: 'Answer', claimIds: ['foreign-claim'], reason: null },
        eligible,
      ),
    ).toThrow('unknown claim');
    expect(() => assembleGroundedAnswer({ grounded: true }, eligible)).toThrow(
      'output was invalid',
    );
  });

  it('maps missing AI configuration to 503 and other AI failures to 502', async () => {
    generateObject.mockRejectedValueOnce(new MockAiConfigurationError('missing'));
    await expect(createGroundedAnswer('project-1', 'owner-1', 'Question')).rejects.toMatchObject({
      status: 503,
    });

    generateObject.mockRejectedValueOnce(new Error('upstream'));
    await expect(createGroundedAnswer('project-1', 'owner-1', 'Question')).rejects.toMatchObject({
      status: 502,
    });
  });
});
