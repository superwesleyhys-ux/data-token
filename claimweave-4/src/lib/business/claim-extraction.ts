// @polsia:user-owned — Claimweave source fetching, AI extraction, and persistence.

import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AiConfigurationError, generateObject } from '@/lib/ai/client';
import {
  emptyCounters,
  qualityMetrics,
  recordExtractionTrace,
} from '@/lib/business/claim-extraction-observability';
import {
  buildAcceptanceTuple,
  CLAIM_EXTRACTION_INSTRUCTIONS,
  cacheKey,
  type ExtractionOptions,
  populateExactCache,
  readExactCache,
  sourceIdentity,
} from '@/lib/business/claim-extraction-reuse';
import {
  createClaimweaveRevision,
  type RevisionClaimValue,
  type RevisionDocumentValue,
} from '@/lib/business/claimweave-revisions';
import { ClaimItem, ProjectResult } from '@/lib/contracts/claims';
import {
  ProcessingRoute,
  type RouteTrace,
  traceForProcessingRoute,
} from '@/lib/contracts/local-first';
import { prisma } from '@/lib/db';

const MAX_RESPONSE_BYTES = 1_500_000;
const MAX_TEXT_CHARS = 80_000;
const FETCH_TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 3;

export class ClaimweaveError extends Error {
  constructor(
    message: string,
    readonly status = 422,
  ) {
    super(message);
    this.name = 'ClaimweaveError';
  }
}

const modelOutputSchema = z.object({
  claims: z
    .array(
      z.object({
        text: z.string().min(1),
        quote: z.string().min(1),
        start: z.number().int().nonnegative(),
        end: z.number().int().nonnegative(),
        citationLinks: z.array(z.string()).optional().default([]),
      }),
    )
    // Keep the parser aligned with the frozen benchmark output contract.
    .max(10),
});

function ipv4IsPrivate(value: string) {
  const octets = value.split('.').map(Number);
  if (
    octets.length !== 4 ||
    octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return true;
  }
  const first = octets[0] ?? -1;
  const second = octets[1] ?? -1;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224
  );
}

function ipIsPrivate(value: string) {
  const kind = isIP(value);
  if (kind === 4) return ipv4IsPrivate(value);
  if (kind === 6) {
    const normalized = value.toLowerCase();
    return (
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe8') ||
      normalized.startsWith('fe9') ||
      normalized.startsWith('fea') ||
      normalized.startsWith('feb') ||
      normalized.startsWith('::ffff:')
    );
  }
  return false;
}

export async function assertSafeSourceUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ClaimweaveError('Enter a valid source URL.');
  }
  if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) {
    throw new ClaimweaveError('Only public http and https URLs are supported.');
  }
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname === 'metadata.google.internal' ||
    ipIsPrivate(hostname)
  ) {
    throw new ClaimweaveError('That source address is not publicly reachable.');
  }
  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (addresses.length === 0 || addresses.some(({ address }) => ipIsPrivate(address))) {
      throw new ClaimweaveError('That source address is not publicly reachable.');
    }
  } catch (error) {
    if (error instanceof ClaimweaveError) throw error;
    throw new ClaimweaveError('The source address could not be verified.');
  }
  return parsed.toString();
}

async function readResponseText(response: Response) {
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_RESPONSE_BYTES) {
    throw new ClaimweaveError('That source is too large to process.');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ClaimweaveError('The source returned no readable content.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES)
        throw new ClaimweaveError('That source is too large to process.');
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function decodeHtml(value: string) {
  return value
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, code: string) => {
      const parsed = code.toLowerCase().startsWith('x')
        ? Number.parseInt(code.slice(1), 16)
        : Number.parseInt(code, 10);
      return Number.isSafeInteger(parsed) ? String.fromCodePoint(parsed) : '';
    })
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

export function extractReadableText(raw: string, contentType = 'text/html') {
  const isHtml = contentType.toLowerCase().includes('html');
  const text = isHtml
    ? raw
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<(script|style|noscript|svg)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
    : raw;
  return decodeHtml(text).replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_CHARS);
}

function sourceLinks(raw: string, sourceUrl: string) {
  const links = new Set([sourceUrl]);
  for (const match of raw.matchAll(/\b(?:href|cite)\s*=\s*["']([^"']+)["']/gi)) {
    const href = match[1];
    if (!href) continue;
    try {
      const resolved = new URL(href, sourceUrl);
      if (/^https?:$/.test(resolved.protocol)) links.add(resolved.toString());
    } catch {
      // Ignore malformed links from the source page.
    }
  }
  return links;
}

async function fetchSource(sourceUrl: string) {
  let currentUrl = sourceUrl;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    currentUrl = await assertSafeSourceUrl(currentUrl);
    const fixtureOrigin = process.env.CLAIMWEAVE_TEST_SOURCE_ORIGIN;
    const requestUrl =
      fixtureOrigin && new URL(currentUrl).hostname === 'example.com'
        ? new URL(new URL(currentUrl).pathname, fixtureOrigin).toString()
        : currentUrl;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(requestUrl, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { accept: 'text/html,text/plain;q=0.9' },
        cache: 'no-store',
      });
    } catch {
      throw new ClaimweaveError('We could not read that source. Check the URL and try again.');
    } finally {
      clearTimeout(timeout);
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location || redirect === MAX_REDIRECTS) {
        throw new ClaimweaveError('The source redirected too many times.');
      }
      try {
        currentUrl = new URL(location, currentUrl).toString();
      } catch {
        throw new ClaimweaveError('The source returned an invalid redirect.');
      }
      continue;
    }
    if (!response.ok) throw new ClaimweaveError('The source could not be read.');
    const contentType = response.headers.get('content-type') ?? 'text/html';
    if (!/text\/(html|plain)/i.test(contentType)) {
      throw new ClaimweaveError('Only HTML and plain-text sources are supported.');
    }
    const raw = await readResponseText(response);
    const text = extractReadableText(raw, contentType);
    if (text.length < 40)
      throw new ClaimweaveError('The source did not contain enough readable text.');
    return { text, raw, finalUrl: currentUrl };
  }
  throw new ClaimweaveError('The source could not be reached.');
}

function normalizedCitationLinks(
  values: string[],
  sourceUrl: string | null,
  available: Set<string>,
) {
  if (!sourceUrl) return [];
  const links = new Set<string>([sourceUrl]);
  for (const value of values) {
    try {
      const link = new URL(value, sourceUrl).toString();
      if (available.has(link) || new URL(link).origin === new URL(sourceUrl).origin)
        links.add(link);
    } catch {
      // Drop citations that are not real web links.
    }
  }
  return [...links];
}

export function normalizeClaims(
  payload: unknown,
  sourceText: string,
  sourceUrl: string | null,
  extractedAt: Date,
  rawSource = '',
) {
  const parsed = modelOutputSchema.safeParse(payload);
  if (!parsed.success)
    throw new ClaimweaveError('The source could not be converted into verifiable claims.');
  const available = sourceUrl ? sourceLinks(rawSource, sourceUrl) : new Set<string>();
  const claims: Array<z.infer<typeof ClaimItem>> = [];
  for (const candidate of parsed.data.claims) {
    let quote = candidate.quote.trim();
    let start = candidate.start;
    let end = candidate.end;
    if (sourceText.slice(start, end) !== quote) {
      start = sourceText.indexOf(quote);
      end = start >= 0 ? start + quote.length : -1;
    }
    if (start < 0 || end <= start || sourceText.slice(start, end) !== quote) {
      const fallback = sourceText.indexOf(candidate.text.trim());
      if (fallback < 0) continue;
      start = fallback;
      end = fallback + candidate.text.trim().length;
      quote = sourceText.slice(start, end);
    }
    claims.push({
      id: `claim-${claims.length + 1}`,
      projectId: 'pending',
      text: candidate.text.trim(),
      sourceSpan: { start, end, quote },
      citationLinks: normalizedCitationLinks(candidate.citationLinks, sourceUrl, available),
      sourceUrl,
      extractedAt: extractedAt.toISOString(),
    });
  }
  if (claims.length === 0)
    throw new ClaimweaveError('No verifiable claims were found in that source.');
  return claims;
}

export function normalizePastedText(value: string) {
  const text = value.trim();
  if (text.length < 40) {
    throw new ClaimweaveError('Paste at least 40 characters of source text.');
  }
  if (text.length > MAX_TEXT_CHARS) {
    throw new ClaimweaveError('Paste no more than 80,000 characters of source text.');
  }
  return text;
}

type NormalizedExtraction = {
  sourceText: string;
  sourceUrl: string | null;
  rawSource: string;
  extractedAt: Date;
  claims: Array<z.infer<typeof ClaimItem>>;
  processingRoute: ProcessingRoute;
  processingTrace: RouteTrace;
};

function processingRouteFor(
  cacheDecision: 'disabled' | 'miss' | 'hit' | 'rejected',
): ProcessingRoute {
  return cacheDecision === 'hit' ? 'trusted-server-reuse' : 'model-fallback';
}

function extractionTrace(input: {
  cacheDecision: 'disabled' | 'miss' | 'hit' | 'rejected';
  rejectionReason?: string;
  modelCallCount: number;
  latencyMs: number;
  transferredBytes: number;
  claimsAvailable: boolean;
}): RouteTrace {
  const route = processingRouteFor(input.cacheDecision);
  const base = traceForProcessingRoute(route);
  return {
    ...base,
    state:
      input.cacheDecision === 'hit'
        ? 'exact-repeat'
        : input.rejectionReason === 'content_mismatch'
          ? 'changed-input'
          : input.cacheDecision === 'disabled' || input.cacheDecision === 'miss'
            ? 'cold-start'
            : 'fallback',
    computationLocation: input.cacheDecision === 'hit' ? 'trusted-server' : 'live-model',
    reuseDecision: input.cacheDecision === 'disabled' ? 'miss' : input.cacheDecision,
    accessCorrectness: input.claimsAvailable ? 'passed' : 'unknown',
    modelCallCount: input.modelCallCount,
    latencyMs: input.latencyMs,
    transferredBytes: input.transferredBytes,
    fallbackReason:
      input.cacheDecision === 'hit'
        ? null
        : (input.rejectionReason ?? (input.cacheDecision === 'miss' ? 'cache_miss' : null)),
  };
}

async function extractSourceClaims(
  sourceText: string,
  sourceUrl: string | null,
  rawSource: string,
  options: ExtractionOptions = {},
  retrievalCalls = 0,
  retrievalBytes = 0,
): Promise<NormalizedExtraction> {
  const extractedAt = new Date();
  const startedAt = Date.now();
  const tenantScope = options.tenantScope ?? 'anonymous';
  const permissionScope = options.sequence?.permissionScope ?? 'claim-extraction:member';
  const sequence = options.sequence;
  const counters = emptyCounters();
  const canUseCache = options.reuseEnabled === true && Boolean(options.tenantScope);
  const cacheBlockedByFreshness = sourceUrl !== null && !sequence?.evidenceFreshUntil;
  const tuple = buildAcceptanceTuple({
    sourceText,
    sourceUrl,
    rawSource,
    tenantScope,
    permissionScope,
    evidenceFreshUntil: sequence?.evidenceFreshUntil,
  });
  const currentCacheKey = cacheKey(tuple);
  let cacheDecision: 'disabled' | 'miss' | 'hit' | 'rejected' = options.reuseEnabled
    ? 'miss'
    : 'disabled';
  let rejectionReason: Parameters<typeof recordExtractionTrace>[0]['rejectionReason'] | undefined;

  const trace = async (claims: Array<z.infer<typeof ClaimItem>> | undefined) => {
    await recordExtractionTrace({
      sequence,
      cacheKey: currentCacheKey,
      tenantScope,
      permissionScope,
      cacheDecision,
      rejectionReason,
      modelCallMade: counters.normalModelCall > 0,
      latencyMs: Date.now() - startedAt,
      retrievalCalls,
      retrievalBytes,
      quality: claims ? qualityMetrics(claims, sourceText, sourceUrl) : undefined,
      counters,
      stage: 'extraction',
      sourceHash: tuple.inputDigest,
      sourceVersion: sequence?.configHash,
    });
  };

  if (options.reuseEnabled === true && !options.tenantScope) {
    cacheDecision = 'rejected';
    rejectionReason = 'tenant_scope_missing';
  } else if (canUseCache && cacheBlockedByFreshness) {
    cacheDecision = 'rejected';
    rejectionReason = 'freshness_mismatch';
  } else if (canUseCache) {
    try {
      const cached = await readExactCache({
        tuple,
        key: currentCacheKey,
        sourceIdentity: sourceIdentity(sourceUrl),
        sourceText,
        sourceUrl,
        rawSource,
        extractedAt,
      });
      cacheDecision = cached.decision;
      if (cached.decision === 'hit') {
        counters.cacheValidation += 1;
        counters.validationCalls += 1;
        counters.validHit += 1;
        const claims = cached.claims.map((claim, index) => ({
          ...claim,
          id: `claim-${index + 1}`,
          projectId: 'pending',
          extractedAt: extractedAt.toISOString(),
        }));
        await trace(claims);
        return {
          sourceText,
          sourceUrl,
          rawSource,
          extractedAt,
          claims,
          processingRoute: 'trusted-server-reuse',
          processingTrace: extractionTrace({
            cacheDecision,
            modelCallCount: counters.normalModelCall,
            latencyMs: Date.now() - startedAt,
            transferredBytes: retrievalBytes,
            claimsAvailable: true,
          }),
        };
      }
      if (cached.decision === 'rejected') {
        rejectionReason = cached.reason;
        counters.cacheValidation += 1;
        counters.validationCalls += 1;
        counters.cacheFallback += 1;
        counters.fallbacks += 1;
        if (
          cached.reason === 'malformed_result' ||
          cached.reason === 'span_mismatch' ||
          cached.reason === 'citation_mismatch'
        ) {
          counters.cacheRepair += 1;
          counters.repairs += 1;
        }
      } else {
        counters.cacheFallback += 1;
        counters.fallbacks += 1;
      }
    } catch {
      cacheDecision = 'rejected';
      rejectionReason = 'cache_miss';
      counters.cacheFallback += 1;
    }
  }

  let modelOutput: unknown;
  counters.normalModelCall += 1;
  try {
    const sourceContext = sourceUrl
      ? `SOURCE URL:\n${sourceUrl}\n\nSOURCE TEXT (untrusted):\n<source>\n${sourceText}\n</source>`
      : `SOURCE TEXT (untrusted pasted text):\n<source>\n${sourceText}\n</source>`;
    modelOutput = await generateObject({
      task: 'claim-extraction',
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: CLAIM_EXTRACTION_INSTRUCTIONS,
        },
        {
          role: 'user',
          content: sourceContext,
        },
      ],
    });
  } catch (error) {
    await trace(undefined);
    if (error instanceof AiConfigurationError) {
      throw new ClaimweaveError('Claim extraction is not configured yet.', 503);
    }
    throw new ClaimweaveError(
      'Claim extraction is temporarily unavailable. Please try again.',
      502,
    );
  }
  let claims: Array<z.infer<typeof ClaimItem>>;
  try {
    claims = normalizeClaims(modelOutput, sourceText, sourceUrl, extractedAt, rawSource).map(
      (claim) => ({
        ...claim,
        projectId: 'pending',
      }),
    );
  } catch (error) {
    await trace(undefined);
    throw error;
  }
  if (canUseCache && !cacheBlockedByFreshness) {
    await populateExactCache({
      tuple,
      key: currentCacheKey,
      sourceIdentity: sourceIdentity(sourceUrl),
      sourceUrl,
      sourceText,
      claims,
      evidenceFreshUntil: sequence?.evidenceFreshUntil,
      repair:
        rejectionReason === 'malformed_result' ||
        rejectionReason === 'span_mismatch' ||
        rejectionReason === 'citation_mismatch',
    });
    counters.cachePopulation += 1;
    counters.initialCacheCreation += 1;
  }
  await trace(claims);
  const processingRoute = processingRouteFor(cacheDecision);
  return {
    sourceText,
    sourceUrl,
    rawSource,
    extractedAt,
    claims,
    processingRoute,
    processingTrace: extractionTrace({
      cacheDecision,
      rejectionReason,
      modelCallCount: counters.normalModelCall,
      latencyMs: Date.now() - startedAt,
      transferredBytes: retrievalBytes,
      claimsAvailable: true,
    }),
  };
}

function claimCreateData(claim: z.infer<typeof ClaimItem>, extractedAt: Date) {
  return {
    text: claim.text,
    sourceStart: claim.sourceSpan.start,
    sourceEnd: claim.sourceSpan.end,
    sourceQuote: claim.sourceSpan.quote,
    citationLinks: claim.citationLinks,
    sourceUrl: claim.sourceUrl,
    extractedAt,
  };
}

function snapshotCreateData(claim: z.infer<typeof ClaimItem>, createdAt: Date) {
  return {
    text: claim.text,
    sourceStart: claim.sourceSpan.start,
    sourceEnd: claim.sourceSpan.end,
    sourceQuote: claim.sourceSpan.quote,
    sourceUrl: claim.sourceUrl,
    citationLinks: claim.citationLinks,
    createdAt,
  };
}

function revisionCitationLinks(value: unknown) {
  return Array.isArray(value) && value.every((link): link is string => typeof link === 'string')
    ? value
    : [];
}

function revisionDocument(
  document: {
    id: string;
    url: string | null;
    documentText?: string | null;
    normalizedContent: string | null;
    status: string;
    processingRoute?: string | null;
    processingTrace?: unknown;
    extractedAt: Date;
  },
  kind: 'primary' | 'imported',
): RevisionDocumentValue {
  return {
    id: document.id,
    kind,
    url: document.url,
    documentText: document.documentText ?? null,
    normalizedContent: document.normalizedContent,
    status: document.status,
    processingRoute: document.processingRoute ?? null,
    processingTrace: document.processingTrace ?? null,
    extractedAt: document.extractedAt,
  };
}

function revisionClaim(
  claim: {
    id: string;
    text: string;
    sourceStart: number;
    sourceEnd: number;
    sourceQuote: string;
    citationLinks: unknown;
    sourceUrl: string | null;
    extractedAt: Date;
  },
  sourceDocumentId: string,
  documentKind: 'primary' | 'imported',
): RevisionClaimValue & { sourceDocumentId: string; documentKind: 'primary' | 'imported' } {
  return {
    id: claim.id,
    text: claim.text,
    sourceStart: claim.sourceStart,
    sourceEnd: claim.sourceEnd,
    sourceQuote: claim.sourceQuote,
    sourceUrl: claim.sourceUrl,
    citationLinks: revisionCitationLinks(claim.citationLinks),
    extractedAt: claim.extractedAt,
    sourceDocumentId,
    documentKind,
  };
}

function projectResult(
  projectId: string,
  source: {
    id: string;
    url: string | null;
    extractedAt: Date;
    normalizedContent: string | null;
    processingRoute?: string;
    claims: Array<{
      id: string;
      text: string;
      sourceStart: number;
      sourceEnd: number;
      sourceQuote: string;
      citationLinks: unknown;
      sourceUrl: string | null;
      extractedAt: Date;
    }>;
  },
  processingTrace?: RouteTrace,
) {
  const sourceType = source.url ? 'url' : 'text';
  return ProjectResult.parse({
    projectId,
    documentId: source.id,
    sourceType,
    sourceUrl: source.url,
    extractedAt: source.extractedAt.toISOString(),
    normalizedContentLength: source.normalizedContent?.length ?? null,
    processingRoute: ProcessingRoute.parse(source.processingRoute ?? 'legacy-unknown'),
    processingTrace:
      processingTrace ??
      traceForProcessingRoute(ProcessingRoute.parse(source.processingRoute ?? 'legacy-unknown')),
    claims: source.claims
      .slice()
      .sort((a, b) => a.sourceStart - b.sourceStart)
      .map((claim) =>
        ClaimItem.parse({
          id: claim.id,
          projectId,
          text: claim.text,
          sourceSpan: {
            start: claim.sourceStart,
            end: claim.sourceEnd,
            quote: claim.sourceQuote,
          },
          citationLinks: claim.citationLinks,
          sourceUrl: claim.sourceUrl,
          extractedAt: claim.extractedAt.toISOString(),
        }),
      ),
  });
}

async function persistInitialProject(extraction: NormalizedExtraction, ownerId?: string) {
  const runCreatedAt = new Date();
  try {
    const persisted = await prisma.$transaction(async (tx) => {
      const project = await tx.claimweaveProject.create({
        data: {
          ...(ownerId ? { userId: ownerId } : {}),
          source: {
            create: {
              url: extraction.sourceUrl,
              ...(extraction.sourceUrl ? {} : { documentText: extraction.sourceText }),
              normalizedContent: extraction.sourceText,
              extractedAt: extraction.extractedAt,
              status: 'complete',
              processingRoute: extraction.processingRoute,
              processingTrace: extraction.processingTrace,
              claims: {
                create: extraction.claims.map((claim) =>
                  claimCreateData(claim, extraction.extractedAt),
                ),
              },
            },
          },
        },
        include: { source: { include: { claims: true } } },
      });
      const savedSource = project.source;
      if (!savedSource) throw new Error('Missing source after persistence.');
      await tx.claimweaveProcessingRun.create({
        data: {
          projectId: project.id,
          version: 1,
          evidenceState: savedSource.status,
          processingRoute: extraction.processingRoute,
          documentId: savedSource.id,
          documentKind: 'primary',
          createdAt: runCreatedAt,
          snapshots: {
            create: extraction.claims.map((claim) => snapshotCreateData(claim, runCreatedAt)),
          },
        },
      });
      await createClaimweaveRevision(tx, {
        projectId: project.id,
        ownerId,
        eventKind: 'ingestion',
        createdAt: runCreatedAt,
        currentDocuments: [revisionDocument(savedSource, 'primary')],
        currentClaims: savedSource.claims.map((claim) =>
          revisionClaim(claim, savedSource.id, 'primary'),
        ),
      });
      return project;
    });
    const savedSource = persisted.source;
    if (!savedSource) throw new Error('Missing source after persistence.');
    return projectResult(persisted.id, savedSource, extraction.processingTrace);
  } catch (error) {
    if (error instanceof ClaimweaveError) throw error;
    throw new ClaimweaveError('We could not save the extracted claims. Please try again.', 500);
  }
}

export async function createQueuedProject(input: { url?: string; text?: string }, ownerId: string) {
  const sourceUrl = input.url ? new URL(input.url).toString() : null;
  const sourceText = input.text ? normalizePastedText(input.text) : null;
  if (!sourceUrl && !sourceText) {
    throw new ClaimweaveError('Submit a URL or pasted text.', 400);
  }

  try {
    const createdAt = new Date();
    const project = await prisma.claimweaveProject.create({
      data: {
        userId: ownerId,
        source: {
          create: {
            url: sourceUrl,
            documentText: sourceText,
            extractedAt: createdAt,
            status: 'processing',
            processingStartedAt: createdAt,
          },
        },
      },
      include: { source: true },
    });
    const source = project.source;
    if (!source) throw new Error('Missing source after project creation.');
    return {
      projectId: project.id,
      sourceType: source.url ? ('url' as const) : ('text' as const),
      status: 'processing' as const,
    };
  } catch (error) {
    if (error instanceof ClaimweaveError) throw error;
    throw new ClaimweaveError('We could not start this project. Please try again.', 500);
  }
}

type ProjectProcessingClaim =
  | { kind: 'claimed'; token: string }
  | {
      kind: 'complete';
      source: { url: string | null; status: string; processingError: string | null };
    }
  | { kind: 'failed'; error: string | null }
  | { kind: 'conflict' };

export async function claimProjectForProcessing(
  projectId: string,
  ownerId: string,
  retry: boolean,
): Promise<ProjectProcessingClaim> {
  const token = randomUUID();
  return prisma.$transaction(async (tx) => {
    const project = await tx.claimweaveProject.findFirst({
      where: { id: projectId, userId: ownerId },
      select: { source: true },
    });
    if (!project?.source) throw new ClaimweaveError('Project not found.', 404);
    const source = project.source;
    if (source.status === 'complete') return { kind: 'complete', source };
    if (source.status === 'failed' && !retry) {
      return { kind: 'failed', error: source.processingError };
    }
    if (source.status !== 'processing' && source.status !== 'failed') {
      return { kind: 'conflict' };
    }
    const claimed = await tx.claimweaveSource.updateMany({
      where: {
        id: source.id,
        ...(source.status === 'failed'
          ? { status: 'failed' }
          : { status: 'processing', processingClaim: null }),
      },
      data: {
        status: 'processing',
        processingClaim: token,
        processingError: null,
        processingStartedAt: new Date(),
      },
    });
    if (claimed.count !== 1) return { kind: 'conflict' };
    return { kind: 'claimed', token };
  });
}

function processingFailure(error: unknown) {
  if (error instanceof ClaimweaveError) return error;
  return new ClaimweaveError('Claim extraction failed. Please try again.', 502);
}

export async function markProjectProcessingFailed(
  projectId: string,
  ownerId: string,
  processingClaim: string,
  error: unknown,
) {
  const failure = processingFailure(error);
  await prisma.claimweaveSource.updateMany({
    where: {
      projectId,
      project: { userId: ownerId },
      processingClaim,
      status: 'processing',
    },
    data: {
      status: 'failed',
      processingError: failure.message,
      processingClaim: null,
    },
  });
  return failure;
}

export async function processExistingProject(input: {
  projectId: string;
  ownerId: string;
  processingClaim: string;
}) {
  const project = await prisma.claimweaveProject.findFirst({
    where: { id: input.projectId, userId: input.ownerId },
    include: { source: { include: { claims: true } } },
  });
  const currentSource = project?.source;
  if (!currentSource) throw new ClaimweaveError('Project not found.', 404);
  if (currentSource.processingClaim !== input.processingClaim) {
    throw new ClaimweaveError('This project is already being processed.', 409);
  }

  let extraction: NormalizedExtraction;
  try {
    if (currentSource.url) {
      const sourceUrl = currentSource.url;
      const source = await fetchSource(sourceUrl);
      extraction = await extractSourceClaims(
        source.text,
        sourceUrl,
        source.raw,
        { reuseEnabled: true, tenantScope: input.ownerId },
        1,
        source.raw.length,
      );
    } else {
      const sourceText = normalizePastedText(currentSource.documentText ?? '');
      extraction = await extractSourceClaims(sourceText, null, sourceText, {
        reuseEnabled: true,
        tenantScope: input.ownerId,
      });
    }
  } catch (error) {
    throw processingFailure(error);
  }

  const runCreatedAt = new Date();
  try {
    const persisted = await prisma.$transaction(async (tx) => {
      const updatedSource = await tx.claimweaveSource.updateMany({
        where: {
          id: currentSource.id,
          processingClaim: input.processingClaim,
          status: 'processing',
        },
        data: {
          url: extraction.sourceUrl,
          documentText: extraction.sourceUrl ? null : extraction.sourceText,
          normalizedContent: extraction.sourceText,
          extractedAt: extraction.extractedAt,
          status: 'complete',
          processingError: null,
          processingClaim: null,
          processingRoute: extraction.processingRoute,
          processingTrace: extraction.processingTrace,
        },
      });
      if (updatedSource.count !== 1) {
        throw new ClaimweaveError('This project is already being processed.', 409);
      }
      const savedSource = await tx.claimweaveSource.findUniqueOrThrow({
        where: { id: currentSource.id },
        include: { claims: true },
      });
      await tx.claimweaveSource.update({
        where: { id: currentSource.id },
        data: {
          claims: {
            deleteMany: {},
            create: extraction.claims.map((claim) =>
              claimCreateData(claim, extraction.extractedAt),
            ),
          },
        },
        include: { claims: true },
      });
      const completeSource = await tx.claimweaveSource.findUniqueOrThrow({
        where: { id: currentSource.id },
        include: { claims: true },
      });
      await tx.claimweaveProcessingRun.create({
        data: {
          projectId: input.projectId,
          version: 1,
          evidenceState: 'complete',
          processingRoute: extraction.processingRoute,
          documentId: completeSource.id,
          documentKind: 'primary',
          createdAt: runCreatedAt,
          snapshots: {
            create: extraction.claims.map((claim) => snapshotCreateData(claim, runCreatedAt)),
          },
        },
      });
      await createClaimweaveRevision(tx, {
        projectId: input.projectId,
        ownerId: input.ownerId,
        eventKind: 'ingestion',
        createdAt: runCreatedAt,
        previousDocuments: [revisionDocument(savedSource, 'primary')],
        currentDocuments: [revisionDocument(completeSource, 'primary')],
        previousClaims: [],
        currentClaims: completeSource.claims.map((claim) =>
          revisionClaim(claim, completeSource.id, 'primary'),
        ),
      });
      return completeSource;
    });
    return projectResult(input.projectId, persisted, extraction.processingTrace);
  } catch (error) {
    throw processingFailure(error);
  }
}

function isUniqueConstraintError(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

type ImportedRowWithDocument = Prisma.ClaimweaveUrlImportRowGetPayload<{
  include: { importedDocument: { include: { claims: true } } };
}>;

function safeImportError(error: unknown) {
  if (error instanceof ClaimweaveError) return error;
  return new ClaimweaveError('We could not process this URL. Please try again.', 502);
}

async function refreshUrlImportBatchStatus(tx: Prisma.TransactionClient, batchId: string) {
  const rows = await tx.claimweaveUrlImportRow.findMany({
    where: { batchId },
    select: { normalizedUrl: true, status: true },
  });
  const validRows = rows.filter((row) => row.normalizedUrl !== null);
  const hasPending = validRows.some(
    (row) => row.status === 'queued' || row.status === 'processing',
  );
  const hasFailure = validRows.some((row) => row.status === 'failed');
  return tx.claimweaveUrlImportBatch.update({
    where: { id: batchId },
    data: { status: hasPending ? 'processing' : hasFailure ? 'failed' : 'completed' },
  });
}

async function markUrlImportRowFailed(rowId: string, projectId: string, error: unknown) {
  const failure = safeImportError(error);
  try {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.claimweaveUrlImportRow.updateMany({
        where: { id: rowId, projectId, status: 'processing' },
        data: {
          status: 'failed',
          error: failure.message,
          failedAt: new Date(),
        },
      });
      if (updated.count > 0) {
        const row = await tx.claimweaveUrlImportRow.findUnique({
          where: { id: rowId },
          select: { batchId: true },
        });
        if (row) await refreshUrlImportBatchStatus(tx, row.batchId);
      }
    });
  } catch {
    // Preserve the original processing error if the failure update is unavailable.
  }
}

export async function processUrlImportRow(input: {
  rowId: string;
  projectId: string;
  ownerId: string;
}): Promise<ImportedRowWithDocument> {
  const row = await prisma.claimweaveUrlImportRow.findFirst({
    where: {
      id: input.rowId,
      projectId: input.projectId,
      status: 'processing',
      normalizedUrl: { not: null },
    },
    select: { id: true, normalizedUrl: true },
  });
  if (!row?.normalizedUrl) {
    throw new ClaimweaveError('This URL row is no longer processing.', 409);
  }
  const normalizedUrl = row.normalizedUrl;

  let extraction: NormalizedExtraction;
  try {
    const source = await fetchSource(normalizedUrl);
    extraction = await extractSourceClaims(
      source.text,
      normalizedUrl,
      source.raw,
      { reuseEnabled: true, tenantScope: input.ownerId },
      1,
      source.raw.length,
    );
  } catch (error) {
    const failure = safeImportError(error);
    await markUrlImportRowFailed(input.rowId, input.projectId, failure);
    throw failure;
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.claimweaveImportedDocument.findUnique({
        where: {
          projectId_normalizedUrl: {
            projectId: input.projectId,
            normalizedUrl,
          },
        },
        include: { claims: true },
      });
      if (existing && existing.rowId !== input.rowId) {
        throw new ClaimweaveError('This URL was already processed in this project.', 409);
      }

      if (!existing) {
        await tx.claimweaveImportedDocument.create({
          data: {
            projectId: input.projectId,
            rowId: input.rowId,
            normalizedUrl,
            documentText: extraction.sourceText,
            normalizedContent: extraction.sourceText,
            extractedAt: extraction.extractedAt,
            status: 'completed',
            processingRoute: extraction.processingRoute,
            processingTrace: extraction.processingTrace,
            claims: {
              create: extraction.claims.map((claim) => ({
                ...claimCreateData(claim, extraction.extractedAt),
                projectId: input.projectId,
                rowId: input.rowId,
              })),
            },
          },
          include: { claims: true },
        });
      }
      const completedAt = new Date();
      const completed = await tx.claimweaveUrlImportRow.update({
        where: { id: input.rowId },
        data: {
          status: 'completed',
          error: null,
          completedAt,
          failedAt: null,
        },
        include: { importedDocument: { include: { claims: true } } },
      });
      await refreshUrlImportBatchStatus(tx, completed.batchId);
      if (!completed.importedDocument)
        throw new Error('Missing imported document after persistence.');
      const importedDocument = completed.importedDocument;
      const documentValue = (document: typeof importedDocument) =>
        revisionDocument(
          {
            id: document.id,
            url: document.normalizedUrl,
            documentText: document.documentText,
            normalizedContent: document.normalizedContent,
            status: document.status,
            processingRoute: document.processingRoute,
            processingTrace: document.processingTrace,
            extractedAt: document.extractedAt,
          },
          'imported',
        );
      await createClaimweaveRevision(tx, {
        projectId: input.projectId,
        ownerId: input.ownerId,
        eventKind: 'ingestion',
        createdAt: completed.completedAt ?? new Date(),
        previousDocuments: existing ? [documentValue(existing)] : [],
        currentDocuments: [documentValue(importedDocument)],
        previousClaims: existing?.claims.map((claim) =>
          revisionClaim(claim, existing.id, 'imported'),
        ),
        currentClaims: importedDocument.claims.map((claim) =>
          revisionClaim(claim, importedDocument.id, 'imported'),
        ),
      });
      return completed;
    });
  } catch (error) {
    const failure = safeImportError(error);
    await markUrlImportRowFailed(input.rowId, input.projectId, failure);
    throw failure;
  }
}

export async function reprocessProject(
  projectId: string,
  ownerId: string,
  options: ExtractionOptions = {},
) {
  const project = await prisma.claimweaveProject.findFirst({
    where: { id: projectId, userId: ownerId },
    include: { source: { include: { claims: true } } },
  });
  const currentSource = project?.source;
  if (!currentSource) throw new ClaimweaveError('Project not found.', 404);

  let extraction: NormalizedExtraction;
  try {
    if (currentSource.url) {
      const sourceUrl = currentSource.url;
      const source = await fetchSource(sourceUrl);
      extraction = await extractSourceClaims(
        source.text,
        sourceUrl,
        source.raw,
        { reuseEnabled: true, tenantScope: ownerId, ...options },
        1,
        source.raw.length,
      );
    } else {
      const sourceText = normalizePastedText(
        currentSource.documentText ?? currentSource.normalizedContent ?? '',
      );
      extraction = await extractSourceClaims(sourceText, null, sourceText, {
        reuseEnabled: true,
        tenantScope: ownerId,
        ...options,
      });
    }
  } catch (error) {
    if (error instanceof ClaimweaveError && error.status === 422) {
      throw new ClaimweaveError(error.message, 502);
    }
    throw error;
  }

  const runCreatedAt = new Date();
  try {
    const persisted = await prisma.$transaction(async (tx) => {
      const latestRun = await tx.claimweaveProcessingRun.findFirst({
        where: { projectId },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const version = (latestRun?.version ?? 0) + 1;
      const updatedSource = await tx.claimweaveSource.update({
        where: { id: currentSource.id },
        data: {
          url: extraction.sourceUrl,
          documentText: extraction.sourceUrl ? null : extraction.sourceText,
          normalizedContent: extraction.sourceText,
          extractedAt: extraction.extractedAt,
          status: currentSource.status,
          processingRoute: extraction.processingRoute,
          processingTrace: extraction.processingTrace,
          claims: {
            deleteMany: {},
            create: extraction.claims.map((claim) =>
              claimCreateData(claim, extraction.extractedAt),
            ),
          },
        },
        include: { claims: true },
      });
      await tx.claimweaveProcessingRun.create({
        data: {
          projectId,
          version,
          evidenceState: currentSource.status,
          processingRoute: extraction.processingRoute,
          documentId: updatedSource.id,
          documentKind: 'primary',
          createdAt: runCreatedAt,
          snapshots: {
            create: extraction.claims.map((claim) => snapshotCreateData(claim, runCreatedAt)),
          },
        },
      });
      await createClaimweaveRevision(tx, {
        projectId,
        ownerId,
        eventKind: 'ingestion',
        createdAt: runCreatedAt,
        previousDocuments: [revisionDocument(currentSource, 'primary')],
        currentDocuments: [revisionDocument(updatedSource, 'primary')],
        previousClaims: (currentSource.claims ?? []).map((claim) =>
          revisionClaim(claim, currentSource.id, 'primary'),
        ),
        currentClaims: updatedSource.claims.map((claim) =>
          revisionClaim(claim, updatedSource.id, 'primary'),
        ),
      });
      return updatedSource;
    });
    return projectResult(projectId, persisted, extraction.processingTrace);
  } catch (error) {
    if (error instanceof ClaimweaveError) throw error;
    if (isUniqueConstraintError(error)) {
      throw new ClaimweaveError(
        'This project was reprocessed concurrently. Please try again.',
        502,
      );
    }
    throw new ClaimweaveError('We could not save the reprocessed claims. Please try again.', 500);
  }
}

export async function createProjectFromUrl(
  input: { url: string },
  ownerId?: string,
  options: ExtractionOptions = {},
) {
  const sourceUrl = new URL(input.url).toString();
  const source = await fetchSource(sourceUrl);
  const extraction = await extractSourceClaims(
    source.text,
    sourceUrl,
    source.raw,
    { reuseEnabled: Boolean(ownerId), tenantScope: ownerId, ...options },
    1,
    source.raw.length,
  );
  return persistInitialProject(extraction, ownerId);
}

export async function createProjectFromText(
  input: { text: string },
  ownerId?: string,
  options: ExtractionOptions = {},
) {
  const sourceText = normalizePastedText(input.text);
  const extraction = await extractSourceClaims(sourceText, null, sourceText, {
    reuseEnabled: Boolean(ownerId),
    tenantScope: ownerId,
    ...options,
  });
  return persistInitialProject(extraction, ownerId);
}
