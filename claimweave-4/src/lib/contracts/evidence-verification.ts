// @polsia:user-owned — shared contract for submitted evidence and verification results.
import { z } from 'zod';

export const VerificationClassification = z.enum([
  'supported',
  'unsupported',
  'contradicted',
  'stale',
]);

export const VerificationFreshness = z.enum(['fresh', 'stale', 'unknown']);
export const VerificationMode = z.enum(['deterministic', 'live-model']);
export const VerificationExcerptRole = z.enum(['supporting', 'contradicting']);
export const MinimumSupportingSources = z.number().int().min(1).max(100);

export const VerificationPolicyUpdate = z
  .object({
    minimumSupportingSources: MinimumSupportingSources,
  })
  .strict();

const IsoDate = z.string().datetime({ offset: true });

export const EvidencePassageInput = z.object({
  text: z.string().trim().min(1).max(20_000),
  startOffset: z.number().int().nonnegative().optional(),
  endOffset: z.number().int().nonnegative().optional(),
  sourceUrl: z.string().url().nullable().optional(),
  evidenceDate: IsoDate.nullable().optional(),
});

export const EvidenceDocumentCreate = z
  .object({
    title: z.string().trim().min(1).max(200),
    sourceUrl: z.string().url().nullable().optional(),
    publicationDate: IsoDate.nullable().optional(),
    content: z.string().trim().min(1).max(200_000).optional(),
    passages: z.array(EvidencePassageInput).min(1).max(100).optional(),
  })
  .superRefine((value, context) => {
    if (!value.content && !value.passages) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['content'],
        message: 'Provide evidence content or at least one passage.',
      });
    }
    value.passages?.forEach((passage, index) => {
      if (
        passage.startOffset !== undefined &&
        passage.endOffset !== undefined &&
        passage.endOffset < passage.startOffset
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['passages', index, 'endOffset'],
          message: 'Passage endOffset must be after startOffset.',
        });
      }
    });
  });

export const EvidencePassage = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  startOffset: z.number().int().nonnegative().nullable(),
  endOffset: z.number().int().nonnegative().nullable(),
  sourceUrl: z.string().url().nullable(),
  evidenceDate: IsoDate.nullable(),
});

export const EvidenceDocument = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  title: z.string().min(1),
  sourceUrl: z.string().url().nullable(),
  submittedAt: IsoDate,
  publicationDate: IsoDate.nullable(),
  status: z.string().min(1),
  passages: z.array(EvidencePassage),
});

export const EvidenceDocumentList = z.object({
  items: z.array(EvidenceDocument),
});

export const VerificationRequest = z.object({
  mode: VerificationMode.default('deterministic'),
  evaluation: z
    .object({
      expectedByClaimId: z.record(VerificationClassification),
    })
    .optional(),
});

export const VerificationExcerpt = z.object({
  id: z.string().min(1),
  passageId: z.string().min(1),
  documentId: z.string().min(1),
  documentTitle: z.string().min(1),
  role: VerificationExcerptRole,
  text: z.string().min(1),
  sourceUrl: z.string().url().nullable(),
  evidenceDate: IsoDate.nullable(),
});

export const VerificationResult = z.object({
  id: z.string().min(1),
  claimId: z.string().min(1),
  classification: VerificationClassification,
  freshness: VerificationFreshness,
  verifiedAt: IsoDate,
  errorState: z.string().min(1).nullable(),
  excerpts: z.array(VerificationExcerpt),
});

export const AccuracySummary = z.object({
  total: z.number().int().nonnegative(),
  correct: z.number().int().nonnegative(),
  percentage: z.number().min(0).max(100),
  evaluation: z.literal('controlled-fixture'),
});

export const VerificationOutcomeSummary = z.object({
  supported: z.number().int().nonnegative(),
  contradicted: z.number().int().nonnegative(),
  noIndependentEvidence: z.number().int().nonnegative(),
});

export const VerificationRun = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  startedAt: IsoDate,
  completedAt: IsoDate,
  mode: VerificationMode,
  policyVersion: z.string().min(1),
  status: z.literal('completed'),
  accuracy: AccuracySummary.nullable(),
  outcomeSummary: VerificationOutcomeSummary,
  results: z.array(VerificationResult),
});

export const VerificationResponse = z.object({
  verification: VerificationRun,
  minimumSupportingSources: MinimumSupportingSources,
});

export const LatestVerificationResponse = z.object({
  verification: VerificationRun.nullable(),
  minimumSupportingSources: MinimumSupportingSources,
});

export const VerificationPolicyResponse = z.object({
  minimumSupportingSources: MinimumSupportingSources,
});

export type VerificationClassification = z.infer<typeof VerificationClassification>;
export type VerificationFreshness = z.infer<typeof VerificationFreshness>;
export type VerificationMode = z.infer<typeof VerificationMode>;
export type EvidenceDocumentCreate = z.infer<typeof EvidenceDocumentCreate>;
export type EvidencePassage = z.infer<typeof EvidencePassage>;
export type EvidenceDocument = z.infer<typeof EvidenceDocument>;
export type VerificationRequest = z.infer<typeof VerificationRequest>;
export type VerificationPolicyUpdate = z.infer<typeof VerificationPolicyUpdate>;
export type VerificationExcerpt = z.infer<typeof VerificationExcerpt>;
export type VerificationResult = z.infer<typeof VerificationResult>;
export type VerificationOutcomeSummary = z.infer<typeof VerificationOutcomeSummary>;
export type VerificationRun = z.infer<typeof VerificationRun>;
