// @polsia:user-owned — extraction trace fields and deterministic quality math.
import type {
  CacheableClaim,
  CacheRejectionReason,
  ExtractionCaseClass,
  ExtractionSequenceContext,
  ExtractionVariant,
} from '@/lib/business/claim-extraction-reuse';
import type { NormalizedProviderUsage } from '@/lib/business/claim-extraction-usage';
import { prisma } from '@/lib/db';

export type ExtractionCounters = {
  cachePopulation: number;
  cacheFallback: number;
  cacheValidation: number;
  cacheRepair: number;
  providerRetry: number | null;
  normalModelCall: number;
  validHit: number;
  validationCalls: number;
  repairs: number;
  fallbacks: number;
  initialCacheCreation: number;
  providerAttempts: number | null;
};

export type ExtractionQuality = {
  claimCoverage: number;
  numbersPreserved: number;
  negationPreserved: number;
  qualifiersPreserved: number;
  citationSupport: number;
  sourceSpanCorrectness: number;
  staleEvidenceViolations: number;
};

export function emptyCounters(): ExtractionCounters {
  return {
    cachePopulation: 0,
    cacheFallback: 0,
    cacheValidation: 0,
    cacheRepair: 0,
    providerRetry: null,
    normalModelCall: 0,
    validHit: 0,
    validationCalls: 0,
    repairs: 0,
    fallbacks: 0,
    initialCacheCreation: 0,
    providerAttempts: null,
  };
}

function numberTokens(value: string): string[] {
  return value.match(/\b\d+(?:[.,]\d+)?\b/g) ?? [];
}

function hasNegation(value: string) {
  return /\b(?:no|not|never|without|cannot|can't|won't|isn't|aren't|doesn't|didn't)\b/i.test(value);
}

function qualifierTokens(value: string): string[] {
  return (
    value.match(/\b(?:may|might|can|could|up to|at least|approximately|typically|usually)\b/gi) ??
    []
  );
}

export function qualityMetrics(
  claims: CacheableClaim[],
  sourceText: string,
  sourceUrl: string | null,
): ExtractionQuality {
  const covered = claims.reduce(
    (total, claim) => total + claim.sourceSpan.end - claim.sourceSpan.start,
    0,
  );
  const sourceNumbers = numberTokens(sourceText);
  const claimNumbers = numberTokens(claims.map((claim) => claim.text).join(' '));
  const sourceHasNegation = hasNegation(sourceText);
  const claimsHaveNegation = claims.some((claim) => hasNegation(claim.text));
  const sourceQualifiers = qualifierTokens(sourceText);
  const claimQualifiers = qualifierTokens(claims.map((claim) => claim.text).join(' '));
  const citationSupport =
    sourceUrl === null
      ? 1
      : claims.length === 0
        ? 0
        : claims.filter((claim) => claim.sourceUrl === sourceUrl && claim.citationLinks.length > 0)
            .length / claims.length;
  return {
    claimCoverage: sourceText.length === 0 ? 0 : Math.min(1, covered / sourceText.length),
    numbersPreserved: sourceNumbers.every((number) => claimNumbers.includes(number)) ? 1 : 0,
    negationPreserved: sourceHasNegation === claimsHaveNegation ? 1 : 0,
    qualifiersPreserved: sourceQualifiers.every((qualifier) =>
      claimQualifiers.some((candidate) => candidate.toLowerCase() === qualifier.toLowerCase()),
    )
      ? 1
      : 0,
    citationSupport,
    sourceSpanCorrectness: claims.every(
      (claim) =>
        sourceText.slice(claim.sourceSpan.start, claim.sourceSpan.end) === claim.sourceSpan.quote,
    )
      ? 1
      : 0,
    staleEvidenceViolations: 0,
  };
}

export type TraceInput = {
  sequence?: ExtractionSequenceContext;
  caseClass?: ExtractionCaseClass;
  variant?: ExtractionVariant;
  cacheKey: string;
  tenantScope: string;
  permissionScope: string;
  cacheDecision: 'disabled' | 'miss' | 'hit' | 'rejected';
  rejectionReason?: CacheRejectionReason;
  modelCallMade: boolean;
  latencyMs: number;
  retrievalCalls: number;
  retrievalBytes: number;
  quality?: ExtractionQuality;
  counters: ExtractionCounters;
  stage?: 'extraction' | 'verification';
  sourceHash?: string;
  sourceVersion?: string;
  providerUsage?: NormalizedProviderUsage;
};

export async function recordExtractionTrace(input: TraceInput) {
  const trace = prisma.claimweaveExtractionTrace;
  if (!trace) return;
  const usage = input.providerUsage;
  const counters = {
    ...input.counters,
    request: {
      stage: input.stage ?? 'extraction',
      sourceHash: input.sourceHash ?? null,
      sourceVersion: input.sourceVersion ?? null,
      provider: 'polsia-ai-proxy',
      model: 'gpt-4o-mini',
      settings: { temperature: 0, responseFormat: 'json_object', maxClaims: 10 },
    },
  };
  await trace
    .create({
      data: {
        benchmarkRunId: input.sequence?.benchmarkRunId,
        requestSequenceId: input.sequence?.requestSequenceId,
        caseClass: input.caseClass ?? input.sequence?.caseClass ?? 'cold',
        variant: input.variant ?? input.sequence?.variant ?? 'product',
        cacheKey: input.cacheKey,
        tenantScope: input.tenantScope,
        permissionScope: input.permissionScope,
        cacheDecision: input.cacheDecision,
        rejectionReason: input.rejectionReason,
        modelCallMade: input.modelCallMade,
        providerRequestId: usage?.providerRequestId ?? null,
        providerAttemptCount: usage?.providerAttemptCount ?? null,
        inputTokens: usage?.inputTokens ?? null,
        outputTokens: usage?.outputTokens ?? null,
        totalTokens: usage?.totalTokens ?? null,
        cachedTokens: usage?.cachedTokens ?? null,
        reasoningTokens: usage?.reasoningTokens ?? null,
        usageKnown: usage?.usageKnown ?? false,
        costKnown: usage?.costKnown ?? false,
        externalCost: usage?.externalCost ?? null,
        latencyMs: input.latencyMs,
        retrievalCalls: input.retrievalCalls,
        retrievalBytes: input.retrievalBytes,
        claimCoverage: input.quality?.claimCoverage ?? null,
        numbersPreserved: input.quality?.numbersPreserved ?? null,
        negationPreserved: input.quality?.negationPreserved ?? null,
        qualifiersPreserved: input.quality?.qualifiersPreserved ?? null,
        citationSupport: input.quality?.citationSupport ?? null,
        sourceSpanCorrectness: input.quality?.sourceSpanCorrectness ?? null,
        staleEvidenceViolations: input.quality?.staleEvidenceViolations ?? 0,
        counters,
        configHash: input.sequence?.configHash,
      },
    })
    .catch(() => undefined);
}

export type BenchmarkObservation = {
  variant: ExtractionVariant;
  sequenceId?: string;
  caseClass?: ExtractionCaseClass;
  stage?: 'extraction' | 'verification';
  cacheDecision?: 'disabled' | 'miss' | 'hit' | 'rejected';
  modelCallMade: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  latencyMs: number;
  costUsd?: number | null;
  providerAttemptCount?: number | null;
};

export function aggregateBenchmarkObservations(observations: BenchmarkObservation[]) {
  const baseline = observations.filter((item) => item.variant === 'baseline');
  const treatment = observations.filter((item) => item.variant === 'treatment');
  const known = (items: BenchmarkObservation[]) => items.every((item) => item.totalTokens !== null);
  const sum = (items: BenchmarkObservation[]) =>
    known(items) ? items.reduce((total, item) => total + (item.totalTokens ?? 0), 0) : null;
  const baselineTokens = sum(baseline);
  const treatmentTokens = sum(treatment);
  const pairKeys = new Set(
    observations.map((item) => item.sequenceId).filter((value): value is string => Boolean(value)),
  );
  const completeMatchedSequences = [...pairKeys].every(
    (sequenceId) =>
      observations.some((item) => item.sequenceId === sequenceId && item.variant === 'baseline') &&
      observations.some((item) => item.sequenceId === sequenceId && item.variant === 'treatment'),
  );
  const sumKnown = (items: BenchmarkObservation[], field: 'costUsd' | 'providerAttemptCount') => {
    const values = items.map((item) => item[field] ?? null);
    return values.length > 0 && values.every((value): value is number => value !== null)
      ? values.reduce((total, value) => total + value, 0)
      : null;
  };
  const meanLatency = (items: BenchmarkObservation[]) =>
    items.length > 0
      ? items.reduce((total, item) => total + item.latencyMs, 0) / items.length
      : null;
  return {
    baselineRequests: baseline.length,
    treatmentRequests: treatment.length,
    baselineModelCalls: baseline.filter((item) => item.modelCallMade).length,
    treatmentModelCalls: treatment.filter((item) => item.modelCallMade).length,
    completeMatchedSequences: pairKeys.size > 0 && completeMatchedSequences,
    observedSequenceCount: pairKeys.size,
    baselineTokens,
    treatmentTokens,
    tokenSavings:
      baselineTokens !== null && treatmentTokens !== null ? baselineTokens - treatmentTokens : null,
    tokenSavingsRate:
      baselineTokens !== null && baselineTokens > 0 && treatmentTokens !== null
        ? (baselineTokens - treatmentTokens) / baselineTokens
        : null,
    baselineCostUsd: sumKnown(baseline, 'costUsd'),
    treatmentCostUsd: sumKnown(treatment, 'costUsd'),
    baselineProviderAttempts: sumKnown(baseline, 'providerAttemptCount'),
    treatmentProviderAttempts: sumKnown(treatment, 'providerAttemptCount'),
    baselineLatencyMs: meanLatency(baseline),
    treatmentLatencyMs: meanLatency(treatment),
    usageStatus: known([...baseline, ...treatment]) ? 'known' : 'unknown',
  };
}

export type IndependentAnnotation = {
  claimId: string;
  text: string;
  quote: string;
  start: number;
  end: number;
  numbers: string[];
  negated: boolean;
  qualifiers: string[];
  citationRequired?: boolean;
};

export type ObservedAnnotationClaim = {
  text: string;
  quote: string;
  start: number;
  end: number;
  numbers?: string[];
  negated?: boolean;
  qualifiers?: string[];
  citationLinks?: string[];
};

export type AnnotationQualityMetrics = {
  coverage: number;
  numbers: number;
  negation: number;
  qualifiers: number;
  citations: number;
  sourceSpans: number;
};

export type AnnotationQualityResult = {
  status: 'PASS' | 'INCONCLUSIVE';
  reason: string | null;
  metrics: AnnotationQualityMetrics | null;
};

function sameMembers(expected: string[], actual: string[]) {
  return expected.every((value) => actual.includes(value));
}

/** Score model output only against independently authored annotations. */
export function evaluateAnnotationQuality(input: {
  annotations: IndependentAnnotation[];
  observedClaims: ObservedAnnotationClaim[];
}): AnnotationQualityResult {
  if (input.annotations.length === 0) {
    return {
      status: 'INCONCLUSIVE',
      reason: 'independent_annotations_missing',
      metrics: null,
    };
  }
  const matches = input.annotations.map((annotation) => {
    const observed = input.observedClaims.find(
      (claim) => claim.quote === annotation.quote || claim.text === annotation.text,
    );
    if (!observed) return null;
    return {
      annotation,
      observed,
      numbers: sameMembers(annotation.numbers, observed.numbers ?? []),
      negation:
        annotation.negated ===
        (observed.negated ?? /\b(?:not|no|never|without)\b/i.test(observed.text)),
      qualifiers: sameMembers(annotation.qualifiers, observed.qualifiers ?? []),
      citations: !annotation.citationRequired || (observed.citationLinks?.length ?? 0) > 0,
      sourceSpans:
        observed.start === annotation.start &&
        observed.end === annotation.end &&
        observed.quote === annotation.quote,
    };
  });
  const complete = matches.filter((match) => match !== null);
  const ratio = (predicate: (match: NonNullable<(typeof matches)[number]>) => boolean) =>
    complete.length === 0 ? 0 : complete.filter(predicate).length / input.annotations.length;
  const metrics = {
    coverage: complete.length / input.annotations.length,
    numbers: ratio((match) => match.numbers),
    negation: ratio((match) => match.negation),
    qualifiers: ratio((match) => match.qualifiers),
    citations: ratio((match) => match.citations),
    sourceSpans: ratio((match) => match.sourceSpans),
  };
  return {
    status: complete.length === input.annotations.length ? 'PASS' : 'INCONCLUSIVE',
    reason: complete.length === input.annotations.length ? null : 'incomplete_annotation_matches',
    metrics,
  };
}

export type BenchmarkGate = {
  id: string;
  status: 'PASS' | 'FAIL' | 'BLOCKED' | 'INCONCLUSIVE';
  nextAction: string;
};

export type BenchmarkGateEvidence = {
  prerequisiteArtifacts: {
    cwSup01: { inspectable: boolean; correctnessPassed: boolean };
    cwSup02: { inspectable: boolean; correctnessPassed: boolean };
  };
  ownerRequest: { current: boolean; costCapUsd: number | null };
  supervisingRelease: { explicit: boolean; contractAvailable: boolean };
  metadataSeamAvailable: boolean;
  heldOutEvidence: {
    documentsAvailable: boolean;
    sourceHashesAvailable: boolean;
    annotationsAvailable: boolean;
  };
  matchedWorkloadComplete: boolean;
  offlineFixtureVerified: boolean;
};

function gate(id: string, status: BenchmarkGate['status'], nextAction: string): BenchmarkGate {
  return { id, status, nextAction };
}

/** Fail-closed release classification. Every gate carries exactly one action. */
export function evaluateBenchmarkGates(input: BenchmarkGateEvidence): BenchmarkGate[] {
  const prerequisites = input.prerequisiteArtifacts;
  const prerequisiteStatus =
    !prerequisites.cwSup01.inspectable || !prerequisites.cwSup02.inspectable
      ? 'BLOCKED'
      : !prerequisites.cwSup01.correctnessPassed || !prerequisites.cwSup02.correctnessPassed
        ? 'FAIL'
        : 'PASS';
  const ownerStatus =
    input.ownerRequest.current &&
    input.ownerRequest.costCapUsd !== null &&
    input.ownerRequest.costCapUsd > 0
      ? 'PASS'
      : 'BLOCKED';
  const releaseStatus =
    input.supervisingRelease.explicit && input.supervisingRelease.contractAvailable
      ? 'PASS'
      : 'BLOCKED';
  const evidenceStatus =
    input.heldOutEvidence.documentsAvailable &&
    input.heldOutEvidence.sourceHashesAvailable &&
    input.heldOutEvidence.annotationsAvailable
      ? 'PASS'
      : 'BLOCKED';
  return [
    gate(
      'prerequisite_artifacts',
      prerequisiteStatus,
      prerequisiteStatus === 'PASS'
        ? 'Retain the passing CW-SUP-01 and CW-SUP-02 artifact references.'
        : 'Inspect CW-SUP-01 and CW-SUP-02 artifacts and record passing correctness checks.',
    ),
    gate(
      'consolidated_owner_request_and_cost_cap',
      ownerStatus,
      ownerStatus === 'PASS'
        ? 'Retain the current consolidated owner request and cost cap.'
        : 'Record one current consolidated owner request with a positive cost cap.',
    ),
    gate(
      'supervising_release',
      releaseStatus,
      releaseStatus === 'PASS'
        ? 'Retain the explicit supervising release record.'
        : 'Obtain the external supervising release record required by the release contract.',
    ),
    gate(
      'metadata_bearing_ai_seam',
      input.metadataSeamAvailable ? 'PASS' : 'BLOCKED',
      input.metadataSeamAvailable
        ? 'Retain the framework metadata seam version used by the run.'
        : 'Provide a framework-owned AI result seam with request, attempt, usage, and cost metadata.',
    ),
    gate(
      'held_out_evidence',
      evidenceStatus,
      evidenceStatus === 'PASS'
        ? 'Retain the held-out source, hash, and independent annotation references.'
        : 'Supply inspectable held-out documents, source hashes, and independent annotations.',
    ),
    gate(
      'matched_workload',
      input.matchedWorkloadComplete ? 'PASS' : 'INCONCLUSIVE',
      input.matchedWorkloadComplete
        ? 'Retain paired baseline and treatment observations for every declared case.'
        : 'Complete paired baseline and treatment observations for every declared workload case.',
    ),
    gate(
      'offline_fixture',
      input.offlineFixtureVerified ? 'PASS' : 'FAIL',
      input.offlineFixtureVerified
        ? 'Retain the provider-free fixture verification output.'
        : 'Repair the provider-free fixture verification before any release review.',
    ),
  ];
}

export function maximumIndependentSequences(maxAttempts: number, requestsPerSequence: number) {
  if (
    !Number.isInteger(maxAttempts) ||
    !Number.isInteger(requestsPerSequence) ||
    requestsPerSequence <= 0
  )
    return 0;
  return Math.floor(maxAttempts / requestsPerSequence);
}
