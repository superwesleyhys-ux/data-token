import { describe, expect, it } from 'vitest';
import {
  ClaimApprovalStatus,
  ClaimBulkReviewInput,
  ClaimBulkReviewResult,
  ClaimItem,
  ClaimReviewInput,
  ClaimReviewResult,
  ClaimsExport,
  ClaimsList,
  parseClaimsQuery,
  parseClaimsPagination,
} from '@/lib/contracts/claims';
import { traceForProcessingRoute } from '@/lib/contracts/local-first';

const claim = {
  id: 'claim-1',
  projectId: 'project-1',
  text: 'The source makes one testable statement.',
  sourceSpan: { start: 0, end: 34, quote: 'The source makes one testable statement.' },
  citationLinks: ['https://example.com/article'],
  sourceUrl: 'https://example.com/article',
  extractedAt: '2026-09-17T00:00:00.000Z',
};

const urlDocument = {
  projectId: 'project-1',
  documentId: 'document-1',
  sourceType: 'url' as const,
  sourceUrl: claim.sourceUrl,
  extractedAt: claim.extractedAt,
  normalizedContentLength: 128,
  processingRoute: 'model-fallback' as const,
  processingTrace: null,
  pagination: {
    page: 1,
    pageSize: 50,
    total: 1,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  },
  claims: [claim],
};

const exportClaim = {
  ...claim,
  sourcePassage: claim.sourceSpan.quote,
  citationTargets: [
    {
      url: claim.citationLinks[0],
      href: `${claim.citationLinks[0]}#:~:text=The%20source%20makes%20one%20testable%20statement.`,
      status: 'available' as const,
      reason: 'located' as const,
    },
  ],
  evidenceExcerpts: [],
  verificationStatus: null,
  approvalStatus: 'pending',
  reviewedAt: null,
  reviewerId: null,
};

const measuredTrace = {
  ...traceForProcessingRoute('trusted-server-reuse'),
  latencyMs: 12,
  transferredBytes: 512,
};

describe('claim contracts', () => {
  it('parses bounded pagination defaults and boundaries', () => {
    expect(parseClaimsPagination(new URLSearchParams())).toEqual({
      page: 1,
      pageSize: 50,
      skip: 0,
    });
    expect(parseClaimsPagination(new URLSearchParams('page=2&pageSize=100'))).toEqual({
      page: 2,
      pageSize: 100,
      skip: 100,
    });
    expect(parseClaimsPagination(new URLSearchParams('pageSize=1'))).toEqual({
      page: 1,
      pageSize: 1,
      skip: 0,
    });
  });

  it.each([
    'page=',
    'page=0',
    'page=-1',
    'page=1.5',
    'pageSize=',
    'pageSize=0',
    'pageSize=-1',
    'pageSize=1.5',
    'pageSize=101',
    'page=1&page=2',
  ])('rejects malformed pagination query %s', (query) => {
    expect(parseClaimsPagination(new URLSearchParams(query))).toBeNull();
  });

  it('parses all claim filters as all by default and accepts every domain value', () => {
    expect(parseClaimsQuery(new URLSearchParams())).toMatchObject({
      page: 1,
      pageSize: 50,
      skip: 0,
      approvalStatus: 'all',
      verificationStatus: 'all',
      contradictionStatus: 'all',
    });
    expect(
      parseClaimsQuery(
        new URLSearchParams(
          'page=2&pageSize=10&approvalStatus=approved&verificationStatus=stale&contradictionStatus=found',
        ),
      ),
    ).toMatchObject({
      page: 2,
      pageSize: 10,
      skip: 10,
      approvalStatus: 'approved',
      verificationStatus: 'stale',
      contradictionStatus: 'found',
    });
    expect(
      parseClaimsQuery(
        new URLSearchParams(
          'approvalStatus=all&verificationStatus=not-checked&contradictionStatus=none',
        ),
      ),
    ).toMatchObject({
      approvalStatus: 'all',
      verificationStatus: 'not-checked',
      contradictionStatus: 'none',
    });
  });

  it.each([
    'approvalStatus=approved&approvalStatus=rejected',
    'verificationStatus=',
    'verificationStatus=unknown',
    'contradictionStatus=found&contradictionStatus=none',
    'contradictionStatus=unknown',
  ])('rejects malformed claim filter query %s', (query) => {
    expect(parseClaimsQuery(new URLSearchParams(query))).toBeNull();
  });

  it('requires a non-empty source span and citation link', () => {
    expect(ClaimItem.safeParse(claim).success).toBe(true);
    expect(
      ClaimItem.safeParse({ ...claim, sourceSpan: { start: 2, end: 2, quote: '' } }).success,
    ).toBe(false);
    expect(ClaimItem.safeParse({ ...claim, citationLinks: [] }).success).toBe(true);
  });

  it('wraps persisted claims with project source metadata', () => {
    expect(
      ClaimsList.safeParse({
        ...urlDocument,
      }).success,
    ).toBe(true);
  });

  it('accepts text results with nullable sources and no citations', () => {
    expect(
      ClaimsList.safeParse({
        projectId: 'project-2',
        documentId: 'document-2',
        sourceType: 'text',
        sourceUrl: null,
        extractedAt: claim.extractedAt,
        normalizedContentLength: 96,
        processingRoute: 'legacy-unknown',
        processingTrace: null,
        claims: [{ ...claim, sourceUrl: null, citationLinks: [] }],
      }).success,
    ).toBe(true);
  });

  it('keeps URL results tied to a URL citation', () => {
    expect(
      ClaimsList.safeParse({
        ...urlDocument,
        claims: [{ ...claim, citationLinks: [] }],
      }).success,
    ).toBe(false);
  });

  it('requires valid document metadata and preserves legacy content nullability', () => {
    expect(ClaimsList.safeParse({ ...urlDocument, documentId: undefined }).success).toBe(false);
    expect(ClaimsList.safeParse({ ...urlDocument, documentId: '' }).success).toBe(false);
    expect(ClaimsList.safeParse({ ...urlDocument, normalizedContentLength: -1 }).success).toBe(
      false,
    );
    expect(ClaimsList.safeParse({ ...urlDocument, normalizedContentLength: null }).success).toBe(
      true,
    );
    expect(ClaimsList.safeParse({ ...urlDocument, extractedAt: 'not-a-timestamp' }).success).toBe(
      false,
    );
    expect(ClaimsList.safeParse({ ...urlDocument, sourceUrl: 'not-a-url' }).success).toBe(false);
    expect(
      ClaimsList.safeParse({ ...urlDocument, sourceType: 'text', sourceUrl: null }).success,
    ).toBe(false);
  });

  it('validates the provenance-rich export for URL claims', () => {
    expect(
      ClaimsExport.safeParse({
        ...urlDocument,
        claims: [exportClaim],
      }).success,
    ).toBe(true);
    expect(
      ClaimsExport.safeParse({
        ...urlDocument,
        pagination: undefined,
        claims: [exportClaim],
      }).success,
    ).toBe(false);
    expect(
      ClaimsExport.safeParse({
        ...urlDocument,
        pagination: { ...urlDocument.pagination, total: -1 },
        claims: [exportClaim],
      }).success,
    ).toBe(false);
    expect(
      ClaimsExport.safeParse({
        ...urlDocument,
        claims: [{ ...exportClaim, sourcePassage: undefined }],
      }).success,
    ).toBe(false);
    expect(
      ClaimsExport.safeParse({
        ...urlDocument,
        claims: [{ ...exportClaim, citationLinks: ['not-a-url'] }],
      }).success,
    ).toBe(false);
  });

  it('documents known route metadata and nullable measurements', () => {
    expect(
      ClaimsExport.safeParse({
        ...urlDocument,
        processingRoute: 'trusted-server-reuse',
        processingTrace: measuredTrace,
        claims: [exportClaim],
      }).success,
    ).toBe(true);
    expect(measuredTrace.providerUsage.inputTokens).toBeNull();
    expect(measuredTrace.providerUsage.costUsd).toBeNull();
    expect(
      ClaimsExport.safeParse({
        ...urlDocument,
        processingRoute: null,
        processingTrace: null,
        claims: [exportClaim],
      }).success,
    ).toBe(true);
  });

  it('rejects malformed route metadata at the contract boundary', () => {
    expect(
      ClaimsExport.safeParse({
        ...urlDocument,
        processingRoute: 'deterministic-local',
        claims: [exportClaim],
      }).success,
    ).toBe(false);
    expect(
      ClaimsExport.safeParse({
        ...urlDocument,
        processingRoute: 'model-fallback',
        processingTrace: { ...measuredTrace, latencyMs: -1 },
        claims: [exportClaim],
      }).success,
    ).toBe(false);
  });

  it('accepts nullable URLs and verification status for text exports', () => {
    expect(
      ClaimsExport.safeParse({
        projectId: 'project-2',
        documentId: 'document-2',
        sourceType: 'text',
        sourceUrl: null,
        extractedAt: claim.extractedAt,
        normalizedContentLength: 96,
        processingRoute: 'legacy-unknown',
        processingTrace: null,
        pagination: urlDocument.pagination,
        claims: [
          {
            ...exportClaim,
            sourceUrl: null,
            citationLinks: [],
            citationTargets: [],
            verificationStatus: null,
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      ClaimsExport.safeParse({
        ...urlDocument,
        claims: [{ ...exportClaim, extractedAt: 'not-a-timestamp' }],
      }).success,
    ).toBe(false);
  });

  it('accepts every approval state and preserves legacy pending metadata', () => {
    for (const approvalStatus of ['pending', 'approved', 'rejected'] as const) {
      expect(
        ClaimsExport.safeParse({
          ...urlDocument,
          claims: [{ ...exportClaim, approvalStatus }],
        }).success,
      ).toBe(true);
    }
    expect(
      ClaimsExport.safeParse({
        ...urlDocument,
        claims: [{ ...exportClaim, approvalStatus: 'pending', reviewedAt: null, reviewerId: null }],
      }).success,
    ).toBe(true);
    for (const approvalStatus of ['approved', 'rejected'] as const) {
      expect(
        ClaimsExport.safeParse({
          ...urlDocument,
          claims: [
            {
              ...exportClaim,
              approvalStatus,
              reviewedAt: '2026-09-18T14:30:00+02:00',
              reviewerId: 'reviewer-1',
            },
          ],
        }).success,
      ).toBe(true);
    }
    expect(
      ClaimsExport.safeParse({
        ...urlDocument,
        claims: [{ ...exportClaim, approvalStatus: 'queued' }],
      }).success,
    ).toBe(false);
    expect(
      ClaimsExport.safeParse({
        ...urlDocument,
        claims: [{ ...exportClaim, reviewedAt: 'not-a-timestamp' }],
      }).success,
    ).toBe(false);
  });

  it('preserves original citation URLs for available and fallback targets', () => {
    const fallbackTarget = {
      url: claim.citationLinks[0],
      href: claim.citationLinks[0],
      status: 'fallback' as const,
      reason: 'quote-not-found' as const,
    };
    expect(
      ClaimsExport.safeParse({
        ...urlDocument,
        claims: [{ ...exportClaim, citationTargets: [fallbackTarget] }],
      }).success,
    ).toBe(true);
    expect(
      ClaimsExport.safeParse({
        ...urlDocument,
        claims: [{ ...exportClaim, citationTargets: [{ ...fallbackTarget, url: 'https://example.com/other' }] }],
      }).success,
    ).toBe(false);
    expect(
      ClaimsExport.safeParse({
        ...urlDocument,
        claims: [{ ...exportClaim, citationTargets: [{ ...fallbackTarget, status: 'unknown' }] }],
      }).success,
    ).toBe(false);
  });

  it('validates owner review input and review metadata', () => {
    expect(ClaimApprovalStatus.safeParse('pending').success).toBe(true);
    expect(ClaimReviewInput.safeParse({ claimId: 'claim-1', status: 'approved' }).success).toBe(
      true,
    );
    expect(ClaimReviewInput.safeParse({ claimId: 'claim-1', status: 'pending' }).success).toBe(
      false,
    );
    expect(ClaimReviewInput.safeParse({ status: 'rejected' }).success).toBe(false);
    expect(
      ClaimReviewResult.safeParse({
        claimId: 'claim-1',
        approvalStatus: 'approved',
        reviewedAt: '2026-09-18T12:00:00.000Z',
        reviewerId: 'owner-1',
      }).success,
    ).toBe(true);
    expect(
      ClaimReviewResult.safeParse({
        claimId: 'claim-1',
        approvalStatus: 'approved',
        reviewedAt: null,
        reviewerId: null,
      }).success,
    ).toBe(false);
    expect(
      ClaimBulkReviewInput.safeParse({
        claimIds: ['claim-1', 'claim-2'],
        status: 'rejected',
      }).success,
    ).toBe(true);
    expect(ClaimBulkReviewInput.safeParse({ claimIds: [], status: 'approved' }).success).toBe(false);
    expect(
      ClaimBulkReviewInput.safeParse({
        claimIds: ['claim-1', 'claim-1'],
        status: 'approved',
      }).success,
    ).toBe(false);
    expect(
      ClaimBulkReviewInput.safeParse({ claimIds: ['claim-1'], status: 'pending' }).success,
    ).toBe(false);
    expect(
      ClaimBulkReviewResult.safeParse({
        claimIds: ['claim-1', 'claim-2'],
        approvalStatus: 'approved',
        reviewedAt: '2026-09-18T12:00:00.000Z',
        reviewerId: 'owner-1',
      }).success,
    ).toBe(true);
  });
});
