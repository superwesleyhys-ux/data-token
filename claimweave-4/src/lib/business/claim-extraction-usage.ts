// @polsia:user-owned — offline normalization for the framework AI seam contract.

export type NormalizedProviderUsage = {
  providerRequestId: string | null;
  providerAttemptCount: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cachedTokens: number | null;
  reasoningTokens: number | null;
  usageKnown: boolean;
  costKnown: boolean;
  externalCost: number | null;
};

export type ProviderAttemptMetadata = {
  providerRequestId?: unknown;
  providerAttemptCount?: unknown;
  usage?: unknown;
  cost?: unknown;
};

const emptyUsage: NormalizedProviderUsage = {
  providerRequestId: null,
  providerAttemptCount: null,
  inputTokens: null,
  outputTokens: null,
  totalTokens: null,
  cachedTokens: null,
  reasoningTokens: null,
  usageKnown: false,
  costKnown: false,
  externalCost: null,
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonNegativeInteger(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function requestId(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Normalize a metadata-bearing provider response without inventing values.
 * Core usage is known only when prompt, completion, and total tokens are all
 * present; optional cache/reasoning dimensions stay nullable when omitted.
 */
export function normalizeProviderUsage(input: unknown): NormalizedProviderUsage {
  const metadata = record(input);
  if (!metadata) return { ...emptyUsage };

  const usage = record(metadata.usage);
  const inputTokens = nonNegativeInteger(usage?.prompt_tokens ?? usage?.input_tokens);
  const outputTokens = nonNegativeInteger(usage?.completion_tokens ?? usage?.output_tokens);
  const totalTokens = nonNegativeInteger(usage?.total_tokens ?? usage?.totalTokens);
  const cachedTokens = nonNegativeInteger(
    usage?.cached_tokens ?? record(usage?.prompt_tokens_details)?.cached_tokens,
  );
  const reasoningTokens = nonNegativeInteger(
    usage?.reasoning_tokens ?? record(usage?.completion_tokens_details)?.reasoning_tokens,
  );
  const providerAttemptCount = nonNegativeInteger(metadata.providerAttemptCount);
  const externalCost = finiteNumber(metadata.cost);

  return {
    providerRequestId: requestId(metadata.providerRequestId),
    providerAttemptCount,
    inputTokens,
    outputTokens,
    totalTokens,
    cachedTokens,
    reasoningTokens,
    usageKnown: inputTokens !== null && outputTokens !== null && totalTokens !== null,
    costKnown: externalCost !== null,
    externalCost,
  };
}

/** Sum attempts across the initial response and any parse-retry response. */
export function sumProviderAttempts(attempts: ProviderAttemptMetadata[]) {
  const counts = attempts.map((attempt) => normalizeProviderUsage(attempt).providerAttemptCount);
  return counts.length > 0 && counts.every((count): count is number => count !== null)
    ? counts.reduce((total, count) => total + count, 0)
    : null;
}

/** A cache hit is a zero-provider-attempt outcome, never a zero-token outcome. */
export function providerAttemptsForRequest(input: {
  cacheHit: boolean;
  attempts: ProviderAttemptMetadata[];
}) {
  if (input.cacheHit) return 0;
  return sumProviderAttempts(input.attempts);
}

export type RequestAccounting = {
  modelCallMade: boolean;
  cacheCreation: number;
  validationCalls: number;
  repairs: number;
  retries: number | null;
  fallbacks: number;
  providerAttempts: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cachedTokens: number | null;
  reasoningTokens: number | null;
  costUsd: number | null;
};

/**
 * Collapse one logical request into one accounting record. Attempt metadata is
 * summed once per provider response; cached and reasoning subfields remain
 * separate dimensions and are never added to total tokens.
 */
export function accountRequest(input: {
  cacheDecision: 'disabled' | 'miss' | 'hit' | 'rejected';
  modelCallMade: boolean;
  cacheCreation?: boolean;
  validationCalls?: number;
  repairs?: number;
  fallbacks?: number;
  attempts?: ProviderAttemptMetadata[];
}): RequestAccounting {
  const attempts = input.cacheDecision === 'hit' ? [] : (input.attempts ?? []);
  const normalized = attempts.map(normalizeProviderUsage);
  const sumKnown = (values: Array<number | null>) =>
    values.length > 0 && values.every((value): value is number => value !== null)
      ? values.reduce((total, value) => total + value, 0)
      : null;
  return {
    modelCallMade: input.modelCallMade,
    cacheCreation: input.cacheCreation ? 1 : 0,
    validationCalls: input.validationCalls ?? 0,
    repairs: input.repairs ?? 0,
    retries:
      attempts.length > 0 ? Math.max(0, attempts.length - 1) : input.modelCallMade ? null : 0,
    fallbacks: input.fallbacks ?? (input.cacheDecision === 'rejected' ? 1 : 0),
    providerAttempts: providerAttemptsForRequest({
      cacheHit: input.cacheDecision === 'hit',
      attempts,
    }),
    inputTokens: sumKnown(normalized.map((item) => item.inputTokens)),
    outputTokens: sumKnown(normalized.map((item) => item.outputTokens)),
    totalTokens: sumKnown(normalized.map((item) => item.totalTokens)),
    cachedTokens: sumKnown(normalized.map((item) => item.cachedTokens)),
    reasoningTokens: sumKnown(normalized.map((item) => item.reasoningTokens)),
    costUsd: sumKnown(normalized.map((item) => item.externalCost)),
  };
}
