import { describe, expect, it } from 'vitest';
import { buildLocalFirstDemo } from '@/lib/business/local-first-demo';
import { LocalFirstDemoPayload, RouteTrace } from '@/lib/contracts/local-first';

describe('local-first contracts', () => {
  it('accepts the authored provider-free payload', () => {
    expect(LocalFirstDemoPayload.safeParse(buildLocalFirstDemo()).success).toBe(true);
  });

  it('keeps unavailable provider measurements nullable', () => {
    const trace = buildLocalFirstDemo().scenarios[0]?.trace;
    expect(trace).toBeDefined();
    expect(RouteTrace.safeParse(trace).success).toBe(true);
    expect(trace?.providerUsage.totalTokens).toBeNull();
    expect(trace?.providerUsage.costUsd).toBeNull();
  });
});
