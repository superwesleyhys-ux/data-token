// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/business/claim-extraction', () => ({
  createProjectFromText: vi.fn(),
  createProjectFromUrl: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    claimweaveBenchmarkRun: { create: vi.fn(), update: vi.fn() },
  },
}));

import {
  benchmarkPreflight,
  runClaimExtractionBenchmark,
} from '@/lib/business/claim-extraction-benchmark';
import { evaluateBenchmarkGates } from '@/lib/business/claim-extraction-observability';

describe('claim extraction benchmark release gate', () => {
  it('freezes both manifests and blocks the live branch without creating a run', async () => {
    const preflight = benchmarkPreflight({ NODE_ENV: 'test' });
    expect(preflight.ready).toBe(false);
    expect(preflight.releaseStatus).toBe('blocked');
    expect(preflight.configHash).toMatch(/^[a-f0-9]{64}$/);
    expect(preflight.sequenceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(preflight.frozenSpecIdentity).toMatch(/^[a-f0-9]{64}$/);
    expect(preflight.gates.every((item) => item.nextAction.length > 0)).toBe(true);

    const result = await runClaimExtractionBenchmark({ execute: true });
    expect(result.status).toBe('blocked');
    expect(result.providerCallsMade).toBe(0);
    expect(result.liveRunCreated).toBe(false);
  });

  it('requires every release input independently of queue state or attempt counts', () => {
    const gates = evaluateBenchmarkGates({
      prerequisiteArtifacts: {
        cwSup01: { inspectable: true, correctnessPassed: true },
        cwSup02: { inspectable: true, correctnessPassed: true },
      },
      ownerRequest: { current: true, costCapUsd: 1 },
      supervisingRelease: { explicit: true, contractAvailable: true },
      metadataSeamAvailable: true,
      heldOutEvidence: {
        documentsAvailable: true,
        sourceHashesAvailable: true,
        annotationsAvailable: true,
      },
      matchedWorkloadComplete: true,
      offlineFixtureVerified: true,
    });
    expect(gates.every((item) => item.status === 'PASS')).toBe(true);
    expect(gates.every((item) => item.nextAction.length > 0)).toBe(true);
  });

  it('does not treat missing matched pairs as a quality pass', () => {
    const gates = evaluateBenchmarkGates({
      prerequisiteArtifacts: {
        cwSup01: { inspectable: true, correctnessPassed: true },
        cwSup02: { inspectable: true, correctnessPassed: true },
      },
      ownerRequest: { current: true, costCapUsd: 1 },
      supervisingRelease: { explicit: true, contractAvailable: true },
      metadataSeamAvailable: true,
      heldOutEvidence: {
        documentsAvailable: true,
        sourceHashesAvailable: true,
        annotationsAvailable: true,
      },
      matchedWorkloadComplete: false,
      offlineFixtureVerified: true,
    });
    expect(gates.find((item) => item.id === 'matched_workload')?.status).toBe('INCONCLUSIVE');
  });
});
