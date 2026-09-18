// @polsia:user-owned — owner-protected processing-history read boundary.
import 'server-only';

import { NextResponse } from 'next/server';
import {
  addComparisonLinks,
  compareRuns,
  serializeSnapshot,
  snapshotKey,
} from '@/lib/business/project-history';
import { ProcessingRoute } from '@/lib/contracts/local-first';
import {
  ProjectHistory,
  ProjectHistoryClaimValue,
  ProjectHistoryDocumentKind,
  ProjectHistoryDocumentValue,
  ProjectHistoryEvidenceValue,
  ProjectHistoryRevision,
} from '@/lib/contracts/project-history';
import { prisma } from '@/lib/db';
import { requireAuth, type SessionUser } from '@/lib/require-auth';

export const dynamic = 'force-dynamic';

function nullableJson<T>(value: unknown, parse: { parse: (input: unknown) => T }) {
  return value === null ? null : parse.parse(value);
}

function serializeRevision(revision: {
  id: string;
  projectId: string;
  ownerId: string | null;
  version: number;
  eventKind: string;
  createdAt: Date;
  documentSnapshots: Array<{
    id: string;
    documentId: string;
    documentKind: string;
    createdAt: Date;
    previous: unknown;
    current: unknown;
  }>;
  claimSnapshots: Array<{
    id: string;
    sourceDocumentId: string;
    documentKind: string;
    identityKey: string;
    previousClaimId: string | null;
    currentClaimId: string | null;
    sourceStart: number;
    sourceEnd: number;
    createdAt: Date;
    previous: unknown;
    current: unknown;
  }>;
  evidenceSnapshots: Array<{
    id: string;
    claimId: string;
    verificationRunId: string;
    verificationResultId: string | null;
    evidenceDocumentId: string | null;
    passageId: string | null;
    identityKey: string;
    sourceUrl: string | null;
    evidenceDate: Date | null;
    classification: string | null;
    freshness: string | null;
    errorState: string | null;
    createdAt: Date;
    previous: unknown;
    current: unknown;
  }>;
}) {
  return ProjectHistoryRevision.parse({
    id: revision.id,
    projectId: revision.projectId,
    ownerId: revision.ownerId,
    version: revision.version,
    eventKind: revision.eventKind,
    createdAt: revision.createdAt.toISOString(),
    documents: revision.documentSnapshots.map((snapshot) => ({
      id: snapshot.id,
      documentId: snapshot.documentId,
      documentKind: snapshot.documentKind,
      createdAt: snapshot.createdAt.toISOString(),
      previous: nullableJson(snapshot.previous, ProjectHistoryDocumentValue),
      current: nullableJson(snapshot.current, ProjectHistoryDocumentValue),
    })),
    claims: revision.claimSnapshots.map((snapshot) => ({
      id: snapshot.id,
      sourceDocumentId: snapshot.sourceDocumentId,
      documentKind: snapshot.documentKind,
      identityKey: snapshot.identityKey,
      previousClaimId: snapshot.previousClaimId,
      currentClaimId: snapshot.currentClaimId,
      sourceStart: snapshot.sourceStart,
      sourceEnd: snapshot.sourceEnd,
      createdAt: snapshot.createdAt.toISOString(),
      previous: nullableJson(snapshot.previous, ProjectHistoryClaimValue),
      current: nullableJson(snapshot.current, ProjectHistoryClaimValue),
    })),
    evidence: revision.evidenceSnapshots.map((snapshot) => ({
      id: snapshot.id,
      claimId: snapshot.claimId,
      verificationRunId: snapshot.verificationRunId,
      verificationResultId: snapshot.verificationResultId,
      evidenceDocumentId: snapshot.evidenceDocumentId,
      passageId: snapshot.passageId,
      identityKey: snapshot.identityKey,
      sourceUrl: snapshot.sourceUrl,
      evidenceDate: snapshot.evidenceDate?.toISOString() ?? null,
      classification: snapshot.classification,
      freshness: snapshot.freshness,
      errorState: snapshot.errorState,
      createdAt: snapshot.createdAt.toISOString(),
      previous: nullableJson(snapshot.previous, ProjectHistoryEvidenceValue),
      current: nullableJson(snapshot.current, ProjectHistoryEvidenceValue),
    })),
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  let user: SessionUser;
  try {
    user = await requireAuth(request);
  } catch (response) {
    return response as Response;
  }

  const { projectId } = await params;
  try {
    const project = await prisma.claimweaveProject.findFirst({
      where: { id: projectId, userId: user.id },
      select: {
        id: true,
        source: {
          select: {
            claims: {
              select: { id: true, sourceStart: true, sourceEnd: true },
              orderBy: [{ sourceStart: 'asc' }, { sourceEnd: 'asc' }, { id: 'asc' }],
            },
          },
        },
        processingRuns: {
          orderBy: [{ version: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            version: true,
            evidenceState: true,
            processingRoute: true,
            documentId: true,
            documentKind: true,
            createdAt: true,
            snapshots: {
              orderBy: [{ sourceStart: 'asc' }, { sourceEnd: 'asc' }, { id: 'asc' }],
              select: {
                id: true,
                text: true,
                sourceStart: true,
                sourceEnd: true,
                sourceQuote: true,
                sourceUrl: true,
                citationLinks: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });

    if (!project) {
      return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
    }

    const revisions = await prisma.claimweaveRevision.findMany({
      where: { projectId: project.id, ownerId: user.id },
      orderBy: [{ version: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      include: {
        documentSnapshots: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        },
        claimSnapshots: {
          orderBy: [{ sourceStart: 'asc' }, { sourceEnd: 'asc' }, { id: 'asc' }],
        },
        evidenceSnapshots: {
          orderBy: [{ claimId: 'asc' }, { identityKey: 'asc' }, { id: 'asc' }],
        },
      },
    });

    const versions = project.processingRuns.map((run) => ({
      id: run.id,
      version: run.version,
      documentId: run.documentId,
      documentKind:
        run.documentKind === null ? null : ProjectHistoryDocumentKind.parse(run.documentKind),
      createdAt: run.createdAt.toISOString(),
      evidenceState: run.evidenceState,
      processingRoute: ProcessingRoute.parse(run.processingRoute),
      claimCount: run.snapshots.length,
      snapshots: run.snapshots.map((snapshot) => serializeSnapshot(snapshot)),
    }));
    const latest = versions.at(-1);
    const previous = versions.at(-2);
    const claimIdByKey = new Map(
      (project.source?.claims ?? []).map((claim) => [snapshotKey(claim), claim.id]),
    );
    const comparison =
      latest && previous
        ? addComparisonLinks(compareRuns(previous, latest), project.id, claimIdByKey)
        : null;

    return NextResponse.json(
      ProjectHistory.parse({
        projectId: project.id,
        versions,
        comparison,
        revisions: revisions.map(serializeRevision),
      }),
    );
  } catch {
    return NextResponse.json({ error: 'Could not load project history.' }, { status: 500 });
  }
}
