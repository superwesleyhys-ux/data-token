import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

describe('offline exact-reuse fixture pack', () => {
  it('runs deterministically without provider calls', () => {
    const output = execFileSync(
      process.execPath,
      ['benchmarks/claim-extraction/run.mjs', '--offline'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
      },
    );
    const report = JSON.parse(output) as {
      status: string;
      offlineProviderCallsMade: number;
      providerAttemptsObserved: number | null;
      sourceAnnotationProvenance: { independent: boolean };
      fixtureHashes: Array<{ sha256: string }>;
      artifactHashes: Array<{ path: string; sha256: string }>;
      configHash: string;
      sequenceHash: string;
      frozenSpecIdentity: string;
      scenarios: Array<{
        scenarioId: string;
        decision: string;
        reason: string | null;
        providerAttempts: number;
      }>;
    };

    expect(report.status).toBe('offline_ready');
    expect(report.offlineProviderCallsMade).toBe(0);
    expect(report.providerAttemptsObserved).toBeNull();
    expect(report.configHash).toMatch(/^[a-f0-9]{64}$/);
    expect(report.sequenceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(report.frozenSpecIdentity).toMatch(/^[a-f0-9]{64}$/);
    expect(report.sourceAnnotationProvenance.independent).toBe(true);
    expect(report.fixtureHashes).toHaveLength(3);
    expect(report.fixtureHashes.every(({ sha256 }) => /^[a-f0-9]{64}$/.test(sha256))).toBe(true);
    expect(report.artifactHashes).toHaveLength(9);
    expect(
      report.artifactHashes.every(
        ({ path, sha256 }) => path.length > 0 && /^[a-f0-9]{64}$/.test(sha256),
      ),
    ).toBe(true);
    expect(report.scenarios).toEqual([
      expect.objectContaining({ scenarioId: 'cold-start', decision: 'miss', providerAttempts: 1 }),
      expect.objectContaining({ scenarioId: 'exact-repeat', decision: 'hit', providerAttempts: 0 }),
      expect.objectContaining({
        scenarioId: 'localized-edit',
        decision: 'rejected',
        reason: 'content_mismatch',
      }),
      expect.objectContaining({
        scenarioId: 'numeric-negation-date-change',
        decision: 'rejected',
        reason: 'content_mismatch',
      }),
      expect.objectContaining({ scenarioId: 'expiry', reason: 'freshness_mismatch' }),
      expect.objectContaining({
        scenarioId: 'permission-model-prompt-changes',
        decision: 'rejected',
        providerAttempts: 3,
      }),
    ]);
  });
});
