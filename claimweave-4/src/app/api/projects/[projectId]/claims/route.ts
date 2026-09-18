// @polsia:user-owned — owner-protected persisted claims export boundary.
import 'server-only';

import { NextResponse } from 'next/server';
import { findActiveApiKey, parseApiKeyAuthorization } from '@/lib/api-key-auth';
import { getLatestVerification } from '@/lib/business/evidence-verification';
import { recordClaimsViewReached } from '@/lib/business/journey';
import { buildSourceCitationTarget } from '@/lib/business/source-citations';
import {
  ClaimBulkReviewResult,
  ClaimReviewInput,
  ClaimReviewRequest,
  ClaimReviewResult,
  ClaimsExport,
  parseClaimsPagination,
  parseClaimsQuery,
} from '@/lib/contracts/claims';
import { JourneyVisitorId } from '@/lib/contracts/journey';
import { ProcessingRoute, RouteTrace, traceForProcessingRoute } from '@/lib/contracts/local-first';
import { prisma } from '@/lib/db';
import { requireAuth, type SessionUser } from '@/lib/require-auth';

export const dynamic = 'force-dynamic';

type VerificationFilterResult = {
  classification: string;
  excerpts: ReadonlyArray<{ role: string }>;
};

function intersectClaimIds(left: Set<string>, right: Set<string>) {
  return new Set([...left].filter((claimId) => right.has(claimId)));
}

function sourceClaimsForFilter(
  sourceClaimIds: Set<string>,
  resultsByClaimId: Map<string, VerificationFilterResult>,
  status: string,
) {
  return [...sourceClaimIds].filter((claimId) => {
    const result = resultsByClaimId.get(claimId);
    if (status === 'not-checked') return !result;
    return result?.classification === status;
  });
}

function contradictionClaimsForFilter(
  sourceClaimIds: Set<string>,
  resultsByClaimId: Map<string, VerificationFilterResult>,
  status: string,
) {
  return [...sourceClaimIds].filter((claimId) => {
    const result = resultsByClaimId.get(claimId);
    if (status === 'not-checked') return !result;
    if (!result) return false;
    const found =
      result.classification === 'contradicted' ||
      result.excerpts.some((excerpt) => excerpt.role === 'contradicting');
    return status === 'found' ? found : !found;
  });
}

function processingMetadata(source: {
  processingRoute: string | null | undefined;
  processingTrace: unknown;
}) {
  const route = ProcessingRoute.safeParse(source.processingRoute ?? 'legacy-unknown');
  if (!route.success || route.data === 'legacy-unknown') {
    return { processingRoute: null, processingTrace: null };
  }

  const persistedTrace = RouteTrace.safeParse(source.processingTrace);
  return {
    processingRoute: route.data,
    processingTrace: persistedTrace.success
      ? persistedTrace.data
      : traceForProcessingRoute(route.data),
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const authorization = request.headers.get('authorization');
  let ownerId: string;
  let apiKeyPrincipal = false;

  if (authorization !== null) {
    const presentedSecret = parseApiKeyAuthorization(authorization);
    if (!presentedSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const apiKey = await findActiveApiKey(presentedSecret);
    if (!apiKey) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    ownerId = apiKey.userId;
    apiKeyPrincipal = true;
  } else {
    let user: SessionUser;
    try {
      user = await requireAuth(request);
    } catch (response) {
      return response as Response;
    }
    ownerId = user.id;
  }

  try {
    const existingProject = await prisma.claimweaveProject.findFirst({
      where: { id: projectId },
      select: { userId: true },
    });
    if (!existingProject)
      return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
    if (existingProject.userId !== ownerId) {
      return apiKeyPrincipal
        ? NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        : NextResponse.json({ error: 'Project not found.' }, { status: 404 });
    }

    const project = await prisma.claimweaveProject.findFirst({
      where: { id: projectId, userId: ownerId },
      include: {
        source: {
          select: {
            id: true,
            url: true,
            documentText: true,
            normalizedContent: true,
            extractedAt: true,
            processingRoute: true,
            processingTrace: true,
          },
        },
      },
    });
    if (!project?.source)
      return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
    const sourceText = project.source.normalizedContent ?? project.source.documentText;

    const searchParams = new URL(request.url).searchParams;
    const pagination = parseClaimsPagination(searchParams);
    if (!pagination) {
      return NextResponse.json({ error: 'Invalid pagination parameters.' }, { status: 400 });
    }
    const query = parseClaimsQuery(searchParams);
    if (!query) {
      return NextResponse.json({ error: 'Invalid claims query parameters.' }, { status: 400 });
    }

    const latestVerification = await getLatestVerification(projectId, ownerId);
    const verificationResults = latestVerification.verification?.results ?? [];
    const resultsByClaimId = new Map(verificationResults.map((result) => [result.claimId, result]));

    const claimSelect = {
      id: true,
      text: true,
      sourceStart: true,
      sourceEnd: true,
      sourceQuote: true,
      citationLinks: true,
      sourceUrl: true,
      extractedAt: true,
      approvalStatus: true,
      reviewedAt: true,
      reviewerId: true,
    } as const;
    let matchingClaimIds: Set<string> | null = null;
    if (query.verificationStatus !== 'all' || query.contradictionStatus !== 'all') {
      const sourceClaims = await prisma.claimweaveClaim.findMany({
        where: { sourceId: project.source.id },
        select: { id: true },
      });
      matchingClaimIds = new Set(sourceClaims.map((claim) => claim.id));
    }

    if (matchingClaimIds) {
      if (query.verificationStatus !== 'all') {
        const verificationMatches = new Set(
          sourceClaimsForFilter(matchingClaimIds, resultsByClaimId, query.verificationStatus),
        );
        matchingClaimIds = intersectClaimIds(matchingClaimIds, verificationMatches);
      }
      if (query.contradictionStatus !== 'all') {
        const contradictionMatches = new Set(
          contradictionClaimsForFilter(
            matchingClaimIds,
            resultsByClaimId,
            query.contradictionStatus,
          ),
        );
        matchingClaimIds = intersectClaimIds(matchingClaimIds, contradictionMatches);
      }
    }

    const claimWhere = {
      sourceId: project.source.id,
      ...(query.approvalStatus !== 'all' ? { approvalStatus: query.approvalStatus } : {}),
      ...(matchingClaimIds ? { id: { in: [...matchingClaimIds] } } : {}),
    };
    const [total, claims] = await Promise.all([
      prisma.claimweaveClaim.count({ where: claimWhere }),
      prisma.claimweaveClaim.findMany({
        where: claimWhere,
        orderBy: [{ sourceStart: 'asc' }, { id: 'asc' }],
        skip: pagination.skip,
        take: pagination.pageSize,
        select: claimSelect,
      }),
    ]);
    const metadata = processingMetadata(project.source);
    const response = ClaimsExport.parse({
      projectId: project.id,
      documentId: project.source.id,
      sourceType: project.source.url ? 'url' : 'text',
      sourceUrl: project.source.url,
      extractedAt: project.source.extractedAt.toISOString(),
      normalizedContentLength: project.source.normalizedContent?.length ?? null,
      ...metadata,
      pagination: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        total,
        totalPages: Math.ceil(total / pagination.pageSize),
        hasNextPage: pagination.page < Math.ceil(total / pagination.pageSize),
        hasPreviousPage: pagination.page > 1 && total > 0,
      },
      claims: claims.map((claim) => {
        const verification = resultsByClaimId.get(claim.id);
        return {
          id: claim.id,
          projectId: project.id,
          text: claim.text,
          sourceSpan: { start: claim.sourceStart, end: claim.sourceEnd, quote: claim.sourceQuote },
          sourcePassage: claim.sourceQuote,
          citationLinks: claim.citationLinks,
          citationTargets: (claim.citationLinks as string[]).map((url) =>
            buildSourceCitationTarget({
              url,
              sourceText,
              sourceQuote: claim.sourceQuote,
              sourceStart: claim.sourceStart,
              sourceEnd: claim.sourceEnd,
            }),
          ),
          sourceUrl: claim.sourceUrl,
          extractedAt: claim.extractedAt.toISOString(),
          evidenceExcerpts: verification?.excerpts ?? [],
          verificationStatus: verification?.classification ?? null,
          approvalStatus: claim.approvalStatus,
          reviewedAt: claim.reviewedAt?.toISOString() ?? null,
          reviewerId: claim.reviewerId,
        };
      }),
    });
    const visitorId = JourneyVisitorId.safeParse(
      request.headers.get('x-claimweave-visitor-id') ?? undefined,
    );
    if (visitorId.success) {
      try {
        await recordClaimsViewReached(visitorId.data, project.id);
      } catch {
        // Anonymous telemetry must never turn a valid claims read into an error.
      }
    }
    return NextResponse.json(response);
  } catch {
    return NextResponse.json({ error: 'Could not load this project.' }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  if (request.headers.get('authorization') !== null) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let user: SessionUser;
  try {
    user = await requireAuth(request);
  } catch (response) {
    return response as Response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Review input must be valid JSON.' }, { status: 400 });
  }
  const parsed = ClaimReviewRequest.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Claim review input is invalid.' }, { status: 400 });
  }

  const { projectId } = await params;
  try {
    if ('claimIds' in parsed.data) {
      const { claimIds, status } = parsed.data;
      const claims = await prisma.claimweaveClaim.findMany({
        where: {
          id: { in: claimIds },
          source: { project: { id: projectId, userId: user.id } },
        },
        select: { id: true },
      });
      if (claims.length !== claimIds.length) {
        return NextResponse.json({ error: 'Claim not found.' }, { status: 404 });
      }

      const reviewedAt = new Date();
      await prisma.$transaction(async (transaction) => {
        const updated = await transaction.claimweaveClaim.updateMany({
          where: {
            id: { in: claimIds },
            source: { project: { id: projectId, userId: user.id } },
          },
          data: {
            approvalStatus: status,
            reviewedAt,
            reviewerId: user.id,
          },
        });
        if (updated.count !== claimIds.length) {
          throw new Error('Bulk claim review scope changed during update.');
        }
      });

      return NextResponse.json(
        ClaimBulkReviewResult.parse({
          claimIds,
          approvalStatus: status,
          reviewedAt: reviewedAt.toISOString(),
          reviewerId: user.id,
        }),
      );
    }

    const singleReview = ClaimReviewInput.parse(parsed.data);
    const claim = await prisma.claimweaveClaim.findFirst({
      where: {
        id: singleReview.claimId,
        source: { project: { id: projectId, userId: user.id } },
      },
      select: { id: true },
    });
    if (!claim) return NextResponse.json({ error: 'Claim not found.' }, { status: 404 });

    const reviewedAt = new Date();
    const updated = await prisma.claimweaveClaim.update({
      where: { id: claim.id },
      data: {
        approvalStatus: singleReview.status,
        reviewedAt,
        reviewerId: user.id,
      },
      select: { id: true, approvalStatus: true, reviewedAt: true, reviewerId: true },
    });
    return NextResponse.json(
      ClaimReviewResult.parse({
        claimId: updated.id,
        approvalStatus: updated.approvalStatus,
        reviewedAt: updated.reviewedAt?.toISOString(),
        reviewerId: updated.reviewerId,
      }),
    );
  } catch {
    return NextResponse.json({ error: 'Could not save the claim review.' }, { status: 500 });
  }
}
