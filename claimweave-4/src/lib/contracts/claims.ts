// @polsia:user-owned — shared read contract for persisted Claimweave claims.
import { z } from 'zod';
import {
  VerificationClassification,
  VerificationExcerpt,
} from '@/lib/contracts/evidence-verification';
import { ProcessingRoute, RouteTrace } from '@/lib/contracts/local-first';

export const DEFAULT_CLAIMS_PAGE_SIZE = 50;
export const MAX_CLAIMS_PAGE_SIZE = 100;

const positiveIntegerQueryValue = z
  .string()
  .min(1)
  .regex(/^\d+$/)
  .transform(Number)
  .refine(Number.isSafeInteger)
  .refine((value) => value > 0);

const ClaimsPaginationQuery = z.object({
  page: positiveIntegerQueryValue,
  pageSize: positiveIntegerQueryValue.refine((value) => value <= MAX_CLAIMS_PAGE_SIZE),
});

export const ClaimApprovalFilter = z.enum(['all', 'pending', 'approved', 'rejected']);
export const ClaimVerificationFilter = z.enum([
  'all',
  'not-checked',
  'supported',
  'unsupported',
  'contradicted',
  'stale',
]);
export const ClaimContradictionFilter = z.enum(['all', 'not-checked', 'found', 'none']);

const ClaimsFilterQuery = z.object({
  approvalStatus: ClaimApprovalFilter,
  verificationStatus: ClaimVerificationFilter,
  contradictionStatus: ClaimContradictionFilter,
});

function parseSingleFilterValue<T extends z.ZodType>(
  searchParams: URLSearchParams,
  key: string,
  schema: T,
) {
  const values = searchParams.getAll(key);
  if (values.length > 1 || values[0] === '') return null;
  if (values.length === 0) return 'all';
  const parsed = schema.safeParse(values[0]);
  return parsed.success ? parsed.data : null;
}

export function parseClaimsPagination(searchParams: URLSearchParams) {
  const pageValues = searchParams.getAll('page');
  const pageSizeValues = searchParams.getAll('pageSize');
  if (pageValues.length > 1 || pageSizeValues.length > 1) return null;

  const parsed = ClaimsPaginationQuery.safeParse({
    page: pageValues[0] ?? '1',
    pageSize: pageSizeValues[0] ?? String(DEFAULT_CLAIMS_PAGE_SIZE),
  });
  if (!parsed.success) return null;

  const skip = (parsed.data.page - 1) * parsed.data.pageSize;
  return Number.isSafeInteger(skip) ? { ...parsed.data, skip } : null;
}

export function parseClaimsQuery(searchParams: URLSearchParams) {
  const pagination = parseClaimsPagination(searchParams);
  if (!pagination) return null;

  const parsed = ClaimsFilterQuery.safeParse({
    approvalStatus: parseSingleFilterValue(searchParams, 'approvalStatus', ClaimApprovalFilter),
    verificationStatus: parseSingleFilterValue(
      searchParams,
      'verificationStatus',
      ClaimVerificationFilter,
    ),
    contradictionStatus: parseSingleFilterValue(
      searchParams,
      'contradictionStatus',
      ClaimContradictionFilter,
    ),
  });
  if (!parsed.success) return null;

  return { ...pagination, ...parsed.data };
}

export type ClaimApprovalFilter = z.infer<typeof ClaimApprovalFilter>;
export type ClaimVerificationFilter = z.infer<typeof ClaimVerificationFilter>;
export type ClaimContradictionFilter = z.infer<typeof ClaimContradictionFilter>;
export type ClaimsQuery = z.infer<typeof ClaimsFilterQuery> & {
  page: number;
  pageSize: number;
  skip: number;
};

export const SourceSpan = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  quote: z.string().min(1),
});

export const ClaimItem = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  text: z.string().min(1),
  sourceSpan: SourceSpan,
  citationLinks: z.array(z.string().url()),
  sourceUrl: z.string().url().nullable(),
  extractedAt: z.string().datetime(),
});

export const CitationTarget = z.object({
  /** The unchanged persisted URL shown to and preserved for the user. */
  url: z.string().url(),
  /** The URL opened by the browser, with a text fragment only when available. */
  href: z.string().url(),
  status: z.enum(['available', 'fallback']),
  reason: z.enum([
    'located',
    'missing-source',
    'empty-quote',
    'malformed-quote',
    'quote-not-found',
    'invalid-url',
  ]),
});

export const ClaimsList = z
  .object({
    projectId: z.string().min(1),
    documentId: z.string().min(1),
    sourceType: z.enum(['url', 'text']),
    sourceUrl: z.string().url().nullable(),
    extractedAt: z.string().datetime(),
    normalizedContentLength: z.number().int().nonnegative().nullable(),
    /** The route used to produce this persisted result. */
    processingRoute: ProcessingRoute,
    /** Route and measurement metadata; unavailable measurements remain null. */
    processingTrace: RouteTrace.nullable(),
    claims: z.array(ClaimItem),
  })
  .superRefine((value, context) => {
    const isUrl = value.sourceType === 'url';
    if (isUrl && value.sourceUrl === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sourceUrl'],
        message: 'URL results need a source URL.',
      });
    }
    if (!isUrl && value.sourceUrl !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sourceUrl'],
        message: 'Text results do not have a source URL.',
      });
    }
    value.claims.forEach((claim, index) => {
      if (isUrl && (claim.sourceUrl === null || claim.citationLinks.length === 0)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['claims', index],
          message: 'URL claims need a source URL and citation.',
        });
      }
      if (!isUrl && (claim.sourceUrl !== null || claim.citationLinks.length > 0)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['claims', index],
          message: 'Text claims cannot include external citations.',
        });
      }
    });
  });

export const ProjectResult = ClaimsList;

export const ClaimApprovalStatus = z.enum(['pending', 'approved', 'rejected']);
export const ClaimReviewInput = z.object({
  claimId: z.string().trim().min(1),
  status: z.enum(['approved', 'rejected']),
});

export const ClaimBulkReviewInput = z
  .object({
    claimIds: z.array(z.string().trim().min(1)).min(1).max(MAX_CLAIMS_PAGE_SIZE),
    status: z.enum(['approved', 'rejected']),
  })
  .superRefine((value, context) => {
    if (new Set(value.claimIds).size !== value.claimIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['claimIds'],
        message: 'Claim IDs must be unique.',
      });
    }
  });

export const ClaimReviewRequest = z.union([ClaimReviewInput, ClaimBulkReviewInput]);

export const ClaimsExportItem = ClaimItem.extend({
  sourcePassage: z.string().min(1),
  citationTargets: z.array(CitationTarget),
  extractedAt: z.string().datetime({ offset: true }),
  evidenceExcerpts: z.array(VerificationExcerpt),
  verificationStatus: VerificationClassification.nullable(),
  approvalStatus: ClaimApprovalStatus,
  reviewedAt: z.string().datetime({ offset: true }).nullable(),
  reviewerId: z.string().min(1).nullable(),
});

export const ClaimReviewResult = z.object({
  claimId: z.string().min(1),
  approvalStatus: ClaimApprovalStatus,
  reviewedAt: z.string().datetime({ offset: true }),
  reviewerId: z.string().min(1),
});

export const ClaimBulkReviewResult = z.object({
  claimIds: z.array(z.string().min(1)).min(1),
  approvalStatus: ClaimApprovalStatus,
  reviewedAt: z.string().datetime({ offset: true }),
  reviewerId: z.string().min(1),
});

export const ClaimsPaginationMetadata = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().positive().max(MAX_CLAIMS_PAGE_SIZE),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
  hasNextPage: z.boolean(),
  hasPreviousPage: z.boolean(),
});

export const ClaimsExport = z
  .object({
    projectId: z.string().min(1),
    documentId: z.string().min(1),
    sourceType: z.enum(['url', 'text']),
    sourceUrl: z.string().url().nullable(),
    extractedAt: z.string().datetime({ offset: true }),
    normalizedContentLength: z.number().int().nonnegative().nullable(),
    /** The route discriminator; null means the legacy or persisted route is unavailable. */
    processingRoute: ProcessingRoute.nullable(),
    /** Optional route and measurement metadata; unavailable measurements remain null. */
    processingTrace: RouteTrace.nullable(),
    pagination: ClaimsPaginationMetadata,
    claims: z.array(ClaimsExportItem),
  })
  .superRefine((value, context) => {
    const isUrl = value.sourceType === 'url';
    if (isUrl && value.sourceUrl === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sourceUrl'],
        message: 'URL results need a source URL.',
      });
    }
    if (!isUrl && value.sourceUrl !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sourceUrl'],
        message: 'Text results do not have a source URL.',
      });
    }
    value.claims.forEach((claim, index) => {
      if (isUrl && (claim.sourceUrl === null || claim.citationLinks.length === 0)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['claims', index],
          message: 'URL claims need a source URL and citation.',
        });
      }
      if (claim.citationTargets.length !== claim.citationLinks.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['claims', index, 'citationTargets'],
          message: 'Citation targets must preserve every citation link.',
        });
      }
      claim.citationTargets.forEach((target, targetIndex) => {
        if (target.url !== claim.citationLinks[targetIndex]) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['claims', index, 'citationTargets', targetIndex, 'url'],
            message: 'Citation target URLs must preserve the persisted citation links.',
          });
        }
      });
      if (!isUrl && (claim.sourceUrl !== null || claim.citationLinks.length > 0)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['claims', index],
          message: 'Text claims cannot include external citations.',
        });
      }
    });
  });

export type SourceSpan = z.infer<typeof SourceSpan>;
export type ClaimItem = z.infer<typeof ClaimItem>;
export type ClaimsList = z.infer<typeof ClaimsList>;
export type ProjectResult = z.infer<typeof ProjectResult>;
export type ClaimApprovalStatus = z.infer<typeof ClaimApprovalStatus>;
export type ClaimReviewInput = z.infer<typeof ClaimReviewInput>;
export type ClaimBulkReviewInput = z.infer<typeof ClaimBulkReviewInput>;
export type ClaimReviewRequest = z.infer<typeof ClaimReviewRequest>;
export type ClaimsExportItem = z.infer<typeof ClaimsExportItem>;
export type CitationTarget = z.infer<typeof CitationTarget>;
export type ClaimsPaginationMetadata = z.infer<typeof ClaimsPaginationMetadata>;
export type ClaimsExport = z.infer<typeof ClaimsExport>;
export type ClaimReviewResult = z.infer<typeof ClaimReviewResult>;
export type ClaimBulkReviewResult = z.infer<typeof ClaimBulkReviewResult>;
