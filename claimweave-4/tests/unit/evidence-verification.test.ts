import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('@/lib/ai/client', () => ({
  AiConfigurationError: class AiConfigurationError extends Error {},
  generateObject: vi.fn(),
}));

import {
  classifyClaimAgainstPassages,
  DEFAULT_MINIMUM_SUPPORTING_SOURCES,
  EVIDENCE_POLICY_VERSION,
  STALE_EVIDENCE_DAYS,
  summarizeVerificationResults,
} from '@/lib/business/evidence-verification';
import {
  EvidenceDocumentCreate,
  VerificationResponse,
} from '@/lib/contracts/evidence-verification';

const now = new Date('2026-09-18T12:00:00.000Z');
const currentDate = '2026-09-01T00:00:00.000Z';
const staleDate = '2024-01-01T00:00:00.000Z';

function passage(id: string, text: string, evidenceDate: string | null = currentDate) {
  return {
    id,
    documentId: `document-${id}`,
    documentTitle: `Fixture ${id}`,
    text,
    sourceUrl: `https://evidence.example/${id}`,
    evidenceDate: evidenceDate ? new Date(evidenceDate) : null,
  };
}

describe('deterministic evidence verification', () => {
  it('classifies an entailing passage as supported and preserves the exact passage', () => {
    const result = classifyClaimAgainstPassages(
      'claim-supported',
      'The review tool supports offline review.',
      [passage('supported', 'The review tool supports offline review.')],
      now,
    );

    expect(result.classification).toBe('supported');
    expect(result.freshness).toBe('fresh');
    expect(result.supporting[0]?.text).toBe('The review tool supports offline review.');
    expect(result.supporting[0]?.sourceUrl).toBe('https://evidence.example/supported');
  });

  it('keeps an unsupported claim free of fabricated evidence', () => {
    const result = classifyClaimAgainstPassages(
      'claim-unsupported',
      'The review tool exports signed audit reports.',
      [passage('unrelated', 'The review tool supports offline review.')],
      now,
    );

    expect(result.classification).toBe('unsupported');
    expect(result.supporting).toHaveLength(0);
    expect(result.contradicting).toHaveLength(0);
    expect(result.errorState).toBe('no-independent-evidence');
  });

  it('reports no independent evidence when the submitted passage set is empty', () => {
    const result = classifyClaimAgainstPassages(
      'claim-without-evidence',
      'The review tool exports signed audit reports.',
      [],
      now,
    );

    expect(result.classification).toBe('unsupported');
    expect(result.errorState).toBe('no-independent-evidence');
    expect(result.supporting).toEqual([]);
    expect(result.contradicting).toEqual([]);
  });

  it('recognizes a negating passage as contradicted', () => {
    const result = classifyClaimAgainstPassages(
      'claim-contradicted',
      'The review tool supports offline review.',
      [passage('contradicted', 'The review tool does not support offline review.')],
      now,
    );

    expect(result.classification).toBe('contradicted');
    expect(result.contradicting[0]?.text).toContain('does not support');
    expect(result.supporting).toHaveLength(0);
  });

  it('distinguishes current dated support from stale dated support', () => {
    const current = classifyClaimAgainstPassages(
      'claim-time-sensitive',
      'The service price is 49 dollars per month.',
      [passage('current', 'The service price is 49 dollars per month.', currentDate)],
      now,
    );
    const stale = classifyClaimAgainstPassages(
      'claim-time-sensitive',
      'The service price is 49 dollars per month.',
      [passage('stale', 'The service price is 49 dollars per month.', staleDate)],
      now,
    );

    expect(current.classification).toBe('supported');
    expect(current.freshness).toBe('fresh');
    expect(stale.classification).toBe('stale');
    expect(stale.freshness).toBe('stale');
  });

  it('keeps the default threshold at one independent source', () => {
    const result = classifyClaimAgainstPassages(
      'claim-default',
      'The review tool supports offline review.',
      [passage('default', 'The review tool supports offline review.')],
      now,
    );

    expect(DEFAULT_MINIMUM_SUPPORTING_SOURCES).toBe(1);
    expect(result.classification).toBe('supported');
  });

  it('counts distinct documents instead of passages and counts before the excerpt cap', () => {
    const sameDocument = [
      { ...passage('same-a', 'The review tool supports offline review.'), documentId: 'doc-1' },
      { ...passage('same-b', 'The review tool supports offline review.'), documentId: 'doc-1' },
    ];
    const belowThreshold = classifyClaimAgainstPassages(
      'claim-threshold',
      'The review tool supports offline review.',
      sameDocument,
      now,
      2,
    );
    expect(belowThreshold.classification).toBe('unsupported');
    expect(belowThreshold.errorState).toBe('insufficient-independent-evidence');

    const atThreshold = classifyClaimAgainstPassages(
      'claim-threshold',
      'The review tool supports offline review.',
      Array.from({ length: 4 }, (_, index) => ({
        ...passage(`threshold-${index}`, 'The review tool supports offline review.'),
        documentId: `doc-${index}`,
      })),
      now,
      4,
    );
    expect(atThreshold.classification).toBe('supported');
    expect(atThreshold.supporting).toHaveLength(3);
  });

  it('retains contradiction precedence when the support threshold is also met', () => {
    const result = classifyClaimAgainstPassages(
      'claim-contradiction-precedence',
      'The review tool supports offline review.',
      [
        { ...passage('support-1', 'The review tool supports offline review.'), documentId: 'doc-1' },
        { ...passage('support-2', 'The review tool supports offline review.'), documentId: 'doc-2' },
        {
          ...passage('contradiction', 'The review tool does not support offline review.'),
          documentId: 'doc-3',
        },
      ],
      now,
      2,
    );

    expect(result.classification).toBe('contradicted');
  });

  it('keeps the policy and input/output contracts explicit for controlled fixtures', () => {
    expect(EVIDENCE_POLICY_VERSION).toBe('independence-v1/freshness-365d');
    expect(STALE_EVIDENCE_DAYS).toBe(365);
    expect(
      EvidenceDocumentCreate.safeParse({
        title: 'Fixture evidence',
        content: 'A submitted passage.',
      }).success,
    ).toBe(true);
    expect(
      VerificationResponse.safeParse({
        minimumSupportingSources: 1,
        verification: {
          id: 'run-1',
          projectId: 'project-1',
          startedAt: now.toISOString(),
          completedAt: now.toISOString(),
          mode: 'deterministic',
          policyVersion: EVIDENCE_POLICY_VERSION,
          status: 'completed',
          accuracy: null,
          outcomeSummary: {
            supported: 0,
            contradicted: 0,
            noIndependentEvidence: 0,
          },
          results: [],
        },
      }).success,
    ).toBe(true);
  });

  it('summarizes persisted classifications without folding stale into another outcome', () => {
    expect(
      summarizeVerificationResults([
        { classification: 'supported' },
        { classification: 'supported' },
        { classification: 'unsupported' },
        { classification: 'contradicted' },
        { classification: 'stale' },
      ]),
    ).toEqual({ supported: 2, contradicted: 1, noIndependentEvidence: 1 });
    expect(summarizeVerificationResults([])).toEqual({
      supported: 0,
      contradicted: 0,
      noIndependentEvidence: 0,
    });
    expect(
      summarizeVerificationResults([{ classification: 'stale' }, { classification: 'unsupported' }]),
    ).toEqual({ supported: 0, contradicted: 0, noIndependentEvidence: 1 });
  });
});
