// @polsia:user-owned — pure, provider-free local-first route demonstration.
import {
  LocalFirstDemoPayload,
  type LocalFirstScenario,
  type RouteTrace,
  unknownProviderUsage,
} from '@/lib/contracts/local-first';

function trace(input: Omit<RouteTrace, 'providerUsage'>): RouteTrace {
  return { ...input, providerUsage: unknownProviderUsage };
}

function scenario(input: LocalFirstScenario): LocalFirstScenario {
  return input;
}

export function buildLocalFirstDemo(): LocalFirstDemoPayload {
  const coldStart = scenario({
    id: 'cold-start',
    label: 'Cold start',
    description:
      'Normalize the source, miss trusted server reuse, then show the live-model boundary.',
    trace: trace({
      state: 'cold-start',
      computationLocation: 'live-model',
      reuseDecision: 'miss',
      accessCorrectness: 'unknown',
      modelCallCount: null,
      latencyMs: null,
      transferredBytes: null,
      fallbackReason: 'No validated result exists for this source yet.',
    }),
    steps: [
      {
        id: 'cold-normalize',
        label: 'Deterministic intake',
        ...trace({
          state: 'cold-start',
          computationLocation: 'deterministic-local',
          reuseDecision: 'miss',
          accessCorrectness: 'passed',
          modelCallCount: 0,
          latencyMs: null,
          transferredBytes: null,
          fallbackReason: null,
        }),
      },
      {
        id: 'cold-reuse',
        label: 'Trusted server reuse',
        ...trace({
          state: 'cold-start',
          computationLocation: 'trusted-server',
          reuseDecision: 'miss',
          accessCorrectness: 'passed',
          modelCallCount: 0,
          latencyMs: null,
          transferredBytes: null,
          fallbackReason: null,
        }),
      },
      {
        id: 'cold-model',
        label: 'Live-model fallback',
        ...trace({
          state: 'fallback',
          computationLocation: 'live-model',
          reuseDecision: 'miss',
          accessCorrectness: 'unknown',
          modelCallCount: null,
          latencyMs: null,
          transferredBytes: null,
          fallbackReason: 'Provider metadata is unavailable in this deterministic demo.',
        }),
      },
    ],
  });
  const exactRepeat = scenario({
    id: 'exact-repeat',
    label: 'Exact repeat',
    description:
      'The same acceptance tuple validates and returns trusted server reuse with no model call.',
    trace: trace({
      state: 'exact-repeat',
      computationLocation: 'trusted-server',
      reuseDecision: 'hit',
      accessCorrectness: 'passed',
      modelCallCount: 0,
      latencyMs: null,
      transferredBytes: null,
      fallbackReason: null,
    }),
    steps: [
      {
        id: 'repeat-normalize',
        label: 'Deterministic intake',
        ...trace({
          state: 'exact-repeat',
          computationLocation: 'deterministic-local',
          reuseDecision: 'miss',
          accessCorrectness: 'passed',
          modelCallCount: 0,
          latencyMs: null,
          transferredBytes: null,
          fallbackReason: null,
        }),
      },
      {
        id: 'repeat-reuse',
        label: 'Trusted server reuse',
        ...trace({
          state: 'exact-repeat',
          computationLocation: 'trusted-server',
          reuseDecision: 'hit',
          accessCorrectness: 'passed',
          modelCallCount: 0,
          latencyMs: null,
          transferredBytes: null,
          fallbackReason: null,
        }),
      },
    ],
  });
  const changedInput = scenario({
    id: 'changed-input',
    label: 'Changed input',
    description: 'A content digest mismatch rejects reuse and makes the model boundary visible.',
    trace: trace({
      state: 'changed-input',
      computationLocation: 'live-model',
      reuseDecision: 'rejected',
      accessCorrectness: 'unknown',
      modelCallCount: null,
      latencyMs: null,
      transferredBytes: null,
      fallbackReason: 'content_mismatch',
    }),
    steps: [
      {
        id: 'changed-normalize',
        label: 'Deterministic intake',
        ...trace({
          state: 'changed-input',
          computationLocation: 'deterministic-local',
          reuseDecision: 'miss',
          accessCorrectness: 'passed',
          modelCallCount: 0,
          latencyMs: null,
          transferredBytes: null,
          fallbackReason: null,
        }),
      },
      {
        id: 'changed-reuse',
        label: 'Trusted server reuse',
        ...trace({
          state: 'changed-input',
          computationLocation: 'trusted-server',
          reuseDecision: 'rejected',
          accessCorrectness: 'failed',
          modelCallCount: 0,
          latencyMs: null,
          transferredBytes: null,
          fallbackReason: 'content_mismatch',
        }),
      },
      {
        id: 'changed-model',
        label: 'Live-model fallback',
        ...trace({
          state: 'fallback',
          computationLocation: 'live-model',
          reuseDecision: 'rejected',
          accessCorrectness: 'unknown',
          modelCallCount: null,
          latencyMs: null,
          transferredBytes: null,
          fallbackReason: 'Provider metadata is unavailable in this deterministic demo.',
        }),
      },
    ],
  });
  const fallback = scenario({
    id: 'fallback',
    label: 'Fallback boundary',
    description:
      'Malformed output, stale evidence, or a scope mismatch must reject reuse before fallback.',
    trace: trace({
      state: 'fallback',
      computationLocation: 'live-model',
      reuseDecision: 'rejected',
      accessCorrectness: 'unknown',
      modelCallCount: null,
      latencyMs: null,
      transferredBytes: null,
      fallbackReason: 'reuse_rejected_before_model',
    }),
    steps: [
      {
        id: 'fallback-reuse',
        label: 'Reuse rejected',
        ...trace({
          state: 'fallback',
          computationLocation: 'trusted-server',
          reuseDecision: 'rejected',
          accessCorrectness: 'failed',
          modelCallCount: 0,
          latencyMs: null,
          transferredBytes: null,
          fallbackReason: 'stale_or_incorrect_candidate',
        }),
      },
      {
        id: 'fallback-model',
        label: 'Live-model fallback',
        ...trace({
          state: 'fallback',
          computationLocation: 'live-model',
          reuseDecision: 'rejected',
          accessCorrectness: 'unknown',
          modelCallCount: null,
          latencyMs: null,
          transferredBytes: null,
          fallbackReason: 'Provider metadata is unavailable in this deterministic demo.',
        }),
      },
    ],
  });

  return LocalFirstDemoPayload.parse({
    headline: 'Reuse local work. Make fewer AI calls.',
    supportingCopy:
      'Claimweave normalizes sources deterministically, checks trusted server reuse against the current source and permission scope, and only reaches a live model when reuse cannot be accepted.',
    deviceReuseStatus: 'planned',
    measurementNote:
      'Deterministic demo only — provider usage, cost, latency, and transferred bytes are unknown here. No savings percentage is measured.',
    scenarios: [coldStart, exactRepeat, changedInput, fallback],
    evidenceVerificationCopy:
      'Evidence verification remains a supporting use case: inspect independent passages, freshness, citations, and contradictions after the primary extraction route has produced a result.',
  });
}
