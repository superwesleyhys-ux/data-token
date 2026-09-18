// @polsia:user-owned — independent evidence selection, classification, and persistence.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AiConfigurationError, generateObject } from '@/lib/ai/client';
import {
  createClaimweaveRevision,
  type RevisionEvidenceItem,
  type RevisionEvidenceValue,
} from '@/lib/business/claimweave-revisions';
import {
  EvidenceDocument,
  type EvidenceDocumentCreate,
  LatestVerificationResponse,
  VerificationClassification,
  type VerificationOutcomeSummary,
  type VerificationRequest,
  VerificationResponse,
  VerificationResult,
  VerificationRun,
} from '@/lib/contracts/evidence-verification';
import { prisma } from '@/lib/db';

export const EVIDENCE_POLICY_VERSION = 'independence-v1/freshness-365d';
export const STALE_EVIDENCE_DAYS = 365;
export const DEFAULT_MINIMUM_SUPPORTING_SOURCES = 1;

export class EvidenceVerificationError extends Error {
  constructor(
    message: string,
    readonly status = 422,
  ) {
    super(message);
    this.name = 'EvidenceVerificationError';
  }
}

export type VerificationPassage = {
  id: string;
  documentId: string;
  documentTitle: string;
  text: string;
  sourceUrl: string | null;
  evidenceDate: Date | null;
};

type ClassifiedResult = {
  claimId: string;
  classification: VerificationClassification;
  freshness: 'fresh' | 'stale' | 'unknown';
  errorState: string | null;
  supporting: VerificationPassage[];
  contradicting: VerificationPassage[];
};

export function summarizeVerificationResults(
  results: ReadonlyArray<{ classification: string }>,
): VerificationOutcomeSummary {
  return results.reduce<VerificationOutcomeSummary>(
    (summary, result) => {
      if (result.classification === 'supported') summary.supported += 1;
      if (result.classification === 'contradicted') summary.contradicted += 1;
      if (result.classification === 'unsupported') summary.noIndependentEvidence += 1;
      return summary;
    },
    { supported: 0, contradicted: 0, noIndependentEvidence: 0 },
  );
}

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'with',
]);
const NEGATION_WORDS = new Set([
  'cannot',
  'doesnt',
  'dont',
  'isnt',
  'never',
  'no',
  'not',
  'without',
]);

function tokens(value: string) {
  return (
    value
      .toLowerCase()
      .replaceAll("can't", 'cannot')
      .replaceAll("doesn't", 'doesnt')
      .replaceAll("don't", 'dont')
      .replaceAll("isn't", 'isnt')
      .match(/[a-z0-9]+/g)
      ?.map((token) => (token.length > 4 && token.endsWith('s') ? token.slice(0, -1) : token)) ?? []
  );
}

function meaningfulTokens(value: string) {
  return tokens(value).filter((token) => !STOP_WORDS.has(token) && !NEGATION_WORDS.has(token));
}

function isNegated(value: string) {
  return tokens(value).some((token) => NEGATION_WORDS.has(token));
}

function hasClaimMatch(claim: string, passage: string) {
  const claimTokens = meaningfulTokens(claim);
  const passageTokens = tokens(passage);
  if (claimTokens.length === 0) return false;
  const phrase = claimTokens.join(' ');
  const normalizedPassage = meaningfulTokens(passage).join(' ');
  if (normalizedPassage.includes(phrase)) return true;
  const passageSet = new Set(passageTokens);
  return claimTokens.length >= 2 && claimTokens.every((token) => passageSet.has(token));
}

function passagePolarityContradicts(claim: string, passage: string) {
  if (!hasClaimMatch(claim, passage)) return false;
  return isNegated(claim) !== isNegated(passage);
}

function freshnessFor(date: Date | null, now: Date) {
  if (!date) return 'unknown' as const;
  const staleAt = now.getTime() - STALE_EVIDENCE_DAYS * 24 * 60 * 60 * 1000;
  return date.getTime() < staleAt ? ('stale' as const) : ('fresh' as const);
}

function aggregateFreshness(passages: VerificationPassage[], now: Date) {
  const freshness = passages.map((passage) => freshnessFor(passage.evidenceDate, now));
  if (freshness.includes('fresh')) return 'fresh' as const;
  if (freshness.includes('unknown')) return 'unknown' as const;
  return 'stale' as const;
}

/** Pure deterministic classifier used by the API and the controlled fixture suite. */
export function classifyClaimAgainstPassages(
  claimId: string,
  claimText: string,
  passages: VerificationPassage[],
  now: Date,
  minimumSupportingSources = DEFAULT_MINIMUM_SUPPORTING_SOURCES,
): ClassifiedResult {
  const supporting = passages.filter(
    (passage) =>
      hasClaimMatch(claimText, passage.text) &&
      !passagePolarityContradicts(claimText, passage.text),
  );
  const contradicting = passages.filter((passage) =>
    passagePolarityContradicts(claimText, passage.text),
  );
  if (contradicting.length > 0) {
    return {
      claimId,
      classification: 'contradicted',
      freshness: aggregateFreshness(contradicting, now),
      errorState: null,
      supporting: supporting.slice(0, 3),
      contradicting: contradicting.slice(0, 3),
    };
  }
  if (supporting.length === 0) {
    return {
      claimId,
      classification: 'unsupported',
      freshness: 'unknown',
      errorState: 'no-independent-evidence',
      supporting: [],
      contradicting: [],
    };
  }
  const freshness = aggregateFreshness(supporting, now);
  const distinctSupportingDocuments = new Set(supporting.map((passage) => passage.documentId));
  if (freshness === 'stale') {
    return {
      claimId,
      classification: 'stale',
      freshness,
      errorState: 'all-matching-evidence-is-stale',
      supporting: supporting.slice(0, 3),
      contradicting: [],
    };
  }
  if (distinctSupportingDocuments.size < minimumSupportingSources) {
    return {
      claimId,
      classification: 'unsupported',
      freshness,
      errorState: 'insufficient-independent-evidence',
      supporting: supporting.slice(0, 3),
      contradicting: [],
    };
  }
  return {
    claimId,
    classification: 'supported',
    freshness,
    errorState: null,
    supporting: supporting.slice(0, 3),
    contradicting: [],
  };
}

function sameUrl(left: string | null | undefined, right: string | null | undefined) {
  if (!left || !right) return false;
  try {
    return new URL(left).toString() === new URL(right).toString();
  } catch {
    return left === right;
  }
}

function hashContent(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function responseDocument(document: {
  id: string;
  projectId: string;
  title: string;
  sourceUrl: string | null;
  submittedAt: Date;
  publicationDate: Date | null;
  status: string;
  passages: Array<{
    id: string;
    text: string;
    startOffset: number | null;
    endOffset: number | null;
    sourceUrl: string | null;
    evidenceDate: Date | null;
  }>;
}) {
  return EvidenceDocument.parse({
    id: document.id,
    projectId: document.projectId,
    title: document.title,
    sourceUrl: document.sourceUrl,
    submittedAt: document.submittedAt.toISOString(),
    publicationDate: document.publicationDate?.toISOString() ?? null,
    status: document.status,
    passages: document.passages.map((passage) => ({
      id: passage.id,
      text: passage.text,
      startOffset: passage.startOffset,
      endOffset: passage.endOffset,
      sourceUrl: passage.sourceUrl,
      evidenceDate: passage.evidenceDate?.toISOString() ?? null,
    })),
  });
}

function makePassageList(
  input: EvidenceDocumentCreate,
  normalizedContent: string,
  publicationDate: Date | null,
) {
  if (input.passages) {
    return input.passages.map((passage) => ({
      text: passage.text,
      startOffset: passage.startOffset ?? null,
      endOffset: passage.endOffset ?? null,
      sourceUrl: passage.sourceUrl ?? input.sourceUrl ?? null,
      evidenceDate: passage.evidenceDate ? new Date(passage.evidenceDate) : publicationDate,
    }));
  }
  return [
    {
      text: normalizedContent,
      startOffset: 0,
      endOffset: normalizedContent.length,
      sourceUrl: input.sourceUrl ?? null,
      evidenceDate: publicationDate,
    },
  ];
}

export async function createEvidenceDocument(
  projectId: string,
  userId: string,
  input: EvidenceDocumentCreate,
  now = new Date(),
) {
  const project = await prisma.claimweaveProject.findFirst({
    where: { id: projectId, userId },
    select: { id: true, source: { select: { url: true, normalizedContent: true } } },
  });
  if (!project?.source) throw new EvidenceVerificationError('Project not found.', 404);
  const normalizedContent =
    input.content?.trim() ?? input.passages?.map((passage) => passage.text).join('\n\n') ?? '';
  if (
    sameUrl(input.sourceUrl, project.source.url) ||
    (project.source.normalizedContent !== null &&
      normalizedContent === project.source.normalizedContent)
  ) {
    throw new EvidenceVerificationError(
      'The primary extraction source cannot be submitted as independent evidence.',
      400,
    );
  }
  if (input.passages?.some((passage) => sameUrl(passage.sourceUrl, project.source?.url))) {
    throw new EvidenceVerificationError(
      'A passage cannot cite the primary extraction source as independent evidence.',
      400,
    );
  }
  const publicationDate = input.publicationDate ? new Date(input.publicationDate) : null;
  const passages = makePassageList(input, normalizedContent, publicationDate);
  for (const passage of passages) {
    if (
      passage.startOffset !== null &&
      passage.endOffset !== null &&
      passage.endOffset > normalizedContent.length
    ) {
      throw new EvidenceVerificationError(
        'Passage offsets must be within the submitted content.',
        400,
      );
    }
  }
  const created = await prisma.claimweaveEvidenceDocument.create({
    data: {
      projectId,
      userId,
      title: input.title,
      sourceUrl: input.sourceUrl ?? null,
      submittedAt: now,
      publicationDate,
      normalizedContent,
      contentHash: hashContent(normalizedContent),
      status: 'submitted',
      passages: { create: passages },
    },
    include: { passages: { orderBy: { createdAt: 'asc' } } },
  });
  return responseDocument(created);
}

export async function listEvidenceDocuments(projectId: string, userId: string) {
  const project = await prisma.claimweaveProject.findFirst({
    where: { id: projectId, userId },
    select: { id: true },
  });
  if (!project) throw new EvidenceVerificationError('Project not found.', 404);
  const documents = await prisma.claimweaveEvidenceDocument.findMany({
    where: { projectId, userId },
    include: { passages: { orderBy: { createdAt: 'asc' } } },
    orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
  });
  return { items: documents.map(responseDocument) };
}

const liveOutputSchema = z.object({
  results: z.array(
    z.object({
      claimId: z.string().min(1),
      classification: VerificationClassification,
      supportingPassageIds: z.array(z.string()).default([]),
      contradictingPassageIds: z.array(z.string()).default([]),
    }),
  ),
});

async function classifyWithLiveModel(
  claims: Array<{ id: string; text: string }>,
  passages: VerificationPassage[],
  now: Date,
  minimumSupportingSources: number,
) {
  let output: unknown;
  try {
    output = await generateObject({
      task: 'evidence-verification',
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            'Classify each claim using only the supplied passage IDs. Return JSON with results containing claimId, classification, supportingPassageIds, and contradictingPassageIds. Never invent passage text.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            claims,
            passages: passages.map((passage) => ({
              id: passage.id,
              documentTitle: passage.documentTitle,
              text: passage.text,
              evidenceDate: passage.evidenceDate?.toISOString() ?? null,
            })),
          }),
        },
      ],
    });
  } catch (error) {
    if (error instanceof AiConfigurationError) {
      throw new EvidenceVerificationError('Live-model verification is not configured.', 503);
    }
    throw new EvidenceVerificationError('Live-model verification failed.', 502);
  }
  const parsed = liveOutputSchema.safeParse(output);
  if (!parsed.success) throw new EvidenceVerificationError('Live-model output was invalid.', 502);
  const claimIds = new Set(claims.map((claim) => claim.id));
  const passagesById = new Map(passages.map((passage) => [passage.id, passage]));
  if (parsed.data.results.length !== claims.length) {
    throw new EvidenceVerificationError('Live-model output did not cover every claim.', 502);
  }
  return parsed.data.results.map((result) => {
    if (!claimIds.has(result.claimId)) {
      throw new EvidenceVerificationError('Live-model output referenced an unknown claim.', 502);
    }
    const supporting = result.supportingPassageIds.map((id) => passagesById.get(id));
    const contradicting = result.contradictingPassageIds.map((id) => passagesById.get(id));
    if (supporting.some((passage) => !passage) || contradicting.some((passage) => !passage)) {
      throw new EvidenceVerificationError('Live-model output referenced unknown evidence.', 502);
    }
    const selectedSupporting = supporting.filter((passage): passage is VerificationPassage =>
      Boolean(passage),
    );
    const selectedContradicting = contradicting.filter((passage): passage is VerificationPassage =>
      Boolean(passage),
    );
    const allSelected = [...selectedSupporting, ...selectedContradicting];
    if (result.classification === 'supported' && selectedSupporting.length === 0) {
      throw new EvidenceVerificationError('Live-model support had no stored passage.', 502);
    }
    if (result.classification === 'contradicted' && selectedContradicting.length === 0) {
      throw new EvidenceVerificationError('Live-model contradiction had no stored passage.', 502);
    }
    const freshness = aggregateFreshness(allSelected, now);
    const distinctSupportingDocuments = new Set(
      selectedSupporting.map((passage) => passage.documentId),
    );
    const classification =
      selectedContradicting.length > 0
        ? 'contradicted'
        : result.classification === 'supported' &&
            distinctSupportingDocuments.size < minimumSupportingSources
          ? 'unsupported'
          : result.classification === 'supported' && freshness === 'stale'
            ? 'stale'
            : result.classification;
    return {
      claimId: result.claimId,
      classification,
      freshness,
      errorState:
        classification === 'unsupported'
          ? result.classification === 'supported'
            ? 'insufficient-independent-evidence'
            : 'no-independent-evidence'
          : classification === 'stale'
            ? 'all-matching-evidence-is-stale'
            : null,
      supporting: selectedSupporting.slice(0, 3),
      contradicting: selectedContradicting.slice(0, 3),
    } satisfies ClassifiedResult;
  });
}

function responseRun(run: {
  id: string;
  projectId: string;
  startedAt: Date;
  completedAt: Date | null;
  mode: string;
  policyVersion: string;
  status: string;
  accuracyTotal: number | null;
  accuracyCorrect: number | null;
  accuracyPercentage: number | null;
  results: Array<{
    id: string;
    claimId: string;
    classification: string;
    freshness: string;
    verifiedAt: Date;
    errorState: string | null;
    excerpts: Array<{
      id: string;
      passageId: string;
      documentId: string;
      documentTitle: string;
      role: string;
      text: string;
      sourceUrl: string | null;
      evidenceDate: Date | null;
    }>;
  }>;
}) {
  if (run.status !== 'completed' || !run.completedAt) return null;
  return VerificationRun.parse({
    id: run.id,
    projectId: run.projectId,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt.toISOString(),
    mode: run.mode,
    policyVersion: run.policyVersion,
    status: 'completed',
    accuracy:
      run.accuracyTotal !== null && run.accuracyCorrect !== null && run.accuracyPercentage !== null
        ? {
            total: run.accuracyTotal,
            correct: run.accuracyCorrect,
            percentage: run.accuracyPercentage,
            evaluation: 'controlled-fixture',
          }
        : null,
    outcomeSummary: summarizeVerificationResults(run.results),
    results: run.results.map((result) =>
      VerificationResult.parse({
        id: result.id,
        claimId: result.claimId,
        classification: result.classification,
        freshness: result.freshness,
        verifiedAt: result.verifiedAt.toISOString(),
        errorState: result.errorState,
        excerpts: result.excerpts.map((excerpt) => ({
          id: excerpt.id,
          passageId: excerpt.passageId,
          documentId: excerpt.documentId,
          documentTitle: excerpt.documentTitle,
          role: excerpt.role,
          text: excerpt.text,
          sourceUrl: excerpt.sourceUrl,
          evidenceDate: excerpt.evidenceDate?.toISOString() ?? null,
        })),
      }),
    ),
  });
}

function revisionEvidenceItems(run: {
  id: string;
  results: Array<{
    id: string;
    claimId: string;
    classification: string;
    freshness: string;
    errorState: string | null;
    excerpts: Array<{
      id: string;
      passageId: string;
      documentId: string;
      documentTitle: string;
      role: string;
      text: string;
      sourceUrl: string | null;
      evidenceDate: Date | null;
    }>;
  }>;
}): RevisionEvidenceItem[] {
  const items: RevisionEvidenceItem[] = [];
  for (const result of run.results) {
    const value: RevisionEvidenceValue = {
      claimId: result.claimId,
      classification: result.classification as RevisionEvidenceValue['classification'],
      freshness: result.freshness as RevisionEvidenceValue['freshness'],
      errorState: result.errorState,
      excerpts: result.excerpts.map((excerpt) => ({
        id: excerpt.id,
        passageId: excerpt.passageId,
        documentId: excerpt.documentId,
        documentTitle: excerpt.documentTitle,
        role: excerpt.role as 'supporting' | 'contradicting',
        text: excerpt.text,
        sourceUrl: excerpt.sourceUrl,
        evidenceDate: excerpt.evidenceDate,
      })),
    };
    if (result.excerpts.length === 0) {
      items.push({
        claimId: result.claimId,
        verificationRunId: run.id,
        verificationResultId: result.id,
        evidenceDocumentId: null,
        passageId: null,
        role: null,
        sourceUrl: null,
        evidenceDate: null,
        value,
      });
      continue;
    }
    items.push(
      ...result.excerpts.map((excerpt) => ({
        claimId: result.claimId,
        verificationRunId: run.id,
        verificationResultId: result.id,
        evidenceDocumentId: excerpt.documentId,
        passageId: excerpt.passageId,
        role: excerpt.role as 'supporting' | 'contradicting',
        sourceUrl: excerpt.sourceUrl,
        evidenceDate: excerpt.evidenceDate,
        value,
      })),
    );
  }
  return items;
}

export async function verifyProjectEvidence(
  projectId: string,
  userId: string,
  request: VerificationRequest,
  now = new Date(),
) {
  const project = await prisma.claimweaveProject.findFirst({
    where: { id: projectId, userId },
    include: { source: { include: { claims: { orderBy: { sourceStart: 'asc' } } } } },
  });
  if (!project?.source) throw new EvidenceVerificationError('Project not found.', 404);
  const minimumSupportingSources =
    project.minimumSupportingSources ?? DEFAULT_MINIMUM_SUPPORTING_SOURCES;
  const documents = await prisma.claimweaveEvidenceDocument.findMany({
    where: { projectId, userId },
    include: { passages: { orderBy: { createdAt: 'asc' } } },
    orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
  });
  const independentDocuments = documents.filter(
    (document) =>
      !sameUrl(document.sourceUrl, project.source?.url) &&
      !(
        project.source?.normalizedContent !== null &&
        project.source?.normalizedContent !== undefined &&
        document.normalizedContent.trim() === project.source.normalizedContent.trim()
      ),
  );
  const passages: VerificationPassage[] = independentDocuments.flatMap((document) =>
    document.passages
      .filter(
        (passage) =>
          !sameUrl(passage.sourceUrl ?? document.sourceUrl, project.source?.url) &&
          !(
            project.source?.normalizedContent !== null &&
            project.source?.normalizedContent !== undefined &&
            passage.text.trim() === project.source.normalizedContent.trim()
          ),
      )
      .map((passage) => ({
        id: passage.id,
        documentId: document.id,
        documentTitle: document.title,
        text: passage.text,
        sourceUrl: passage.sourceUrl ?? document.sourceUrl,
        evidenceDate: passage.evidenceDate ?? document.publicationDate,
      })),
  );
  const activeRun = await prisma.claimweaveVerificationRun.findFirst({
    where: { projectId, userId, status: 'running' },
    select: { id: true },
  });
  if (activeRun) throw new EvidenceVerificationError('Verification is already running.', 409);
  const claimInputs = project.source.claims.map((claim) => ({ id: claim.id, text: claim.text }));
  const expected = request.evaluation?.expectedByClaimId;
  if (
    expected &&
    Object.keys(expected).some((claimId) => !claimInputs.some((claim) => claim.id === claimId))
  ) {
    throw new EvidenceVerificationError('Evaluation referenced an unknown claim.', 400);
  }
  const run = await prisma.claimweaveVerificationRun.create({
    data: {
      projectId,
      userId,
      startedAt: now,
      mode: request.mode,
      policyVersion: EVIDENCE_POLICY_VERSION,
      status: 'running',
    },
  });
  try {
    const classified =
      request.mode === 'live-model'
        ? await classifyWithLiveModel(claimInputs, passages, now, minimumSupportingSources)
        : claimInputs.map((claim) =>
            classifyClaimAgainstPassages(
              claim.id,
              claim.text,
              passages,
              now,
              minimumSupportingSources,
            ),
          );
    const completedAt = now;
    const accuracyValues = expected
      ? Object.entries(expected).map(([claimId, classification]) =>
          classified.some(
            (result) => result.claimId === claimId && result.classification === classification,
          ),
        )
      : [];
    const accuracyTotal = expected ? accuracyValues.length : null;
    const accuracyCorrect = expected ? accuracyValues.filter(Boolean).length : null;
    const accuracyPercentage =
      accuracyTotal && accuracyCorrect !== null ? (accuracyCorrect / accuracyTotal) * 100 : null;
    const completed = await prisma.$transaction(async (transaction) =>
      (async () => {
        const previousCompleted = await transaction.claimweaveVerificationRun.findFirst({
          where: { projectId, userId, status: 'completed' },
          orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
          include: { results: { include: { excerpts: true }, orderBy: { verifiedAt: 'asc' } } },
        });
        const persisted = await transaction.claimweaveVerificationRun.update({
          where: { id: run.id },
          data: {
            status: 'completed',
            completedAt,
            accuracyTotal,
            accuracyCorrect,
            accuracyPercentage,
            results: {
              create: classified.map((result) => ({
                claimId: result.claimId,
                classification: result.classification,
                freshness: result.freshness,
                verifiedAt: completedAt,
                errorState: result.errorState,
                excerpts: {
                  create: [
                    ...result.supporting.map((passage) => ({
                      passageId: passage.id,
                      documentId: passage.documentId,
                      documentTitle: passage.documentTitle,
                      role: 'supporting',
                      text: passage.text,
                      sourceUrl: passage.sourceUrl,
                      evidenceDate: passage.evidenceDate,
                    })),
                    ...result.contradicting.map((passage) => ({
                      passageId: passage.id,
                      documentId: passage.documentId,
                      documentTitle: passage.documentTitle,
                      role: 'contradicting',
                      text: passage.text,
                      sourceUrl: passage.sourceUrl,
                      evidenceDate: passage.evidenceDate,
                    })),
                  ],
                },
              })),
            },
          },
          include: { results: { include: { excerpts: true }, orderBy: { verifiedAt: 'asc' } } },
        });
        const persistedResponse = responseRun(persisted);
        if (!persistedResponse)
          throw new EvidenceVerificationError('Verification result was incomplete.', 500);
        await createClaimweaveRevision(transaction, {
          projectId,
          ownerId: userId,
          eventKind: 'verification',
          createdAt: completedAt,
          previousEvidence: previousCompleted ? revisionEvidenceItems(previousCompleted) : [],
          currentEvidence: revisionEvidenceItems(persisted),
        });
        return persisted;
      })(),
    );
    return VerificationResponse.parse({
      verification: responseRun(completed),
      minimumSupportingSources,
    });
  } catch (error) {
    await prisma.claimweaveVerificationRun
      .update({
        where: { id: run.id },
        data: { status: 'failed', completedAt: new Date() },
      })
      .catch(() => undefined);
    if (error instanceof EvidenceVerificationError) throw error;
    throw new EvidenceVerificationError('Verification could not be persisted.', 500);
  }
}

export async function getLatestVerification(projectId: string, userId: string) {
  const project = await prisma.claimweaveProject.findFirst({
    where: { id: projectId, userId },
    select: { id: true, minimumSupportingSources: true },
  });
  if (!project) throw new EvidenceVerificationError('Project not found.', 404);
  const run = await prisma.claimweaveVerificationRun.findFirst({
    where: { projectId, userId, status: 'completed' },
    orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
    include: { results: { include: { excerpts: true }, orderBy: { verifiedAt: 'asc' } } },
  });
  return LatestVerificationResponse.parse({
    verification: run ? responseRun(run) : null,
    minimumSupportingSources:
      project.minimumSupportingSources ?? DEFAULT_MINIMUM_SUPPORTING_SOURCES,
  });
}

export async function updateMinimumSupportingSources(
  projectId: string,
  userId: string,
  minimumSupportingSources: number,
) {
  const project = await prisma.claimweaveProject.findFirst({
    where: { id: projectId, userId },
    select: { id: true },
  });
  if (!project) throw new EvidenceVerificationError('Project not found.', 404);
  const updated = await prisma.claimweaveProject.update({
    where: { id: project.id },
    data: { minimumSupportingSources },
    select: { minimumSupportingSources: true },
  });
  return { minimumSupportingSources: updated.minimumSupportingSources };
}
