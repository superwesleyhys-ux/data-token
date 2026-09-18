import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ prisma: {} }));

import {
  aggregateBenchmarkObservations,
  evaluateAnnotationQuality,
} from '@/lib/business/claim-extraction-observability';

const annotation = {
  claimId: 'claim-1',
  text: 'The team does not ship more than 10 reports and may expand.',
  quote: 'The team does not ship more than 10 reports and may expand.',
  start: 0,
  end: 59,
  numbers: ['10'],
  negated: true,
  qualifiers: ['may'],
  citationRequired: true,
};

describe('claim extraction observability', () => {
  it('scores independent annotation dimensions and keeps layers explicit', () => {
    const result = evaluateAnnotationQuality({
      annotations: [annotation],
      observedClaims: [
        {
          ...annotation,
          citationLinks: ['https://example.com/source'],
        },
      ],
    });
    expect(result.status).toBe('PASS');
    expect(result.metrics).toEqual({
      coverage: 1,
      numbers: 1,
      negation: 1,
      qualifiers: 1,
      citations: 1,
      sourceSpans: 1,
    });
  });

  it('returns inconclusive instead of scoring absent annotations', () => {
    expect(evaluateAnnotationQuality({ annotations: [], observedClaims: [] })).toEqual({
      status: 'INCONCLUSIVE',
      reason: 'independent_annotations_missing',
      metrics: null,
    });
  });

  it('requires complete baseline/treatment pairs before sequence comparisons', () => {
    const result = aggregateBenchmarkObservations([
      {
        sequenceId: 'cold-1',
        variant: 'baseline',
        modelCallMade: true,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        latencyMs: 12,
      },
    ]);
    expect(result.completeMatchedSequences).toBe(false);
    expect(result.tokenSavings).toBeNull();
    expect(result.baselineLatencyMs).toBe(12);
    expect(result.treatmentLatencyMs).toBeNull();
  });
});
