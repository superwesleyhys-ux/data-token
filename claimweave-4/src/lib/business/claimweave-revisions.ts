// @polsia:user-owned — transaction-local Claimweave revision persistence.
import type { Prisma } from '@prisma/client';
import {
  claimRevisionKey,
  documentRevisionKey,
  evidenceRevisionKey,
  semanticallyEqual,
} from '@/lib/business/project-history';

type DocumentKind = 'primary' | 'imported';

export type RevisionDocumentValue = {
  id: string;
  kind: DocumentKind;
  url: string | null;
  documentText: string | null;
  normalizedContent: string | null;
  status: string;
  processingRoute: string | null;
  processingTrace: unknown;
  extractedAt: Date;
};

export type RevisionClaimValue = {
  id: string;
  text: string;
  sourceStart: number;
  sourceEnd: number;
  sourceQuote: string;
  sourceUrl: string | null;
  citationLinks: string[];
  extractedAt: Date;
};

export type RevisionEvidenceExcerpt = {
  id: string;
  passageId: string;
  documentId: string;
  documentTitle: string;
  role: 'supporting' | 'contradicting';
  text: string;
  sourceUrl: string | null;
  evidenceDate: Date | null;
};

export type RevisionEvidenceValue = {
  claimId: string;
  classification: 'supported' | 'unsupported' | 'contradicted' | 'stale';
  freshness: 'fresh' | 'stale' | 'unknown';
  errorState: string | null;
  excerpts: RevisionEvidenceExcerpt[];
};

export type RevisionEvidenceItem = {
  claimId: string;
  verificationRunId: string;
  verificationResultId: string | null;
  evidenceDocumentId: string | null;
  passageId: string | null;
  role: 'supporting' | 'contradicting' | null;
  sourceUrl: string | null;
  evidenceDate: Date | null;
  value: RevisionEvidenceValue;
};

export type CreateRevisionInput = {
  projectId: string;
  ownerId?: string;
  eventKind: 'ingestion' | 'verification';
  createdAt?: Date;
  previousDocuments?: RevisionDocumentValue[];
  currentDocuments?: RevisionDocumentValue[];
  previousClaims?: Array<
    RevisionClaimValue & { sourceDocumentId: string; documentKind: DocumentKind }
  >;
  currentClaims?: Array<
    RevisionClaimValue & { sourceDocumentId: string; documentKind: DocumentKind }
  >;
  previousEvidence?: RevisionEvidenceItem[];
  currentEvidence?: RevisionEvidenceItem[];
};

type RevisionTransaction = Prisma.TransactionClient;

function inputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function documentComparable(value: RevisionDocumentValue) {
  const { extractedAt: _extractedAt, processingTrace: _processingTrace, ...comparable } = value;
  return comparable;
}

function claimComparable(value: RevisionClaimValue) {
  const { id: _id, extractedAt: _extractedAt, ...comparable } = value;
  return comparable;
}

function evidenceComparable(value: RevisionEvidenceValue) {
  return {
    ...value,
    excerpts: value.excerpts
      .map(({ id: _id, ...excerpt }) => excerpt)
      .sort((left, right) =>
        `${left.documentId}:${left.passageId}:${left.role}`.localeCompare(
          `${right.documentId}:${right.passageId}:${right.role}`,
        ),
      ),
  };
}

function normalizedDocuments(previous: RevisionDocumentValue[], current: RevisionDocumentValue[]) {
  const previousByKey = new Map(
    previous.map((value) => [documentRevisionKey(value.kind, value.id), value]),
  );
  const currentByKey = new Map(
    current.map((value) => [documentRevisionKey(value.kind, value.id), value]),
  );
  return [...new Set([...previousByKey.keys(), ...currentByKey.keys()])].sort().flatMap((key) => {
    const before = previousByKey.get(key);
    const after = currentByKey.get(key);
    return before &&
      after &&
      semanticallyEqual(documentComparable(before), documentComparable(after))
      ? []
      : before || after
        ? [{ key, before, after }]
        : [];
  });
}

function normalizedClaims(
  previous: CreateRevisionInput['previousClaims'],
  current: CreateRevisionInput['currentClaims'],
) {
  const previousByKey = new Map(
    (previous ?? []).map((value) => [
      claimRevisionKey(
        value.documentKind,
        value.sourceDocumentId,
        value.sourceStart,
        value.sourceEnd,
      ),
      value,
    ]),
  );
  const currentByKey = new Map(
    (current ?? []).map((value) => [
      claimRevisionKey(
        value.documentKind,
        value.sourceDocumentId,
        value.sourceStart,
        value.sourceEnd,
      ),
      value,
    ]),
  );
  return [...new Set([...previousByKey.keys(), ...currentByKey.keys()])].sort().flatMap((key) => {
    const before = previousByKey.get(key);
    const after = currentByKey.get(key);
    return before && after && semanticallyEqual(claimComparable(before), claimComparable(after))
      ? []
      : before || after
        ? [{ key, before, after }]
        : [];
  });
}

function normalizedEvidence(previous: RevisionEvidenceItem[], current: RevisionEvidenceItem[]) {
  const previousByKey = new Map(
    previous.map((value) => [
      evidenceRevisionKey(value.claimId, value.evidenceDocumentId, value.passageId, value.role),
      value,
    ]),
  );
  const currentByKey = new Map(
    current.map((value) => [
      evidenceRevisionKey(value.claimId, value.evidenceDocumentId, value.passageId, value.role),
      value,
    ]),
  );
  return [...new Set([...previousByKey.keys(), ...currentByKey.keys()])].sort().flatMap((key) => {
    const before = previousByKey.get(key);
    const after = currentByKey.get(key);
    return before &&
      after &&
      semanticallyEqual(evidenceComparable(before.value), evidenceComparable(after.value))
      ? []
      : before || after
        ? [{ key, before, after }]
        : [];
  });
}

export async function createClaimweaveRevision(
  tx: RevisionTransaction,
  input: CreateRevisionInput,
) {
  const documents = normalizedDocuments(
    input.previousDocuments ?? [],
    input.currentDocuments ?? [],
  );
  const claims = normalizedClaims(input.previousClaims, input.currentClaims);
  const evidence = normalizedEvidence(input.previousEvidence ?? [], input.currentEvidence ?? []);
  if (documents.length === 0 && claims.length === 0 && evidence.length === 0) return null;

  const latest = await tx.claimweaveRevision.findFirst({
    where: { projectId: input.projectId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const version = (latest?.version ?? 0) + 1;
  const createdAt = input.createdAt ?? new Date();
  return tx.claimweaveRevision.create({
    data: {
      projectId: input.projectId,
      ownerId: input.ownerId ?? null,
      version,
      eventKind: input.eventKind,
      createdAt,
      documentSnapshots: {
        create: documents.map(({ before, after }) => {
          const value = after ?? before;
          if (!value) throw new Error('Revision document value is missing.');
          return {
            documentId: value.id,
            documentKind: value.kind,
            url: value.url,
            status: value.status,
            processingRoute: value.processingRoute,
            extractedAt: value.extractedAt,
            previous: before ? inputJson(before) : undefined,
            current: after ? inputJson(after) : undefined,
            createdAt,
          };
        }),
      },
      claimSnapshots: {
        create: claims.map(({ key, before, after }) => {
          const value = after ?? before;
          if (!value) throw new Error('Revision claim value is missing.');
          return {
            sourceDocumentId: value.sourceDocumentId,
            documentKind: value.documentKind,
            identityKey: key,
            previousClaimId: before?.id ?? null,
            currentClaimId: after?.id ?? null,
            sourceStart: value.sourceStart,
            sourceEnd: value.sourceEnd,
            previous: before ? inputJson(before) : undefined,
            current: after ? inputJson(after) : undefined,
            createdAt,
          };
        }),
      },
      evidenceSnapshots: {
        create: evidence.map(({ key, before, after }) => {
          const value = after ?? before;
          if (!value) throw new Error('Revision evidence value is missing.');
          return {
            claimId: value.claimId,
            verificationRunId: value.verificationRunId,
            verificationResultId: value.verificationResultId,
            evidenceDocumentId: value.evidenceDocumentId,
            passageId: value.passageId,
            identityKey: key,
            sourceUrl: value.sourceUrl,
            evidenceDate: value.evidenceDate,
            classification: value.value.classification,
            freshness: value.value.freshness,
            errorState: value.value.errorState,
            previous: before ? inputJson(before.value) : undefined,
            current: after ? inputJson(after.value) : undefined,
            createdAt,
          };
        }),
      },
    },
    include: {
      documentSnapshots: true,
      claimSnapshots: true,
      evidenceSnapshots: true,
    },
  });
}
