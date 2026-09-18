// @polsia:user-owned — owner-scoped grounded answer generation and citation assembly.
import 'server-only';

import { z } from 'zod';
import { AiConfigurationError, generateObject } from '@/lib/ai/client';
import { getLatestVerification } from '@/lib/business/evidence-verification';
import type { VerificationExcerpt, VerificationRun } from '@/lib/contracts/evidence-verification';
import {
  GroundedAnswerModelResult,
  GroundedAnswerResponse,
  type GroundedAnswerResponse as GroundedAnswerResponseType,
} from '@/lib/contracts/grounded-answer';
import { prisma } from '@/lib/db';

const CitationUrl = z
  .string()
  .url()
  .refine((value) => {
    try {
      const protocol = new URL(value).protocol;
      return protocol === 'http:' || protocol === 'https:';
    } catch {
      return false;
    }
  });

type StoredClaim = {
  id: string;
  text: string;
  approvalStatus: string;
  citationLinks: unknown;
  sourceUrl: string | null;
};

export type EligibleClaim = {
  id: string;
  text: string;
  excerpts: VerificationExcerpt[];
  citationUrls: string[];
};

export class GroundedAnswerError extends Error {
  constructor(
    message: string,
    readonly status = 500,
  ) {
    super(message);
    this.name = 'GroundedAnswerError';
  }
}

const NO_GROUNDING_RESPONSE: GroundedAnswerResponseType = {
  grounded: false,
  answer: null,
  citations: [],
  reason: 'insufficient-approved-evidence',
};

function validCitationUrls(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = CitationUrl.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

export function normalizeCitationUrls(value: unknown) {
  return [...new Set(validCitationUrls(Array.isArray(value) ? value : []))];
}

function claimCitationUrls(claim: StoredClaim) {
  return normalizeCitationUrls([
    ...(Array.isArray(claim.citationLinks) ? claim.citationLinks : []),
    claim.sourceUrl,
  ]);
}

type VerificationSnapshot = Pick<VerificationRun, 'results'> | null;

export function selectEligibleClaims(
  claims: StoredClaim[],
  verification: VerificationSnapshot,
): EligibleClaim[] {
  const resultsByClaimId = new Map(verification?.results.map((result) => [result.claimId, result]));

  return claims.flatMap((claim) => {
    if (claim.approvalStatus !== 'approved') return [];
    const result = resultsByClaimId.get(claim.id);
    if (
      !result ||
      result.classification !== 'supported' ||
      (result.freshness !== 'fresh' && result.freshness !== 'unknown')
    ) {
      return [];
    }
    const excerpts = result.excerpts.filter((excerpt) => excerpt.role === 'supporting');
    const citationUrls = [
      ...new Set([
        ...excerpts.flatMap((excerpt) => normalizeCitationUrls([excerpt.sourceUrl])),
        ...claimCitationUrls(claim),
      ]),
    ];
    if (excerpts.length === 0 || citationUrls.length === 0) return [];
    return [{ id: claim.id, text: claim.text, excerpts, citationUrls }];
  });
}

export function buildGroundedAnswerPrompt(question: string, eligibleClaims: EligibleClaim[]) {
  return JSON.stringify({
    question,
    instructions: [
      'Answer the question using only the supplied approved, citation-ready evidence.',
      'If the evidence cannot answer the question, return grounded=false, answer=null, claimIds=[], and reason="insufficient-evidence".',
      'If the evidence can answer it, return grounded=true, a concise answer, and only the claim IDs that support that answer.',
      'Never invent facts, evidence excerpts, URLs, or claim IDs.',
    ],
    eligibleClaims: eligibleClaims.map((claim) => ({
      claimId: claim.id,
      claimText: claim.text,
      excerpts: claim.excerpts.map((excerpt) => ({
        excerptId: excerpt.id,
        documentTitle: excerpt.documentTitle,
        text: excerpt.text,
      })),
    })),
  });
}

function noGroundingResponse() {
  return GroundedAnswerResponse.parse(NO_GROUNDING_RESPONSE);
}

export function assembleGroundedAnswer(
  modelOutput: unknown,
  eligibleClaims: EligibleClaim[],
): GroundedAnswerResponseType {
  const parsed = GroundedAnswerModelResult.safeParse(modelOutput);
  if (!parsed.success) throw new GroundedAnswerError('Grounded answer output was invalid.', 502);
  if (!parsed.data.grounded) return noGroundingResponse();

  const answer = parsed.data.answer?.trim();
  const claimIds = [...new Set(parsed.data.claimIds)];
  if (!answer || claimIds.length === 0) {
    throw new GroundedAnswerError('Grounded answer output was incomplete.', 502);
  }

  const claimsById = new Map(eligibleClaims.map((claim) => [claim.id, claim]));
  const selectedClaims = claimIds.map((claimId) => claimsById.get(claimId));
  if (selectedClaims.some((claim) => claim === undefined)) {
    throw new GroundedAnswerError('Grounded answer output referenced an unknown claim.', 502);
  }
  const knownClaims = selectedClaims.filter((claim): claim is EligibleClaim => claim !== undefined);

  return GroundedAnswerResponse.parse({
    grounded: true,
    answer,
    citations: knownClaims.map((claim) => ({
      claimId: claim.id,
      claimText: claim.text,
      excerpts: claim.excerpts,
      citationUrls: claim.citationUrls,
    })),
  });
}

export async function createGroundedAnswer(
  projectId: string,
  userId: string,
  question: string,
): Promise<GroundedAnswerResponseType> {
  const project = await prisma.claimweaveProject.findFirst({
    where: { id: projectId, userId },
    select: {
      id: true,
      source: {
        select: {
          claims: {
            orderBy: [{ sourceStart: 'asc' }, { id: 'asc' }],
            select: {
              id: true,
              text: true,
              approvalStatus: true,
              citationLinks: true,
              sourceUrl: true,
            },
          },
        },
      },
    },
  });
  if (!project) throw new GroundedAnswerError('Project not found.', 404);

  const latestVerification = await getLatestVerification(projectId, userId);
  const eligibleClaims = selectEligibleClaims(
    (project.source?.claims ?? []) as StoredClaim[],
    latestVerification.verification,
  );
  if (eligibleClaims.length === 0) return noGroundingResponse();

  let modelOutput: unknown;
  try {
    modelOutput = await generateObject({
      task: 'grounded-answer',
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            'Return only the grounded-answer JSON contract. The server owns all citations; select only supplied eligible claim IDs.',
        },
        { role: 'user', content: buildGroundedAnswerPrompt(question, eligibleClaims) },
      ],
    });
  } catch (error) {
    if (error instanceof AiConfigurationError) {
      throw new GroundedAnswerError('Grounded answers are not configured.', 503);
    }
    throw new GroundedAnswerError('Grounded answer generation failed.', 502);
  }

  return assembleGroundedAnswer(modelOutput, eligibleClaims);
}
