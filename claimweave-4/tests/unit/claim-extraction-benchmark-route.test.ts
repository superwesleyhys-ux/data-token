// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireAdmin, findMany, runBenchmark, preflight } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  findMany: vi.fn(),
  runBenchmark: vi.fn(),
  preflight: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/require-admin', () => ({ requireAdmin }));
vi.mock('@/lib/db', () => ({
  prisma: {
    claimweaveBenchmarkRun: { findMany },
    claimweaveExtractionTrace: { findMany },
  },
}));
vi.mock('@/lib/business/claim-extraction-benchmark', () => ({
  benchmarkPreflight: preflight,
  runClaimExtractionBenchmark: runBenchmark,
}));

import { GET, POST } from '@/app/api/admin/claim-extraction-benchmark/route';

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ user: { id: 'admin-1', role: 'admin' } });
  findMany.mockResolvedValue([]);
  runBenchmark.mockResolvedValue({
    status: 'blocked',
    releaseStatus: 'blocked',
    frozenSpecIdentity: 'f'.repeat(64),
    providerCallsMade: 0,
    liveRunCreated: false,
    reasonNoProviderCall: 'blocked',
    preflight: { blockers: ['authorization_reference_missing'] },
  });
  preflight.mockReturnValue({
    releaseStatus: 'blocked',
    frozenSpecIdentity: 'f'.repeat(64),
    reasonNoProviderCall: 'blocked',
  });
});

describe('protected extraction benchmark route', () => {
  it('denies anonymous evidence reads', async () => {
    requireAdmin.mockRejectedValue(Response.json({ error: 'Unauthorized' }, { status: 401 }));
    const response = await GET();
    expect(response.status).toBe(401);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('returns redacted evidence only to an admin', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      frozenSpecIdentity: 'f'.repeat(64),
      releaseStatus: 'blocked',
      reasonNoProviderCall: 'blocked',
      preflight: {
        releaseStatus: 'blocked',
        frozenSpecIdentity: 'f'.repeat(64),
        reasonNoProviderCall: 'blocked',
      },
      runs: [],
      traces: [],
    });
    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it('fails closed before paid work when preflight is blocked', async () => {
    const response = await POST(
      new Request('http://test/api/admin/claim-extraction-benchmark', {
        method: 'POST',
        body: JSON.stringify({ mode: 'run' }),
      }),
    );
    expect(response.status).toBe(412);
    expect(runBenchmark).toHaveBeenCalledWith({ execute: true });
  });

  it('rejects an unknown control mode before invoking the benchmark', async () => {
    const response = await POST(
      new Request('http://test/api/admin/claim-extraction-benchmark', {
        method: 'POST',
        body: JSON.stringify({ mode: 'provider' }),
      }),
    );
    expect(response.status).toBe(400);
    expect(runBenchmark).not.toHaveBeenCalled();
  });
});
