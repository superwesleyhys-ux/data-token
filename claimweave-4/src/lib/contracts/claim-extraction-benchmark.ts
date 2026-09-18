// @polsia:user-owned — validated contract for protected benchmark inspection.
import { z } from 'zod';

const jsonValue = z.unknown();

export const BenchmarkRun = z.object({
  id: z.string(),
  codeRevision: z.string(),
  configHash: z.string(),
  datasetId: z.string(),
  datasetHash: z.string().nullable(),
  status: z.string(),
  authorizationRef: z.string().nullable(),
  estimatedAttempts: z.number().int(),
  providerAttemptCeiling: z.number().int(),
  attemptsUsed: z.number().int(),
  result: jsonValue.nullable(),
  createdAt: z.coerce.date(),
  completedAt: z.coerce.date().nullable(),
});

export const ExtractionTrace = z.object({
  id: z.string(),
  benchmarkRunId: z.string().nullable(),
  requestSequenceId: z.string().nullable(),
  caseClass: z.string(),
  variant: z.string(),
  cacheKey: z.string(),
  tenantScope: z.string(),
  permissionScope: z.string(),
  cacheDecision: z.string(),
  rejectionReason: z.string().nullable(),
  modelCallMade: z.boolean(),
  providerRequestId: z.string().nullable(),
  providerAttemptCount: z.number().int().nullable(),
  inputTokens: z.number().int().nullable(),
  outputTokens: z.number().int().nullable(),
  totalTokens: z.number().int().nullable(),
  cachedTokens: z.number().int().nullable(),
  reasoningTokens: z.number().int().nullable(),
  usageKnown: z.boolean(),
  costKnown: z.boolean(),
  externalCost: z.number().nullable(),
  latencyMs: z.number().int(),
  retrievalCalls: z.number().int(),
  retrievalBytes: z.number().int(),
  claimCoverage: z.number().nullable(),
  numbersPreserved: z.number().nullable(),
  negationPreserved: z.number().nullable(),
  qualifiersPreserved: z.number().nullable(),
  citationSupport: z.number().nullable(),
  sourceSpanCorrectness: z.number().nullable(),
  staleEvidenceViolations: z.number().int(),
  counters: jsonValue,
  configHash: z.string().nullable(),
  createdAt: z.coerce.date(),
});

export const BenchmarkReport = z.object({
  frozenSpecIdentity: z.string(),
  releaseStatus: z.enum(['blocked', 'inconclusive', 'failed', 'ready']),
  reasonNoProviderCall: z.string(),
  preflight: jsonValue,
  runs: z.array(BenchmarkRun),
  traces: z.array(ExtractionTrace),
});

export const BenchmarkControlResponse = z.object({
  status: z.enum(['blocked', 'complete']),
  releaseStatus: z.enum(['blocked', 'inconclusive', 'failed', 'ready']),
  frozenSpecIdentity: z.string(),
  providerCallsMade: z.number().int().nonnegative(),
  liveRunCreated: z.boolean(),
  reasonNoProviderCall: z.string(),
  preflight: jsonValue,
  runId: z.string().optional(),
  result: jsonValue.optional(),
});

export type BenchmarkReport = z.infer<typeof BenchmarkReport>;
export type BenchmarkControlResponse = z.infer<typeof BenchmarkControlResponse>;
