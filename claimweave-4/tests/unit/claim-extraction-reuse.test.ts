import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ prisma: {} }));

import {
  aggregateBenchmarkObservations,
  maximumIndependentSequences,
  qualityMetrics,
} from '@/lib/business/claim-extraction-observability';
import {
  buildAcceptanceTuple,
  cacheKey,
  compareAcceptanceTuples,
  validateCachedResult,
} from '@/lib/business/claim-extraction-reuse';

const source = 'The report says no more than 12 teams use the service.';
const baseInput = {
  sourceText: source,
  sourceUrl: null,
  rawSource: source,
  tenantScope: 'tenant-a',
  permissionScope: 'member:claim-extraction',
};

describe('claim extraction exact-result acceptance', () => {
  it('builds one stable key for canonical equivalent tuples', () => {
    const first = buildAcceptanceTuple(baseInput);
    const second = buildAcceptanceTuple({ ...baseInput, evidenceFreshUntil: undefined });
    expect(cacheKey(first)).toBe(cacheKey(second));
  });

  it.each([
    ['content_mismatch', { inputDigest: 'changed' }],
    ['task_mismatch', { task: 'other' }],
    ['model_mismatch', { model: 'other' }],
    ['prompt_schema_mismatch', { promptVersion: 'other' }],
    ['generation_parameters_mismatch', { generationParameters: { temperature: 1 } }],
    ['tenant_permission_mismatch', { tenantScope: 'tenant-b' }],
    ['evidence_identity_mismatch', { evidenceDigest: 'changed' }],
    ['freshness_mismatch', { evidenceFreshUntil: '2026-09-18T00:00:00.000Z' }],
  ] as const)('names %s for a changed acceptance tuple member', (reason, change) => {
    const tuple = buildAcceptanceTuple(baseInput);
    expect(compareAcceptanceTuples(tuple, { ...tuple, ...change })).toBe(reason);
  });

  it('rejects malformed output, unsupported spans, and unsupported citations', () => {
    expect(
      validateCachedResult({
        result: { nope: true },
        sourceText: source,
        sourceUrl: null,
        rawSource: source,
        extractedAt: new Date(),
      }),
    ).toEqual({ reason: 'malformed_result' });
    expect(
      validateCachedResult({
        result: {
          claims: [
            {
              text: 'claim',
              sourceSpan: { start: 0, end: 5, quote: 'wrong' },
              citationLinks: [],
              sourceUrl: null,
            },
          ],
        },
        sourceText: source,
        sourceUrl: null,
        rawSource: source,
        extractedAt: new Date(),
      }),
    ).toEqual({ reason: 'span_mismatch' });
    expect(
      validateCachedResult({
        result: {
          claims: [
            {
              text: 'claim',
              sourceSpan: { start: 0, end: 3, quote: 'The' },
              citationLinks: ['https://other.example/claim'],
              sourceUrl: 'https://example.com/source',
            },
          ],
        },
        sourceText: source,
        sourceUrl: 'https://example.com/source',
        rawSource: '<p>The report.</p>',
        extractedAt: new Date(),
      }),
    ).toEqual({ reason: 'citation_mismatch' });
  });

  it('preserves exact source offsets on a valid hit', () => {
    const result = validateCachedResult({
      result: {
        claims: [
          {
            text: 'No more than 12 teams use the service.',
            sourceSpan: {
              start: 16,
              end: source.length - 1,
              quote: 'no more than 12 teams use the service',
            },
            citationLinks: [],
            sourceUrl: null,
          },
        ],
      },
      sourceText: source,
      sourceUrl: null,
      rawSource: source,
      extractedAt: new Date(),
    });
    expect(result).toEqual({ claims: expect.any(Array) });
    if ('claims' in result) expect(result.claims[0]?.sourceSpan.start).toBe(16);
  });
});

describe('claim extraction observations', () => {
  it('does not convert unavailable usage into zero savings', () => {
    const aggregate = aggregateBenchmarkObservations([
      {
        variant: 'baseline',
        modelCallMade: true,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        latencyMs: 10,
      },
      {
        variant: 'treatment',
        modelCallMade: false,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        latencyMs: 1,
      },
    ]);
    expect(aggregate.usageStatus).toBe('unknown');
    expect(aggregate.tokenSavings).toBeNull();
    expect(aggregate.tokenSavingsRate).toBeNull();
  });

  it('computes savings only over both complete variants', () => {
    const aggregate = aggregateBenchmarkObservations([
      {
        variant: 'baseline',
        modelCallMade: true,
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        latencyMs: 10,
      },
      {
        variant: 'treatment',
        modelCallMade: false,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        latencyMs: 1,
      },
    ]);
    expect(aggregate.tokenSavings).toBe(15);
    expect(aggregate.tokenSavingsRate).toBe(1);
  });

  it('limits sequences by the hard attempt ceiling', () => {
    expect(maximumIndependentSequences(86, 10)).toBe(8);
    expect(qualityMetrics([], source, null).citationSupport).toBe(1);
  });
});
