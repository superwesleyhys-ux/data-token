// @polsia:user-owned — fail-closed benchmark preflight and real-path runner.
import 'server-only';

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { createProjectFromText, createProjectFromUrl } from '@/lib/business/claim-extraction';
import {
  aggregateBenchmarkObservations,
  type BenchmarkGate,
  type BenchmarkObservation,
  evaluateAnnotationQuality,
  evaluateBenchmarkGates,
  maximumIndependentSequences,
} from '@/lib/business/claim-extraction-observability';
import type { ExtractionCaseClass } from '@/lib/business/claim-extraction-reuse';
import { prisma } from '@/lib/db';

const configPath = join(process.cwd(), 'benchmarks/claim-extraction/config.json');
const sequencePath = join(process.cwd(), 'benchmarks/claim-extraction/request-sequence.json');

const benchmarkConfigSchema = z.object({
  benchmarkSchemaVersion: z.string(),
  frozenSpecVersion: z.string(),
  recordedRevision: z.string(),
  model: z.string(),
  task: z.string(),
  taskVersion: z.string(),
  promptVersion: z.string(),
  schemaVersionForOutput: z.string(),
  effectiveOutputLimit: z.literal(10),
  hashAlgorithm: z.literal('sha256'),
  sequenceManifestPath: z.string(),
  generationParameters: z.record(z.string(), z.union([z.string(), z.number()])),
  dataset: z.object({
    id: z.string(),
    sha256: z.string().nullable(),
    pathEnv: z.string(),
    documentCount: z.number().int().nonnegative(),
    status: z.string(),
  }),
  requestSequence: z.object({
    caseClasses: z.array(z.string()),
    variants: z.array(z.enum(['baseline', 'treatment'])),
    pilotDocumentCount: z.number().int().positive(),
    minimumIndependentDocuments: z.number().int().positive(),
    requestsPerIndependentDocument: z.number().int().positive(),
  }),
  providerCachingConditions: z.string(),
  qualityCriteria: z.record(z.string(), z.string()),
  authorization: z.object({
    authorizationReferenceEnv: z.string(),
    financialCapEnv: z.string(),
    modelPermissionEnv: z.string(),
    providerObservabilityEnv: z.string(),
    allowPaidCallsEnv: z.string(),
    releaseContract: z.string(),
    maxProviderAttempts: z.number().int().positive().max(96),
    retriesCountAgainstCeiling: z.literal(true),
    autoTopUp: z.literal(false),
  }),
});

const datasetSchema = z.array(
  z.object({
    id: z.string().min(1),
    goldAnnotationId: z.string().min(1),
    cases: z.record(
      z.enum([
        'cold',
        'exact-repeat',
        'localized-edit',
        'number-or-negation-change',
        'expired-or-changed-evidence',
      ]),
      z.object({
        sourceType: z.enum(['text', 'url']),
        text: z.string().optional(),
        url: z.string().url().optional(),
        evidenceFreshUntil: z.string().datetime().optional(),
      }),
    ),
  }),
);

export type BenchmarkPreflight = {
  ready: boolean;
  releaseStatus: 'blocked' | 'inconclusive' | 'failed' | 'ready';
  reasonNoProviderCall: string;
  blockers: string[];
  gates: BenchmarkGate[];
  authorizationReference: string | null;
  configHash: string;
  sequenceHash: string;
  frozenSpecIdentity: string;
  datasetId: string;
  datasetHash: string | null;
  estimatedAttempts: number;
  estimatedCostUsd: number | null;
  maximumIndependentDocuments: number;
  providerAttemptCeiling: number;
};

function config() {
  return benchmarkConfigSchema.parse(JSON.parse(readFileSync(configPath, 'utf8')));
}

function configHash() {
  return createHash('sha256').update(readFileSync(configPath)).digest('hex');
}

function sequenceHash() {
  return createHash('sha256').update(readFileSync(sequencePath)).digest('hex');
}

function frozenSpecIdentity(configDigest: string, sequenceDigest: string) {
  return createHash('sha256').update(`${configDigest}:${sequenceDigest}`).digest('hex');
}

function datasetHash(path: string) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function benchmarkPreflight(
  environment: NodeJS.ProcessEnv = process.env,
): BenchmarkPreflight {
  const frozen = config();
  const hash = configHash();
  const sequenceDigest = sequenceHash();
  const specIdentity = frozenSpecIdentity(hash, sequenceDigest);
  const blockers: string[] = [];
  const authorizationReference =
    environment[frozen.authorization.authorizationReferenceEnv] ?? null;
  const financialCap = environment[frozen.authorization.financialCapEnv];
  const datasetPath = environment[frozen.dataset.pathEnv];
  const providerObservability = environment[frozen.authorization.providerObservabilityEnv];
  const pilotAttempts =
    frozen.requestSequence.pilotDocumentCount * frozen.requestSequence.variants.length;
  const attemptsPerIndependentDocument =
    frozen.requestSequence.requestsPerIndependentDocument * frozen.requestSequence.variants.length;
  const maximumIndependentDocuments = maximumIndependentSequences(
    frozen.authorization.maxProviderAttempts - pilotAttempts,
    attemptsPerIndependentDocument,
  );
  const estimatedAttempts =
    pilotAttempts + maximumIndependentDocuments * attemptsPerIndependentDocument;

  if (!authorizationReference) blockers.push('authorization_reference_missing');
  if (!financialCap || !Number.isFinite(Number(financialCap)) || Number(financialCap) <= 0)
    blockers.push('separate_financial_cap_missing');
  if (environment[frozen.authorization.modelPermissionEnv] !== 'approved')
    blockers.push('model_permission_missing');
  if (environment[frozen.authorization.allowPaidCallsEnv] !== 'true')
    blockers.push('explicit_paid_call_gate_missing');
  if (providerObservability !== 'available') blockers.push('provider_usage_retry_metadata_missing');
  // The installed generateObject() helper does not expose this metadata, even when
  // an operator sets the environment marker. Keep this hard blocker until a seam is shipped.
  blockers.push('framework_ai_client_hides_provider_attempts_and_usage');
  if (!datasetPath) {
    blockers.push('heldout_dataset_path_missing');
  } else {
    try {
      if (!frozen.dataset.sha256) blockers.push('heldout_dataset_hash_missing');
      else if (datasetHash(datasetPath) !== frozen.dataset.sha256)
        blockers.push('heldout_dataset_hash_mismatch');
      const dataset = datasetSchema.parse(JSON.parse(readFileSync(datasetPath, 'utf8')));
      if (dataset.length < frozen.requestSequence.pilotDocumentCount)
        blockers.push('five_document_pilot_unavailable');
      if (dataset.some((document) => !document.goldAnnotationId))
        blockers.push('gold_quality_annotations_missing');
    } catch {
      blockers.push('heldout_dataset_unreadable_or_invalid');
    }
  }
  if (maximumIndependentDocuments < 1) blockers.push('attempt_ceiling_cannot_fit_pilot');
  if (maximumIndependentDocuments < frozen.requestSequence.minimumIndependentDocuments)
    blockers.push('96_attempt_ceiling_cannot_fit_30_independent_documents');

  const gates = evaluateBenchmarkGates({
    prerequisiteArtifacts: {
      cwSup01: { inspectable: false, correctnessPassed: false },
      cwSup02: { inspectable: false, correctnessPassed: false },
    },
    ownerRequest: { current: false, costCapUsd: null },
    supervisingRelease: { explicit: false, contractAvailable: false },
    metadataSeamAvailable: false,
    heldOutEvidence: {
      documentsAvailable: Boolean(datasetPath),
      sourceHashesAvailable: Boolean(frozen.dataset.sha256),
      annotationsAvailable: Boolean(datasetPath),
    },
    matchedWorkloadComplete: false,
    offlineFixtureVerified: true,
  });
  const gateBlockers = gates.filter((gate) => gate.status !== 'PASS').map((gate) => gate.id);
  blockers.push(...gateBlockers.filter((blocker) => !blockers.includes(blocker)));
  const releaseStatus = gates.some((gate) => gate.status === 'BLOCKED')
    ? 'blocked'
    : gates.some((gate) => gate.status === 'FAIL')
      ? 'failed'
      : gates.some((gate) => gate.status === 'INCONCLUSIVE')
        ? 'inconclusive'
        : 'ready';

  return {
    ready: blockers.length === 0 && releaseStatus === 'ready',
    releaseStatus,
    reasonNoProviderCall:
      'Execution is blocked: prerequisite artifacts, a current consolidated owner request and cost cap, an explicit supervising release, and the metadata-bearing AI seam are not inspectable here.',
    blockers,
    gates,
    authorizationReference,
    configHash: hash,
    sequenceHash: sequenceDigest,
    frozenSpecIdentity: specIdentity,
    datasetId: frozen.dataset.id,
    datasetHash: frozen.dataset.sha256,
    estimatedAttempts,
    estimatedCostUsd: null,
    maximumIndependentDocuments,
    providerAttemptCeiling: frozen.authorization.maxProviderAttempts,
  };
}

type BenchmarkCase = z.infer<typeof datasetSchema>[number]['cases'] extends Record<
  string,
  infer Value
>
  ? Value
  : never;

async function extractCase(
  value: BenchmarkCase,
  ownerId: string,
  options: Parameters<typeof createProjectFromText>[2],
) {
  if (value.sourceType === 'url') {
    if (!value.url) throw new Error('Benchmark URL case is missing its URL.');
    return createProjectFromUrl({ url: value.url }, ownerId, options);
  }
  if (!value.text) throw new Error('Benchmark text case is missing its text.');
  return createProjectFromText({ text: value.text }, ownerId, options);
}

export async function runClaimExtractionBenchmark(input: { execute: boolean }) {
  const preflight = benchmarkPreflight();
  const frozen = config();
  if (!input.execute || !preflight.ready) {
    return {
      status: 'blocked' as const,
      releaseStatus: preflight.releaseStatus,
      frozenSpecIdentity: preflight.frozenSpecIdentity,
      providerCallsMade: 0,
      liveRunCreated: false,
      reasonNoProviderCall: preflight.reasonNoProviderCall,
      preflight,
    };
  }
  const datasetPath = process.env[frozen.dataset.pathEnv];
  if (!datasetPath) return { status: 'blocked', preflight };
  const dataset = datasetSchema.parse(JSON.parse(readFileSync(datasetPath, 'utf8')));
  const run = await prisma.claimweaveBenchmarkRun.create({
    data: {
      codeRevision: process.env.CLAIMWEAVE_BENCHMARK_CODE_REVISION ?? frozen.recordedRevision,
      configHash: preflight.frozenSpecIdentity,
      datasetId: frozen.dataset.id,
      datasetHash: preflight.datasetHash,
      status: 'running',
      authorizationRef: preflight.authorizationReference,
      estimatedAttempts: preflight.estimatedAttempts,
      providerAttemptCeiling: preflight.providerAttemptCeiling,
    },
  });
  const observations: BenchmarkObservation[] = [];
  const pilot = dataset.slice(0, frozen.requestSequence.pilotDocumentCount).map((document) => ({
    document,
    cases: [frozen.requestSequence.caseClasses[0] as ExtractionCaseClass],
  }));
  const heldOut = dataset
    .slice(
      frozen.requestSequence.pilotDocumentCount,
      frozen.requestSequence.pilotDocumentCount + preflight.maximumIndependentDocuments,
    )
    .map((document) => ({
      document,
      cases: frozen.requestSequence.caseClasses as ExtractionCaseClass[],
    }));
  for (const item of [...pilot, ...heldOut]) {
    const { document } = item;
    for (const variant of frozen.requestSequence.variants) {
      for (const caseClass of item.cases) {
        const benchmarkCase = document.cases[caseClass];
        if (!benchmarkCase) throw new Error(`Missing case ${caseClass} for ${document.id}.`);
        const startedAt = Date.now();
        await extractCase(benchmarkCase, `benchmark:${run.id}:${document.id}`, {
          reuseEnabled: variant === 'treatment',
          sequence: {
            benchmarkRunId: run.id,
            requestSequenceId: `${document.id}:${caseClass}`,
            caseClass,
            variant,
            configHash: preflight.frozenSpecIdentity,
            evidenceFreshUntil: benchmarkCase.evidenceFreshUntil
              ? new Date(benchmarkCase.evidenceFreshUntil)
              : undefined,
            permissionScope: 'admin:claim-extraction-benchmark',
          },
        });
        const trace = await prisma.claimweaveExtractionTrace.findFirst({
          where: {
            benchmarkRunId: run.id,
            requestSequenceId: `${document.id}:${caseClass}`,
            variant,
          },
          orderBy: { createdAt: 'desc' },
        });
        observations.push({
          variant,
          sequenceId: `${document.id}:${caseClass}`,
          caseClass,
          stage: 'extraction',
          cacheDecision: trace?.cacheDecision as
            | 'disabled'
            | 'miss'
            | 'hit'
            | 'rejected'
            | undefined,
          modelCallMade: trace?.modelCallMade ?? true,
          inputTokens: trace?.inputTokens ?? null,
          outputTokens: trace?.outputTokens ?? null,
          totalTokens: trace?.totalTokens ?? null,
          latencyMs: Date.now() - startedAt,
          costUsd: trace?.externalCost ?? null,
          providerAttemptCount: trace?.providerAttemptCount ?? null,
        });
      }
    }
  }
  const result = aggregateBenchmarkObservations(observations);
  const persistedResult = {
    ...result,
    frozenSpecIdentity: preflight.frozenSpecIdentity,
    configHash: preflight.configHash,
    sequenceHash: preflight.sequenceHash,
    releaseStatus: 'ready',
    gates: preflight.gates,
    quality: {
      extraction: evaluateAnnotationQuality({ annotations: [], observedClaims: [] }),
      wholePipeline: evaluateAnnotationQuality({ annotations: [], observedClaims: [] }),
    },
  };
  await prisma.claimweaveBenchmarkRun.update({
    where: { id: run.id },
    data: {
      status: 'complete',
      attemptsUsed: observations.length,
      result: persistedResult,
      completedAt: new Date(),
    },
  });
  return {
    status: 'complete' as const,
    releaseStatus: 'ready' as const,
    frozenSpecIdentity: preflight.frozenSpecIdentity,
    providerCallsMade: observations.filter((observation) => observation.modelCallMade).length,
    liveRunCreated: true,
    preflight,
    runId: run.id,
    result: {
      ...persistedResult,
    },
  };
}

export function readBenchmarkSequenceManifest() {
  return JSON.parse(readFileSync(sequencePath, 'utf8')) as unknown;
}
