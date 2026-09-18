import { describe, expect, it } from 'vitest';

import {
  accountRequest,
  normalizeProviderUsage,
  providerAttemptsForRequest,
  sumProviderAttempts,
} from '@/lib/business/claim-extraction-usage';

describe('claim extraction provider usage normalization', () => {
  it('preserves supplied usage, request id, optional dimensions, and cost', () => {
    expect(
      normalizeProviderUsage({
        providerRequestId: 'req-123',
        providerAttemptCount: 1,
        usage: {
          prompt_tokens: 120,
          completion_tokens: 34,
          total_tokens: 154,
          prompt_tokens_details: { cached_tokens: 12 },
          completion_tokens_details: { reasoning_tokens: 7 },
        },
        cost: 0.0042,
      }),
    ).toEqual({
      providerRequestId: 'req-123',
      providerAttemptCount: 1,
      inputTokens: 120,
      outputTokens: 34,
      totalTokens: 154,
      cachedTokens: 12,
      reasoningTokens: 7,
      usageKnown: true,
      costKnown: true,
      externalCost: 0.0042,
    });
  });

  it('keeps omitted usage, cost, and request metadata unknown rather than zero', () => {
    expect(normalizeProviderUsage({})).toEqual({
      providerRequestId: null,
      providerAttemptCount: null,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      cachedTokens: null,
      reasoningTokens: null,
      usageKnown: false,
      costKnown: false,
      externalCost: null,
    });
    expect(normalizeProviderUsage({ error: { message: 'provider unavailable' } })).toMatchObject({
      usageKnown: false,
      costKnown: false,
      inputTokens: null,
      totalTokens: null,
    });
    expect(normalizeProviderUsage(null).providerRequestId).toBeNull();
  });

  it('retains partial dimensions while marking core usage incomplete', () => {
    const usage = normalizeProviderUsage({
      usage: { prompt_tokens: 10, completion_tokens: 'unknown' },
      cost: 'unknown',
    });
    expect(usage.inputTokens).toBe(10);
    expect(usage.outputTokens).toBeNull();
    expect(usage.totalTokens).toBeNull();
    expect(usage.usageKnown).toBe(false);
    expect(usage.externalCost).toBeNull();
  });

  it('counts initial and parse-retry attempts but never counts a cache hit', () => {
    const initial = { providerRequestId: 'req-1', providerAttemptCount: 1 };
    const retry = { providerRequestId: 'req-2', providerAttemptCount: 1 };
    expect(sumProviderAttempts([initial, retry])).toBe(2);
    expect(providerAttemptsForRequest({ cacheHit: false, attempts: [initial, retry] })).toBe(2);
    expect(providerAttemptsForRequest({ cacheHit: true, attempts: [initial] })).toBe(0);
  });

  it('leaves attempts unknown when the metadata-bearing seam omits them', () => {
    expect(providerAttemptsForRequest({ cacheHit: false, attempts: [{}] })).toBeNull();
  });

  it('counts cache lifecycle events once and keeps cache/reasoning dimensions separate', () => {
    expect(
      accountRequest({
        cacheDecision: 'miss',
        modelCallMade: true,
        cacheCreation: true,
        validationCalls: 1,
        repairs: 1,
        fallbacks: 1,
        attempts: [
          {
            providerAttemptCount: 1,
            usage: {
              prompt_tokens: 10,
              completion_tokens: 5,
              total_tokens: 15,
              prompt_tokens_details: { cached_tokens: 3 },
              completion_tokens_details: { reasoning_tokens: 2 },
            },
          },
        ],
      }),
    ).toMatchObject({
      cacheCreation: 1,
      validationCalls: 1,
      repairs: 1,
      fallbacks: 1,
      retries: 0,
      providerAttempts: 1,
      totalTokens: 15,
      cachedTokens: 3,
      reasoningTokens: 2,
    });
    expect(
      accountRequest({
        cacheDecision: 'hit',
        modelCallMade: false,
        attempts: [{ providerAttemptCount: 1, usage: { total_tokens: 15 } }],
      }),
    ).toMatchObject({ providerAttempts: 0, totalTokens: null, modelCallMade: false });
  });
});
