// @polsia:user-owned — shared contract for citation-ready grounded answers.
import { z } from 'zod';
import { VerificationExcerpt } from '@/lib/contracts/evidence-verification';

export const GroundedAnswerRequest = z
  .object({
    question: z.string().trim().min(1).max(4_000),
  })
  .strict();

export const GroundedAnswerModelResult = z
  .object({
    grounded: z.boolean(),
    answer: z.string().nullable(),
    claimIds: z.array(z.string().min(1)).max(100),
    reason: z.string().nullable(),
  })
  .strict();

export const GroundedAnswerCitation = z.object({
  claimId: z.string().min(1),
  claimText: z.string().min(1),
  excerpts: z.array(VerificationExcerpt).min(1),
  citationUrls: z.array(z.string().url()).min(1),
});

export const GroundedAnswerSuccess = z.object({
  grounded: z.literal(true),
  answer: z.string().trim().min(1).max(20_000),
  citations: z.array(GroundedAnswerCitation).min(1),
});

export const GroundedAnswerNoGrounding = z.object({
  grounded: z.literal(false),
  answer: z.null(),
  citations: z.array(z.never()),
  reason: z.literal('insufficient-approved-evidence'),
});

export const GroundedAnswerResponse = z.discriminatedUnion('grounded', [
  GroundedAnswerSuccess,
  GroundedAnswerNoGrounding,
]);

export type GroundedAnswerRequest = z.infer<typeof GroundedAnswerRequest>;
export type GroundedAnswerModelResult = z.infer<typeof GroundedAnswerModelResult>;
export type GroundedAnswerCitation = z.infer<typeof GroundedAnswerCitation>;
export type GroundedAnswerSuccess = z.infer<typeof GroundedAnswerSuccess>;
export type GroundedAnswerNoGrounding = z.infer<typeof GroundedAnswerNoGrounding>;
export type GroundedAnswerResponse = z.infer<typeof GroundedAnswerResponse>;
