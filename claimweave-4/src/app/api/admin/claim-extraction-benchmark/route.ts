// @polsia:user-owned — protected benchmark control and evidence read boundary.
import 'server-only';

import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  benchmarkPreflight,
  runClaimExtractionBenchmark,
} from '@/lib/business/claim-extraction-benchmark';
import {
  BenchmarkControlResponse,
  BenchmarkReport,
} from '@/lib/contracts/claim-extraction-benchmark';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/require-admin';

const benchmarkRequest = z.object({ mode: z.enum(['preflight', 'run']).default('preflight') });

async function requireBenchmarkAdmin() {
  try {
    await requireAdmin();
    return null;
  } catch (response) {
    if (response instanceof Response) return response;
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}

export async function GET() {
  const denied = await requireBenchmarkAdmin();
  if (denied) return denied;
  try {
    const preflight = benchmarkPreflight();
    const [runs, traces] = await Promise.all([
      prisma.claimweaveBenchmarkRun.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
      prisma.claimweaveExtractionTrace.findMany({ orderBy: { createdAt: 'desc' }, take: 200 }),
    ]);
    const report = BenchmarkReport.parse({
      frozenSpecIdentity: preflight.frozenSpecIdentity,
      releaseStatus: preflight.releaseStatus,
      reasonNoProviderCall: preflight.reasonNoProviderCall,
      preflight,
      runs,
      traces,
    });
    return NextResponse.json(report);
  } catch {
    return NextResponse.json({ error: 'Could not load benchmark evidence.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const denied = await requireBenchmarkAdmin();
  if (denied) return denied;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const parsed = benchmarkRequest.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Use mode=preflight or mode=run.' }, { status: 400 });
  }
  try {
    const result = await runClaimExtractionBenchmark({ execute: parsed.data.mode === 'run' });
    const response = BenchmarkControlResponse.parse(result);
    return NextResponse.json(response, { status: response.status === 'blocked' ? 412 : 200 });
  } catch {
    return NextResponse.json({ error: 'Benchmark execution failed.' }, { status: 500 });
  }
}
