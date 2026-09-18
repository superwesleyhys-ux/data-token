// @polsia:user-owned — public local-first route and homepage contract.
import { z } from 'zod';

export const ProcessingRoute = z.enum([
  'trusted-server-reuse',
  'trusted-device-reuse',
  'model-fallback',
  'legacy-unknown',
]);

export const TraceLocation = z.enum([
  'deterministic-local',
  'trusted-server',
  'trusted-device',
  'live-model',
  'unknown',
]);

export const ReuseDecision = z.enum(['hit', 'miss', 'rejected', 'unknown']);
export const AccessCorrectness = z.enum(['passed', 'failed', 'unknown']);
export const TraceState = z.enum(['cold-start', 'exact-repeat', 'changed-input', 'fallback']);

export const ProviderUsage = z.object({
  attempts: z.number().int().nonnegative().nullable(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  totalTokens: z.number().int().nonnegative().nullable(),
  costUsd: z.number().nonnegative().nullable(),
});

export const RouteTrace = z.object({
  state: TraceState,
  computationLocation: TraceLocation,
  reuseDecision: ReuseDecision,
  accessCorrectness: AccessCorrectness,
  modelCallCount: z.number().int().nonnegative().nullable(),
  providerUsage: ProviderUsage,
  latencyMs: z.number().int().nonnegative().nullable(),
  transferredBytes: z.number().int().nonnegative().nullable(),
  fallbackReason: z.string().min(1).nullable(),
});

export const RouteTraceStep = RouteTrace.extend({
  id: z.string().min(1),
  label: z.string().min(1),
});

export const LocalFirstScenario = z.object({
  id: z.enum(['cold-start', 'exact-repeat', 'changed-input', 'fallback']),
  label: z.string().min(1),
  description: z.string().min(1),
  trace: RouteTrace,
  steps: z.array(RouteTraceStep).min(1),
});

export const LocalFirstDemoPayload = z.object({
  headline: z.string().min(1),
  supportingCopy: z.string().min(1),
  deviceReuseStatus: z.literal('planned'),
  measurementNote: z.string().min(1),
  scenarios: z.array(LocalFirstScenario).min(4),
  evidenceVerificationCopy: z.string().min(1),
});

export type ProcessingRoute = z.infer<typeof ProcessingRoute>;
export type ProviderUsage = z.infer<typeof ProviderUsage>;
export type RouteTrace = z.infer<typeof RouteTrace>;
export type RouteTraceStep = z.infer<typeof RouteTraceStep>;
export type LocalFirstScenario = z.infer<typeof LocalFirstScenario>;
export type LocalFirstDemoPayload = z.infer<typeof LocalFirstDemoPayload>;

export const unknownProviderUsage: ProviderUsage = {
  attempts: null,
  inputTokens: null,
  outputTokens: null,
  totalTokens: null,
  costUsd: null,
};

export function traceForProcessingRoute(route: ProcessingRoute): RouteTrace {
  if (route === 'trusted-server-reuse') {
    return {
      state: 'exact-repeat',
      computationLocation: 'trusted-server',
      reuseDecision: 'hit',
      accessCorrectness: 'passed',
      modelCallCount: 0,
      providerUsage: unknownProviderUsage,
      latencyMs: null,
      transferredBytes: null,
      fallbackReason: null,
    };
  }
  if (route === 'model-fallback') {
    return {
      state: 'fallback',
      computationLocation: 'live-model',
      reuseDecision: 'miss',
      accessCorrectness: 'passed',
      modelCallCount: 1,
      providerUsage: unknownProviderUsage,
      latencyMs: null,
      transferredBytes: null,
      fallbackReason: 'Validated reuse was unavailable or rejected.',
    };
  }
  return {
    state: 'fallback',
    computationLocation: 'unknown',
    reuseDecision: 'unknown',
    accessCorrectness: 'unknown',
    modelCallCount: null,
    providerUsage: unknownProviderUsage,
    latencyMs: null,
    transferredBytes: null,
    fallbackReason: null,
  };
}
