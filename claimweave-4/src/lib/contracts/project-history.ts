// @polsia:user-owned — shared contract for protected Claimweave processing history.
import { z } from 'zod';
import { ProcessingRoute } from '@/lib/contracts/local-first';

const IsoDate = z.string().datetime({ offset: true });

export const ProjectHistoryRevisionKind = z.enum(['ingestion', 'verification']);
export const ProjectHistoryDocumentKind = z.enum(['primary', 'imported']);

export const ProjectHistoryDocumentValue = z.object({
  id: z.string().min(1),
  kind: ProjectHistoryDocumentKind,
  url: z.string().url().nullable(),
  documentText: z.string().nullable(),
  normalizedContent: z.string().nullable(),
  status: z.string().min(1),
  processingRoute: z.string().min(1).nullable(),
  processingTrace: z.unknown().nullable(),
  extractedAt: IsoDate,
});

export const ProjectHistoryClaimValue = z
  .object({
    id: z.string().min(1),
    text: z.string().min(1),
    sourceStart: z.number().int().nonnegative(),
    sourceEnd: z.number().int().nonnegative(),
    sourceQuote: z.string().min(1),
    sourceUrl: z.string().url().nullable(),
    citationLinks: z.array(z.string().url()),
    extractedAt: IsoDate,
  })
  .refine((value) => value.sourceEnd > value.sourceStart, {
    message: 'A claim source range must have a positive length.',
    path: ['sourceEnd'],
  });

export const ProjectHistoryEvidenceExcerpt = z.object({
  id: z.string().min(1),
  passageId: z.string().min(1),
  documentId: z.string().min(1),
  documentTitle: z.string().min(1),
  role: z.enum(['supporting', 'contradicting']),
  text: z.string().min(1),
  sourceUrl: z.string().url().nullable(),
  evidenceDate: IsoDate.nullable(),
});

export const ProjectHistoryEvidenceValue = z.object({
  claimId: z.string().min(1),
  classification: z.enum(['supported', 'unsupported', 'contradicted', 'stale']),
  freshness: z.enum(['fresh', 'stale', 'unknown']),
  errorState: z.string().min(1).nullable(),
  excerpts: z.array(ProjectHistoryEvidenceExcerpt),
});

export const ProjectHistoryDocumentRevision = z.object({
  id: z.string().min(1),
  documentId: z.string().min(1),
  documentKind: ProjectHistoryDocumentKind,
  createdAt: IsoDate,
  previous: ProjectHistoryDocumentValue.nullable(),
  current: ProjectHistoryDocumentValue.nullable(),
});

export const ProjectHistoryClaimRevision = z
  .object({
    id: z.string().min(1),
    sourceDocumentId: z.string().min(1),
    documentKind: ProjectHistoryDocumentKind,
    identityKey: z.string().min(1),
    previousClaimId: z.string().min(1).nullable(),
    currentClaimId: z.string().min(1).nullable(),
    sourceStart: z.number().int().nonnegative(),
    sourceEnd: z.number().int().nonnegative(),
    createdAt: IsoDate,
    previous: ProjectHistoryClaimValue.nullable(),
    current: ProjectHistoryClaimValue.nullable(),
  })
  .refine((value) => value.sourceEnd > value.sourceStart, {
    message: 'A claim revision source range must have a positive length.',
    path: ['sourceEnd'],
  });

export const ProjectHistoryEvidenceRevision = z.object({
  id: z.string().min(1),
  claimId: z.string().min(1),
  verificationRunId: z.string().min(1),
  verificationResultId: z.string().min(1).nullable(),
  evidenceDocumentId: z.string().min(1).nullable(),
  passageId: z.string().min(1).nullable(),
  identityKey: z.string().min(1),
  sourceUrl: z.string().url().nullable(),
  evidenceDate: IsoDate.nullable(),
  classification: z.string().min(1).nullable(),
  freshness: z.string().min(1).nullable(),
  errorState: z.string().min(1).nullable(),
  createdAt: IsoDate,
  previous: ProjectHistoryEvidenceValue.nullable(),
  current: ProjectHistoryEvidenceValue.nullable(),
});

export const ProjectHistoryRevision = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  ownerId: z.string().min(1).nullable(),
  version: z.number().int().positive(),
  eventKind: ProjectHistoryRevisionKind,
  createdAt: IsoDate,
  documents: z.array(ProjectHistoryDocumentRevision),
  claims: z.array(ProjectHistoryClaimRevision),
  evidence: z.array(ProjectHistoryEvidenceRevision),
});

export const ProjectHistorySnapshot = z
  .object({
    id: z.string().min(1),
    text: z.string().min(1),
    sourceStart: z.number().int().nonnegative(),
    sourceEnd: z.number().int().nonnegative(),
    sourceQuote: z.string().min(1),
    sourceUrl: z.string().url().nullable(),
    citationLinks: z.array(z.string().url()),
    createdAt: IsoDate,
  })
  .refine((value) => value.sourceEnd > value.sourceStart, {
    message: 'A snapshot source range must have a positive length.',
    path: ['sourceEnd'],
  });

export const ProjectHistoryVersion = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  documentId: z.string().min(1).nullable(),
  documentKind: ProjectHistoryDocumentKind.nullable(),
  createdAt: IsoDate,
  evidenceState: z.string().trim().min(1),
  processingRoute: ProcessingRoute,
  claimCount: z.number().int().nonnegative(),
  snapshots: z.array(ProjectHistorySnapshot),
});

export const ProjectHistoryChange = z.object({
  key: z.string().min(1),
  sourceStart: z.number().int().nonnegative(),
  sourceEnd: z.number().int().nonnegative(),
  previous: ProjectHistorySnapshot.nullable(),
  current: ProjectHistorySnapshot.nullable(),
});

export const ProjectHistoryDiffItem = ProjectHistoryChange.extend({
  currentClaimId: z.string().min(1).nullable(),
  claimsHref: z.string().startsWith('/projects/'),
  currentClaimHref: z.string().startsWith('/projects/').nullable(),
});

export const EvidenceStateTransition = z.object({
  previous: z.string().trim().min(1),
  current: z.string().trim().min(1),
  changed: z.boolean(),
});

export const ProjectHistoryComparison = z.object({
  previousVersion: z.number().int().positive(),
  currentVersion: z.number().int().positive(),
  added: z.array(ProjectHistoryDiffItem),
  removed: z.array(ProjectHistoryDiffItem),
  changed: z.array(ProjectHistoryDiffItem),
  evidenceState: EvidenceStateTransition,
});

export const ProjectHistory = z.object({
  projectId: z.string().min(1),
  versions: z.array(ProjectHistoryVersion),
  comparison: ProjectHistoryComparison.nullable(),
  revisions: z.array(ProjectHistoryRevision),
});

export type ProjectHistorySnapshot = z.infer<typeof ProjectHistorySnapshot>;
export type ProjectHistoryVersion = z.infer<typeof ProjectHistoryVersion>;
export type ProjectHistoryChange = z.infer<typeof ProjectHistoryChange>;
export type ProjectHistoryDiffItem = z.infer<typeof ProjectHistoryDiffItem>;
export type EvidenceStateTransition = z.infer<typeof EvidenceStateTransition>;
export type ProjectHistoryComparison = z.infer<typeof ProjectHistoryComparison>;
export type ProjectHistoryRevisionKind = z.infer<typeof ProjectHistoryRevisionKind>;
export type ProjectHistoryDocumentKind = z.infer<typeof ProjectHistoryDocumentKind>;
export type ProjectHistoryDocumentValue = z.infer<typeof ProjectHistoryDocumentValue>;
export type ProjectHistoryClaimValue = z.infer<typeof ProjectHistoryClaimValue>;
export type ProjectHistoryEvidenceValue = z.infer<typeof ProjectHistoryEvidenceValue>;
export type ProjectHistoryDocumentRevision = z.infer<typeof ProjectHistoryDocumentRevision>;
export type ProjectHistoryClaimRevision = z.infer<typeof ProjectHistoryClaimRevision>;
export type ProjectHistoryEvidenceRevision = z.infer<typeof ProjectHistoryEvidenceRevision>;
export type ProjectHistoryRevision = z.infer<typeof ProjectHistoryRevision>;
export type ProjectHistory = z.infer<typeof ProjectHistory>;
