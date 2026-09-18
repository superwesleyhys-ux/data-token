import { describe, expect, it } from 'vitest';
import { buildLocalFirstDemo } from '@/lib/business/local-first-demo';

describe('local-first route demonstration', () => {
  it('builds cold, exact-repeat, changed-input, and fallback traces without provider calls', () => {
    const demo = buildLocalFirstDemo();

    expect(demo.headline).toBe('Reuse local work. Make fewer AI calls.');
    expect(demo.scenarios.map((scenario) => scenario.id)).toEqual([
      'cold-start',
      'exact-repeat',
      'changed-input',
      'fallback',
    ]);
    expect(demo.scenarios[1]?.trace).toMatchObject({
      computationLocation: 'trusted-server',
      reuseDecision: 'hit',
      modelCallCount: 0,
    });
    expect(demo.scenarios[2]?.trace).toMatchObject({
      reuseDecision: 'rejected',
      fallbackReason: 'content_mismatch',
    });
    expect(demo.scenarios[2]?.steps.at(-1)).toMatchObject({
      computationLocation: 'live-model',
      modelCallCount: null,
    });
  });

  it('keeps device reuse visibly planned and all unavailable measurements nullable', () => {
    const demo = buildLocalFirstDemo();
    expect(demo.deviceReuseStatus).toBe('planned');
    for (const scenario of demo.scenarios) {
      expect(scenario.trace.latencyMs).toBeNull();
      expect(scenario.trace.transferredBytes).toBeNull();
      expect(scenario.trace.providerUsage.totalTokens).toBeNull();
      expect(scenario.trace.providerUsage.costUsd).toBeNull();
    }
    expect(demo.measurementNote).not.toMatch(/\d+%/);
  });
});
