import { describe, expect, it } from 'vitest';
import {
  LatestVerificationResponse,
  MinimumSupportingSources,
  VerificationPolicyResponse,
  VerificationPolicyUpdate,
} from '@/lib/contracts/evidence-verification';

describe('evidence verification policy contracts', () => {
  it('accepts the inclusive 1–100 threshold boundaries', () => {
    expect(MinimumSupportingSources.safeParse(1).success).toBe(true);
    expect(MinimumSupportingSources.safeParse(100).success).toBe(true);
    expect(VerificationPolicyUpdate.safeParse({ minimumSupportingSources: 2 }).success).toBe(true);
    expect(VerificationPolicyResponse.parse({ minimumSupportingSources: 2 })).toEqual({
      minimumSupportingSources: 2,
    });
  });

  it('rejects missing, fractional, non-numeric, and out-of-range thresholds', () => {
    for (const value of [undefined, 0, -1, 1.5, 101, '2', null]) {
      const input = value === undefined ? {} : { minimumSupportingSources: value };
      expect(VerificationPolicyUpdate.safeParse(input).success).toBe(false);
    }
  });

  it('requires the active threshold on a latest-verification response', () => {
    expect(
      LatestVerificationResponse.parse({
        verification: null,
        minimumSupportingSources: 1,
      }),
    ).toEqual({ verification: null, minimumSupportingSources: 1 });
  });
});
