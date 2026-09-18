import 'dotenv/config';

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';

const password = 'Claimweave-e2e-password-123!';
const databaseUrl = process.env.DATABASE_URL;
const prismaCli = 'node_modules/prisma/build/index.js';

function sqlValue(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function executeSql(statement: string) {
  if (!databaseUrl) throw new Error('DATABASE_URL is required for the E2E fixture.');
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [prismaCli, 'db', 'execute', '--url', databaseUrl, '--stdin'],
      {
        stdio: ['pipe', 'ignore', 'pipe'],
      },
    );
    let errorOutput = '';
    child.stderr.on('data', (chunk: Buffer) => {
      errorOutput += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(errorOutput || `Fixture SQL exited with code ${code ?? 'unknown'}.`));
    });
    child.stdin.end(statement);
  });
}

async function signUp(page: Page, email: string) {
  const ipSuffix =
    (Array.from(email).reduce((total, character) => total + character.charCodeAt(0), 0) % 240) + 1;
  await page.context().setExtraHTTPHeaders({
    'x-forwarded-for': `203.0.113.${ipSuffix}`,
    'x-real-ip': `203.0.113.${ipSuffix}`,
  });
  await page.goto('/signup');
  await page.getByLabel('Name').fill('Workspace Fixture');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function createProject(email: string, url: string, createdAt: string) {
  const projectId = `e2e-${randomUUID()}`;
  const sourceId = `e2e-${randomUUID()}`;
  const claimId = `e2e-${randomUUID()}`;
  const tieClaimId = `${claimId}-a-tie`;
  const laterClaimId = `${claimId}-z-later`;
  const normalizedContent = `Readable evidence retained for ${url}.`;
  const processingTrace = {
    state: 'exact-repeat',
    computationLocation: 'trusted-server',
    reuseDecision: 'hit',
    accessCorrectness: 'passed',
    modelCallCount: 0,
    providerUsage: {
      attempts: null,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      costUsd: null,
    },
    latencyMs: 18,
    transferredBytes: 512,
    fallbackReason: null,
  };
  await executeSql(`
    INSERT INTO "ClaimweaveProject" ("id", "createdAt", "userId")
    VALUES (${sqlValue(projectId)}, ${sqlValue(createdAt)}, (SELECT "id" FROM "user" WHERE "email" = ${sqlValue(email)}));
    INSERT INTO "ClaimweaveSource" ("id", "projectId", "url", "normalizedContent", "extractedAt", "status", "processingRoute", "processingTrace")
    VALUES (${sqlValue(sourceId)}, ${sqlValue(projectId)}, ${sqlValue(url)}, ${sqlValue(normalizedContent)}, ${sqlValue(createdAt)}, 'complete', 'trusted-server-reuse', ${sqlValue(JSON.stringify(processingTrace))}::jsonb);
    INSERT INTO "ClaimweaveClaim" ("id", "sourceId", "text", "sourceStart", "sourceEnd", "sourceQuote", "citationLinks", "sourceUrl", "extractedAt")
    VALUES
      (${sqlValue(claimId)}, ${sqlValue(sourceId)}, ${sqlValue(normalizedContent)}, 0, ${String(normalizedContent.length)}, ${sqlValue(normalizedContent)}, jsonb_build_array(${sqlValue(url)}), ${sqlValue(url)}, ${sqlValue(createdAt)}),
      (${sqlValue(tieClaimId)}, ${sqlValue(sourceId)}, 'A tied source-start claim.', 0, 24, 'A tied source-start claim.', jsonb_build_array(${sqlValue(url)}), ${sqlValue(url)}, ${sqlValue(createdAt)}),
      (${sqlValue(laterClaimId)}, ${sqlValue(sourceId)}, 'A later source-start claim.', 40, 66, 'A later source-start claim.', jsonb_build_array(${sqlValue(url)}), ${sqlValue(url)}, ${sqlValue(createdAt)});
  `);
  return { projectId, sourceId, claimId, claimIds: [claimId, tieClaimId, laterClaimId] };
}

async function createHistoryProject(email: string) {
  const projectId = `e2e-history-${randomUUID()}`;
  const sourceId = `e2e-history-source-${randomUUID()}`;
  const unchangedClaimId = `e2e-history-unchanged-${randomUUID()}`;
  const changedClaimId = `e2e-history-changed-${randomUUID()}`;
  const addedClaimId = `e2e-history-added-${randomUUID()}`;
  const firstRunId = `e2e-history-run-1-${randomUUID()}`;
  const secondRunId = `e2e-history-run-2-${randomUUID()}`;
  const previousUnchangedId = `e2e-history-snapshot-unchanged-${randomUUID()}`;
  const previousChangedId = `e2e-history-snapshot-changed-${randomUUID()}`;
  const removedId = `e2e-history-snapshot-removed-${randomUUID()}`;
  const currentUnchangedId = `e2e-history-snapshot-current-unchanged-${randomUUID()}`;
  const currentChangedId = `e2e-history-snapshot-current-changed-${randomUUID()}`;
  const currentAddedId = `e2e-history-snapshot-current-added-${randomUUID()}`;
  const ingestionRevisionId = `e2e-history-revision-ingestion-${randomUUID()}`;
  const verificationRevisionId = `e2e-history-revision-verification-${randomUUID()}`;
  const documentOnlyRevisionId = `e2e-history-revision-document-only-${randomUUID()}`;
  const documentRevisionId = `e2e-history-document-revision-${randomUUID()}`;
  const addedClaimRevisionId = `e2e-history-claim-revision-added-${randomUUID()}`;
  const removedClaimRevisionId = `e2e-history-claim-revision-removed-${randomUUID()}`;
  const changedClaimRevisionId = `e2e-history-claim-revision-changed-${randomUUID()}`;
  const documentOnlySnapshotId = `e2e-history-document-only-snapshot-${randomUUID()}`;
  const evidenceRevisionId = `e2e-history-evidence-revision-${randomUUID()}`;
  const verificationRunId = `e2e-history-verification-run-${randomUUID()}`;
  const verificationResultId = `e2e-history-verification-result-${randomUUID()}`;
  const evidenceDocumentId = `e2e-history-evidence-document-${randomUUID()}`;
  const evidencePassageId = `e2e-history-evidence-passage-${randomUUID()}`;
  const sourceUrl = `https://example.com/history-${projectId}`;
  const firstRunAt = '2026-09-17T12:00:00.000Z';
  const secondRunAt = '2026-09-18T12:00:00.000Z';
  const documentValue = JSON.stringify({
    id: sourceId,
    kind: 'primary',
    url: sourceUrl,
    documentText: null,
    normalizedContent: 'History source text.',
    status: 'complete',
    processingRoute: 'model-fallback',
    processingTrace: null,
    extractedAt: firstRunAt,
  });
  const claimValue = JSON.stringify({
    id: changedClaimId,
    text: 'Changed claim before',
    sourceStart: 20,
    sourceEnd: 36,
    sourceQuote: 'Changed claim before',
    sourceUrl,
    citationLinks: [sourceUrl],
    extractedAt: firstRunAt,
  });
  const currentChangedClaimValue = JSON.stringify({
    id: changedClaimId,
    text: 'Changed claim now',
    sourceStart: 20,
    sourceEnd: 36,
    sourceQuote: 'Changed source passage now.',
    sourceUrl: `${sourceUrl}/changed-current`,
    citationLinks: [`${sourceUrl}/changed-current-citation`],
    extractedAt: secondRunAt,
  });
  const addedClaimValue = JSON.stringify({
    id: addedClaimId,
    text: 'Added claim now',
    sourceStart: 40,
    sourceEnd: 54,
    sourceQuote: 'Added source passage now.',
    sourceUrl: `${sourceUrl}/added-current`,
    citationLinks: [`${sourceUrl}/added-current-citation`],
    extractedAt: secondRunAt,
  });
  const removedClaimValue = JSON.stringify({
    id: `removed-${projectId}`,
    text: 'Removed claim before',
    sourceStart: 60,
    sourceEnd: 73,
    sourceQuote: 'Removed source passage before.',
    sourceUrl: `${sourceUrl}/removed-previous`,
    citationLinks: [`${sourceUrl}/removed-previous-citation`],
    extractedAt: firstRunAt,
  });
  const previousEvidenceValue = JSON.stringify({
    claimId: changedClaimId,
    classification: 'unsupported',
    freshness: 'stale',
    errorState: 'Previous verification expired.',
    excerpts: [
      {
        id: `${evidenceRevisionId}-previous-excerpt`,
        passageId: `${evidencePassageId}-previous`,
        documentId: evidenceDocumentId,
        documentTitle: 'Previous independent evidence',
        role: 'contradicting',
        text: 'Previous evidence excerpt.',
        sourceUrl: `${sourceUrl}/evidence-previous`,
        evidenceDate: firstRunAt,
      },
    ],
  });
  const evidenceValue = JSON.stringify({
    claimId: changedClaimId,
    classification: 'supported',
    freshness: 'fresh',
    errorState: null,
    excerpts: [
      {
        id: `${evidenceRevisionId}-excerpt`,
        passageId: evidencePassageId,
        documentId: evidenceDocumentId,
        documentTitle: 'Independent history evidence',
        role: 'supporting',
        text: 'Current evidence excerpt.',
        sourceUrl: `${sourceUrl}/evidence-current`,
        evidenceDate: secondRunAt,
      },
    ],
  });
  await executeSql(`
    INSERT INTO "ClaimweaveProject" ("id", "createdAt", "userId")
    VALUES (${sqlValue(projectId)}, ${sqlValue(firstRunAt)}, (SELECT "id" FROM "user" WHERE "email" = ${sqlValue(email)}));
    INSERT INTO "ClaimweaveSource" ("id", "projectId", "url", "normalizedContent", "extractedAt", "status")
    VALUES (${sqlValue(sourceId)}, ${sqlValue(projectId)}, ${sqlValue(sourceUrl)}, ${sqlValue('History source text.')}, ${sqlValue(secondRunAt)}, 'complete');
    INSERT INTO "ClaimweaveClaim" ("id", "sourceId", "text", "sourceStart", "sourceEnd", "sourceQuote", "citationLinks", "sourceUrl", "extractedAt")
    VALUES
      (${sqlValue(unchangedClaimId)}, ${sqlValue(sourceId)}, 'Unchanged claim', 0, 16, 'Unchanged claim', jsonb_build_array(${sqlValue(sourceUrl)}), ${sqlValue(sourceUrl)}, ${sqlValue(secondRunAt)}),
      (${sqlValue(changedClaimId)}, ${sqlValue(sourceId)}, 'Changed claim now', 20, 36, 'Changed claim now', jsonb_build_array(${sqlValue(sourceUrl)}), ${sqlValue(sourceUrl)}, ${sqlValue(secondRunAt)}),
      (${sqlValue(addedClaimId)}, ${sqlValue(sourceId)}, 'Added claim now', 40, 54, 'Added claim now', jsonb_build_array(${sqlValue(sourceUrl)}), ${sqlValue(sourceUrl)}, ${sqlValue(secondRunAt)});
    INSERT INTO "ClaimweaveProcessingRun" ("id", "projectId", "version", "evidenceState", "processingRoute", "documentId", "documentKind", "createdAt")
    VALUES
      (${sqlValue(firstRunId)}, ${sqlValue(projectId)}, 1, 'complete', 'model-fallback', ${sqlValue(sourceId)}, 'primary', ${sqlValue(firstRunAt)}),
      (${sqlValue(secondRunId)}, ${sqlValue(projectId)}, 2, 'needs-review', 'trusted-server-reuse', ${sqlValue(sourceId)}, 'primary', ${sqlValue(secondRunAt)});
    INSERT INTO "ClaimweaveClaimSnapshot" ("id", "runId", "text", "sourceStart", "sourceEnd", "sourceQuote", "sourceUrl", "citationLinks", "createdAt")
    VALUES
      (${sqlValue(previousUnchangedId)}, ${sqlValue(firstRunId)}, 'Unchanged claim', 0, 16, 'Unchanged claim', ${sqlValue(sourceUrl)}, jsonb_build_array(${sqlValue(sourceUrl)}), ${sqlValue(firstRunAt)}),
      (${sqlValue(previousChangedId)}, ${sqlValue(firstRunId)}, 'Changed claim before', 20, 36, 'Changed claim before', ${sqlValue(sourceUrl)}, jsonb_build_array(${sqlValue(sourceUrl)}), ${sqlValue(firstRunAt)}),
      (${sqlValue(removedId)}, ${sqlValue(firstRunId)}, 'Removed claim', 60, 73, 'Removed claim', ${sqlValue(sourceUrl)}, jsonb_build_array(${sqlValue(sourceUrl)}), ${sqlValue(firstRunAt)}),
      (${sqlValue(currentUnchangedId)}, ${sqlValue(secondRunId)}, 'Unchanged claim', 0, 16, 'Unchanged claim', ${sqlValue(sourceUrl)}, jsonb_build_array(${sqlValue(sourceUrl)}), ${sqlValue(secondRunAt)}),
      (${sqlValue(currentChangedId)}, ${sqlValue(secondRunId)}, 'Changed claim now', 20, 36, 'Changed claim now', ${sqlValue(sourceUrl)}, jsonb_build_array(${sqlValue(sourceUrl)}), ${sqlValue(secondRunAt)}),
      (${sqlValue(currentAddedId)}, ${sqlValue(secondRunId)}, 'Added claim now', 40, 54, 'Added claim now', ${sqlValue(sourceUrl)}, jsonb_build_array(${sqlValue(sourceUrl)}), ${sqlValue(secondRunAt)});
    INSERT INTO "ClaimweaveRevision" ("id", "projectId", "ownerId", "version", "eventKind", "createdAt")
    VALUES
      (${sqlValue(ingestionRevisionId)}, ${sqlValue(projectId)}, (SELECT "id" FROM "user" WHERE "email" = ${sqlValue(email)}), 1, 'ingestion', ${sqlValue(firstRunAt)}),
      (${sqlValue(verificationRevisionId)}, ${sqlValue(projectId)}, (SELECT "id" FROM "user" WHERE "email" = ${sqlValue(email)}), 2, 'verification', ${sqlValue(secondRunAt)}),
      (${sqlValue(documentOnlyRevisionId)}, ${sqlValue(projectId)}, (SELECT "id" FROM "user" WHERE "email" = ${sqlValue(email)}), 3, 'ingestion', ${sqlValue(secondRunAt)});
    INSERT INTO "ClaimweaveDocumentRevisionSnapshot" ("id", "revisionId", "documentId", "documentKind", "url", "status", "processingRoute", "extractedAt", "current", "createdAt")
    VALUES (${sqlValue(documentRevisionId)}, ${sqlValue(ingestionRevisionId)}, ${sqlValue(sourceId)}, 'primary', ${sqlValue(sourceUrl)}, 'complete', 'model-fallback', ${sqlValue(firstRunAt)}, ${sqlValue(documentValue)}::jsonb, ${sqlValue(firstRunAt)});
    INSERT INTO "ClaimweaveClaimRevisionSnapshot" ("id", "revisionId", "sourceDocumentId", "documentKind", "identityKey", "previousClaimId", "currentClaimId", "sourceStart", "sourceEnd", "previous", "current", "createdAt")
    VALUES
      (${sqlValue(addedClaimRevisionId)}, ${sqlValue(ingestionRevisionId)}, ${sqlValue(sourceId)}, 'primary', ${sqlValue(`primary:${sourceId}:40:54`)}, NULL, ${sqlValue(addedClaimId)}, 40, 54, NULL, ${sqlValue(addedClaimValue)}::jsonb, ${sqlValue(firstRunAt)}),
      (${sqlValue(removedClaimRevisionId)}, ${sqlValue(ingestionRevisionId)}, ${sqlValue(sourceId)}, 'primary', ${sqlValue(`primary:${sourceId}:60:73`)}, ${sqlValue(`removed-${projectId}`)}, NULL, 60, 73, ${sqlValue(removedClaimValue)}::jsonb, NULL, ${sqlValue(firstRunAt)}),
      (${sqlValue(changedClaimRevisionId)}, ${sqlValue(ingestionRevisionId)}, ${sqlValue(sourceId)}, 'primary', ${sqlValue(`primary:${sourceId}:20:36`)}, ${sqlValue(changedClaimId)}, ${sqlValue(changedClaimId)}, 20, 36, ${sqlValue(claimValue)}::jsonb, ${sqlValue(currentChangedClaimValue)}::jsonb, ${sqlValue(firstRunAt)});
    INSERT INTO "ClaimweaveEvidenceRevisionSnapshot" ("id", "revisionId", "claimId", "verificationRunId", "verificationResultId", "evidenceDocumentId", "passageId", "identityKey", "sourceUrl", "evidenceDate", "classification", "freshness", "errorState", "previous", "current", "createdAt")
    VALUES (${sqlValue(evidenceRevisionId)}, ${sqlValue(verificationRevisionId)}, ${sqlValue(changedClaimId)}, ${sqlValue(verificationRunId)}, ${sqlValue(verificationResultId)}, ${sqlValue(evidenceDocumentId)}, ${sqlValue(evidencePassageId)}, ${sqlValue(`${changedClaimId}:${evidenceDocumentId}:${evidencePassageId}:supporting`)}, ${sqlValue(`${sourceUrl}/evidence-current`)}, ${sqlValue(secondRunAt)}, 'supported', 'fresh', NULL, ${sqlValue(previousEvidenceValue)}::jsonb, ${sqlValue(evidenceValue)}::jsonb, ${sqlValue(secondRunAt)});
    INSERT INTO "ClaimweaveDocumentRevisionSnapshot" ("id", "revisionId", "documentId", "documentKind", "url", "status", "processingRoute", "extractedAt", "previous", "current", "createdAt")
    VALUES (${sqlValue(documentOnlySnapshotId)}, ${sqlValue(documentOnlyRevisionId)}, ${sqlValue(sourceId)}, 'primary', ${sqlValue(`${sourceUrl}/document-current`)}, 'complete', 'trusted-server-reuse', ${sqlValue(secondRunAt)}, ${sqlValue(documentValue)}::jsonb, ${sqlValue(JSON.stringify({ ...JSON.parse(documentValue), url: `${sourceUrl}/document-current`, normalizedContent: 'Current document-only text.', extractedAt: secondRunAt }))}::jsonb, ${sqlValue(secondRunAt)});
  `);
  return { projectId, addedClaimId, changedClaimId, sourceId, sourceUrl };
}

async function createLegacyProject(url: string) {
  const projectId = `e2e-${randomUUID()}`;
  const sourceId = `e2e-${randomUUID()}`;
  await executeSql(`
    INSERT INTO "ClaimweaveProject" ("id", "createdAt")
    VALUES (${sqlValue(projectId)}, '2026-09-16T12:00:00.000Z');
    INSERT INTO "ClaimweaveSource" ("id", "projectId", "url", "extractedAt", "status")
    VALUES (${sqlValue(sourceId)}, ${sqlValue(projectId)}, ${sqlValue(url)}, '2026-09-16T12:00:00.000Z', 'complete');
  `);
  return { projectId, sourceId };
}

async function createOwnedLegacyProject(email: string, url: string) {
  const projectId = `e2e-${randomUUID()}`;
  const sourceId = `e2e-${randomUUID()}`;
  const claimId = `e2e-${randomUUID()}`;
  const text = 'Legacy claims remain available without route metadata.';
  await executeSql(`
    INSERT INTO "ClaimweaveProject" ("id", "createdAt", "userId")
    VALUES (${sqlValue(projectId)}, '2026-09-16T12:00:00.000Z', (SELECT "id" FROM "user" WHERE "email" = ${sqlValue(email)}));
    INSERT INTO "ClaimweaveSource" ("id", "projectId", "url", "normalizedContent", "extractedAt", "status")
    VALUES (${sqlValue(sourceId)}, ${sqlValue(projectId)}, ${sqlValue(url)}, ${sqlValue(text)}, '2026-09-16T12:00:00.000Z', 'complete');
    INSERT INTO "ClaimweaveClaim" ("id", "sourceId", "text", "sourceStart", "sourceEnd", "sourceQuote", "citationLinks", "sourceUrl", "extractedAt")
    VALUES (${sqlValue(claimId)}, ${sqlValue(sourceId)}, ${sqlValue(text)}, 0, ${String(text.length)}, ${sqlValue(text)}, jsonb_build_array(${sqlValue(url)}), ${sqlValue(url)}, '2026-09-16T12:00:00.000Z');
  `);
  return { projectId, sourceId, claimId };
}

async function assertPersistedUrlProject(url: string, email: string) {
  await executeSql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM "ClaimweaveSource" AS source
        JOIN "ClaimweaveProject" AS project ON project."id" = source."projectId"
        JOIN "user" AS account ON account."id" = project."userId"
        WHERE source."url" = ${sqlValue(url)}
          AND source."normalizedContent" IS NOT NULL
          AND length(source."normalizedContent") > 0
          AND source."extractedAt" IS NOT NULL
          AND account."email" = ${sqlValue(email)}
      ) THEN
        RAISE EXCEPTION 'URL document was not persisted for its owner';
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM "ClaimweaveSource" AS source
        JOIN "ClaimweaveClaim" AS claim ON claim."sourceId" = source."id"
        WHERE source."url" = ${sqlValue(url)}
          AND claim."sourceUrl" = ${sqlValue(url)}
          AND claim."sourceEnd" > claim."sourceStart"
          AND claim."citationLinks" <> '[]'::jsonb
      ) THEN
        RAISE EXCEPTION 'URL claims were not linked to their document';
      END IF;
    END $$;
  `);
}

async function assertPersistedProcessingTrace(url: string) {
  await executeSql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM "ClaimweaveSource"
        WHERE "url" = ${sqlValue(url)}
          AND "processingRoute" = 'trusted-server-reuse'
          AND "processingTrace"->>'computationLocation' = 'trusted-server'
          AND "processingTrace"->>'latencyMs' = '18'
      ) THEN
        RAISE EXCEPTION 'processing trace was not persisted for the known route';
      END IF;
    END $$;
  `);
}

async function assertPersistedTextProject(text: string, email: string) {
  const quote = `${text.split('. ')[0]}.`;
  await executeSql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM "ClaimweaveSource" AS source
        JOIN "ClaimweaveProject" AS project ON project."id" = source."projectId"
        JOIN "user" AS account ON account."id" = project."userId"
        WHERE source."documentText" = ${sqlValue(text)}
          AND source."normalizedContent" = ${sqlValue(text)}
          AND source."extractedAt" IS NOT NULL
          AND account."email" = ${sqlValue(email)}
          AND source."url" IS NULL
      ) THEN
        RAISE EXCEPTION 'text source was not persisted for its owner';
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM "ClaimweaveSource" AS source
        JOIN "ClaimweaveClaim" AS claim ON claim."sourceId" = source."id"
        WHERE source."documentText" = ${sqlValue(text)}
          AND claim."sourceUrl" IS NULL
          AND claim."citationLinks" = '[]'::jsonb
          AND claim."sourceStart" = 0
          AND claim."sourceEnd" = ${String(quote.length)}
          AND claim."sourceQuote" = ${sqlValue(quote)}
      ) THEN
        RAISE EXCEPTION 'text claim evidence was not persisted exactly';
      END IF;
    END $$;
  `);
}

type SnapshotRecord = {
  text: string;
  sourceQuote: string;
  sourceStart: number;
  sourceEnd: number;
  sourceUrl: string | null;
  citationLinks: unknown;
  createdAt: string;
};

type ProcessingRunRecord = {
  version: number;
  documentId: string | null;
  documentKind: string | null;
  evidenceState: string;
  createdAt: string;
  snapshots: SnapshotRecord[];
};

type ProjectRecord = {
  source: { claims: Array<{ text: string }> } | null;
} | null;

type RetryState = {
  ownerEmail: string | null;
  processingRuns: number;
  project: {
    userId: string | null;
    source: {
      url: string | null;
      normalizedContent: string | null;
      status: string;
      processingError: string | null;
      claims: Array<{
        sourceStart: number;
        sourceEnd: number;
        sourceQuote: string;
        sourceUrl: string | null;
        citationLinks: unknown;
      }>;
    } | null;
  } | null;
};

async function readProcessingState(projectId: string) {
  if (!databaseUrl) throw new Error('DATABASE_URL is required for the E2E fixture.');
  const script = `
    import { PrismaClient } from '@prisma/client';
    const prisma = new PrismaClient();
    try {
      const runs = await prisma.claimweaveProcessingRun.findMany({
        where: { projectId: process.env.CLAIMWEAVE_E2E_PROJECT_ID },
        orderBy: { version: 'asc' },
        include: { snapshots: true },
      });
      const project = await prisma.claimweaveProject.findUnique({
        where: { id: process.env.CLAIMWEAVE_E2E_PROJECT_ID },
        include: { source: { include: { claims: true } } },
      });
      const revisions = await prisma.claimweaveRevision.findMany({
        where: { projectId: process.env.CLAIMWEAVE_E2E_PROJECT_ID },
        orderBy: { version: 'asc' },
        include: {
          documentSnapshots: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
          claimSnapshots: {
            orderBy: [{ sourceStart: 'asc' }, { sourceEnd: 'asc' }, { id: 'asc' }],
          },
          evidenceSnapshots: { orderBy: [{ claimId: 'asc' }, { identityKey: 'asc' }, { id: 'asc' }] },
        },
      });
      process.stdout.write(JSON.stringify({ runs, project, revisions }));
    } finally {
      await prisma.$disconnect();
    }
  `;
  return new Promise<{
    runs: ProcessingRunRecord[];
    project: ProjectRecord;
    revisions: Array<{
      id: string;
      version: number;
      projectId: string;
      eventKind: string;
      createdAt: string;
      documentSnapshots: Array<{ documentId: string; documentKind: string; current: unknown }>;
      claimSnapshots: Array<{ sourceDocumentId: string; current: unknown }>;
      evidenceSnapshots: Array<{
        claimId: string;
        verificationRunId: string;
        current: unknown;
      }>;
    }>;
  }>((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, CLAIMWEAVE_E2E_PROJECT_ID: projectId },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let errorOutput = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      errorOutput += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(errorOutput || `Database query exited with code ${code ?? 'unknown'}.`));
        return;
      }
      resolve(
        JSON.parse(output) as {
          runs: ProcessingRunRecord[];
          project: ProjectRecord;
          revisions: Array<{
            id: string;
            version: number;
            projectId: string;
            eventKind: string;
            createdAt: string;
            documentSnapshots: Array<{
              documentId: string;
              documentKind: string;
              current: unknown;
            }>;
            claimSnapshots: Array<{ sourceDocumentId: string; current: unknown }>;
            evidenceSnapshots: Array<{
              claimId: string;
              verificationRunId: string;
              current: unknown;
            }>;
          }>;
        },
      );
    });
  });
}

async function readRetryState(projectId: string) {
  if (!databaseUrl) throw new Error('DATABASE_URL is required for the E2E fixture.');
  const script = `
    import { PrismaClient } from '@prisma/client';
    const prisma = new PrismaClient();
    try {
      const project = await prisma.claimweaveProject.findUnique({
        where: { id: process.env.CLAIMWEAVE_E2E_PROJECT_ID },
        include: { source: { include: { claims: true } } },
      });
      const owner = project?.userId
        ? await prisma.user.findUnique({
            where: { id: project.userId },
            select: { email: true },
          })
        : null;
      const processingRuns = await prisma.claimweaveProcessingRun.count({
        where: { projectId: process.env.CLAIMWEAVE_E2E_PROJECT_ID },
      });
      process.stdout.write(JSON.stringify({
        ownerEmail: owner?.email ?? null,
        processingRuns,
        project,
      }));
    } finally {
      await prisma.$disconnect();
    }
  `;
  return new Promise<RetryState>((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, CLAIMWEAVE_E2E_PROJECT_ID: projectId },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let errorOutput = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      errorOutput += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(errorOutput || `Database query exited with code ${code ?? 'unknown'}.`));
        return;
      }
      resolve(JSON.parse(output) as RetryState);
    });
  });
}

test('owned projects are visible at the real route and navigable', async ({
  page,
  browser,
}, testInfo) => {
  const suffix = `${Date.now()}-${testInfo.project.name}`;
  const userAEmail = `workspace-a-${suffix}@example.com`;
  const userBEmail = `workspace-b-${suffix}@example.com`;
  const ownedUrl = `https://example.com/owned-${suffix}`;
  const otherUrl = `https://example.com/other-${suffix}`;
  const legacyUrl = `https://example.com/legacy-${suffix}`;
  const ownerlessUrl = `https://example.com/ownerless-${suffix}`;
  const otherContext = await browser.newContext(testInfo.project.use);
  const otherPage = await otherContext.newPage();

  try {
    await signUp(page, userAEmail);
    await signUp(otherPage, userBEmail);
    const ownedProject = await createProject(userAEmail, ownedUrl, '2026-09-17T12:00:00.000Z');
    const otherProject = await createProject(userBEmail, otherUrl, '2026-09-16T12:00:00.000Z');
    const legacyProject = await createOwnedLegacyProject(userAEmail, legacyUrl);
    const ownerlessProject = await createLegacyProject(ownerlessUrl);
    await assertPersistedUrlProject(ownedUrl, userAEmail);
    await assertPersistedProcessingTrace(ownedUrl);

    const ownedClaimsResponse = await page.request.get(
      `/api/projects/${ownedProject.projectId}/claims`,
    );
    expect(ownedClaimsResponse.ok()).toBe(true);
    const ownedClaims = (await ownedClaimsResponse.json()) as {
      documentId: string;
      sourceType: string;
      sourceUrl: string;
      normalizedContentLength: number | null;
      processingRoute: string | null;
      processingTrace: {
        computationLocation: string;
        modelCallCount: number | null;
        latencyMs: number | null;
        transferredBytes: number | null;
        providerUsage: { inputTokens: number | null; costUsd: number | null };
      } | null;
      pagination: {
        page: number;
        pageSize: number;
        total: number;
        totalPages: number;
        hasNextPage: boolean;
        hasPreviousPage: boolean;
      };
      claims: Array<{
        id: string;
        text: string;
        sourcePassage: string;
        sourceUrl: string | null;
        extractedAt: string;
        citationLinks: string[];
        evidenceExcerpts: unknown[];
        verificationStatus: string | null;
      }>;
    };
    expect(ownedClaims.documentId).toBe(ownedProject.sourceId);
    expect(ownedClaims.sourceType).toBe('url');
    expect(ownedClaims.sourceUrl).toBe(ownedUrl);
    expect(ownedClaims.normalizedContentLength).toBeGreaterThan(0);
    expect(ownedClaims.processingRoute).toBe('trusted-server-reuse');
    expect(ownedClaims.processingTrace).toMatchObject({
      computationLocation: 'trusted-server',
      modelCallCount: 0,
      latencyMs: 18,
      transferredBytes: 512,
      providerUsage: { inputTokens: null, costUsd: null },
    });
    expect(ownedClaims.pagination).toEqual({
      page: 1,
      pageSize: 50,
      total: 3,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    });
    expect(ownedClaims.claims.map((claim) => claim.id)).toEqual(ownedProject.claimIds);
    expect(ownedClaims.claims[0]).toMatchObject({
      text: ownedClaims.claims[0]?.sourcePassage,
      sourceUrl: ownedUrl,
      extractedAt: '2026-09-17T12:00:00.000Z',
      citationLinks: [ownedUrl],
      evidenceExcerpts: [],
      verificationStatus: null,
    });

    const pagedClaimsResponse = await page.request.get(
      `/api/projects/${ownedProject.projectId}/claims?page=2&pageSize=2`,
    );
    expect(pagedClaimsResponse.ok()).toBe(true);
    const pagedClaims = (await pagedClaimsResponse.json()) as {
      pagination: {
        page: number;
        pageSize: number;
        total: number;
        totalPages: number;
        hasNextPage: boolean;
        hasPreviousPage: boolean;
      };
      claims: Array<{ id: string; sourceUrl: string | null; citationLinks: string[] }>;
    };
    expect(pagedClaims.pagination).toEqual({
      page: 2,
      pageSize: 2,
      total: 3,
      totalPages: 2,
      hasNextPage: false,
      hasPreviousPage: true,
    });
    expect(pagedClaims.claims.map((claim) => claim.id)).toEqual([ownedProject.claimIds[2]]);
    expect(pagedClaims.claims[0]).toMatchObject({
      sourceUrl: ownedUrl,
      citationLinks: [ownedUrl],
    });

    const emptyPageResponse = await page.request.get(
      `/api/projects/${ownedProject.projectId}/claims?page=3&pageSize=2`,
    );
    expect(emptyPageResponse.ok()).toBe(true);
    const emptyPage = (await emptyPageResponse.json()) as {
      pagination: {
        page: number;
        pageSize: number;
        total: number;
        totalPages: number;
        hasNextPage: boolean;
        hasPreviousPage: boolean;
      };
      claims: unknown[];
    };
    expect(emptyPage.pagination).toEqual({
      page: 3,
      pageSize: 2,
      total: 3,
      totalPages: 2,
      hasNextPage: false,
      hasPreviousPage: true,
    });
    expect(emptyPage.claims).toEqual([]);

    const crossUserClaimsResponse = await otherPage.request.get(
      `/api/projects/${ownedProject.projectId}/claims`,
    );
    expect(crossUserClaimsResponse.status()).toBe(404);
    const crossUserReprocessResponse = await otherPage.request.post(
      `/api/projects/${ownedProject.projectId}/reprocess`,
    );
    expect(crossUserReprocessResponse.status()).toBe(404);
    const otherOwnedClaimsResponse = await otherPage.request.get(
      `/api/projects/${otherProject.projectId}/claims`,
    );
    expect(otherOwnedClaimsResponse.ok()).toBe(true);
    const legacyClaimsResponse = await page.request.get(
      `/api/projects/${legacyProject.projectId}/claims`,
    );
    expect(legacyClaimsResponse.ok()).toBe(true);
    const legacyClaims = (await legacyClaimsResponse.json()) as {
      processingRoute: string | null;
      processingTrace: unknown;
      claims: unknown[];
    };
    expect(legacyClaims.processingRoute).toBeNull();
    expect(legacyClaims.processingTrace).toBeNull();
    expect(legacyClaims.claims).toHaveLength(1);
    const crossUserLegacyResponse = await otherPage.request.get(
      `/api/projects/${legacyProject.projectId}/claims`,
    );
    expect(crossUserLegacyResponse.status()).toBe(404);
    const ownerlessClaimsResponse = await page.request.get(
      `/api/projects/${ownerlessProject.projectId}/claims`,
    );
    expect(ownerlessClaimsResponse.status()).toBe(404);
    await expect(ownerlessClaimsResponse.json()).resolves.toEqual({ error: 'Project not found.' });

    await page.goto('/projects');
    await expect(
      page.getByRole('heading', { name: 'Your projects, ready to reopen.' }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: ownedUrl })).toBeVisible();
    await expect(page.getByText('Created').first()).toBeVisible();
    await expect(page.getByText('Complete').first()).toBeVisible();
    await expect(page.getByRole('link', { name: otherUrl })).toHaveCount(0);
    await expect(page.getByRole('link', { name: ownerlessUrl })).toHaveCount(0);

    await page.getByRole('link', { name: 'Open claims' }).first().click();
    await expect(page).toHaveURL(/\/projects\/[^/]+$/);
    await expect(
      page.getByRole('heading', { name: 'Atomic claims, with receipts.' }),
    ).toBeVisible();
    await expect(page.getByText('Document ID', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Public URL', { exact: true })).toBeVisible();
    await expect(page.getByText(/characters saved$/)).toBeVisible();
    const ownedClaim = page.locator(`#claim-${ownedProject.claimId}`);
    await expect(ownedClaim.getByText('Source passage', { exact: true })).toBeVisible();
    await expect(ownedClaim.getByRole('link', { name: `Source URL: ${ownedUrl}` })).toHaveAttribute(
      'href',
      ownedUrl,
    );
    await expect(
      ownedClaim.getByRole('link', { name: `Citation link: ${ownedUrl}` }),
    ).toHaveAttribute('href', expect.stringContaining(`${ownedUrl}#:~:text=`));
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true);
    await page.goBack();
    await expect(
      page.getByRole('heading', { name: 'Your projects, ready to reopen.' }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'New project' }).click();
    await expect(page).toHaveURL(/\/projects\/new$/);
    const demoUrl = 'https://www.rfc-editor.org/rfc/rfc9110.txt';
    await page.getByLabel('Source URL').fill(demoUrl);
    await page.getByRole('button', { name: 'Extract claims' }).click();
    await expect(page).toHaveURL(/\/projects\/[^/]+$/);
    await expect(page.getByText('Document ID', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Public URL', { exact: true })).toBeVisible();
    await expect(page.getByText(demoUrl, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/characters saved$/)).toBeVisible();
    await assertPersistedUrlProject(demoUrl, userAEmail);
  } finally {
    await otherContext.close();
  }
});

test('unauthorized and empty workspace states are explicit', async ({ page }) => {
  const anonymousClaimsResponse = await page.request.get('/api/projects/unknown/claims');
  expect(anonymousClaimsResponse.status()).toBe(401);
  await expect(anonymousClaimsResponse.json()).resolves.toEqual({ error: 'Unauthorized' });

  await page.goto('/projects/unknown/history');
  await expect(page.getByRole('heading', { name: 'Sign in to view this history.' })).toBeVisible();
  await expect(page.getByRole('main').getByRole('link', { name: 'Sign in' })).toHaveAttribute(
    'href',
    '/login?returnTo=%2Fprojects%2Funknown%2Fhistory',
  );

  await page.goto('/projects');
  await expect(page.getByText('Sign in to see your projects.', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in to continue' })).toHaveAttribute(
    'href',
    '/login?returnTo=%2Fprojects',
  );

  const email = `workspace-empty-${Date.now()}@example.com`;
  await signUp(page, email);
  await page.goto('/projects/unknown/history');
  await expect(page.getByRole('heading', { name: 'Project history not found.' })).toBeVisible();
  await page.goto('/projects');
  await expect(page.getByRole('heading', { name: 'No saved projects yet.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Start your first project' })).toHaveAttribute(
    'href',
    '/projects/new',
  );
});

test('owned processing history compares real persisted runs and links to current claims', async ({
  page,
  browser,
}, testInfo) => {
  const suffix = `${Date.now()}-${testInfo.project.name}`;
  const ownerEmail = `history-owner-${suffix}@example.com`;
  const otherEmail = `history-other-${suffix}@example.com`;
  const otherContext = await browser.newContext(testInfo.project.use);
  const otherPage = await otherContext.newPage();

  try {
    await expect((await page.request.get('/api/projects/unknown/history')).status()).toBe(401);
    await signUp(page, ownerEmail);
    await signUp(otherPage, otherEmail);
    const historyProject = await createHistoryProject(ownerEmail);

    const state = await readProcessingState(historyProject.projectId);
    expect(state.runs.map((run) => run.version)).toEqual([1, 2]);
    expect(state.runs.map((run) => run.documentId)).toEqual([
      historyProject.sourceId,
      historyProject.sourceId,
    ]);
    expect(state.runs.map((run) => run.documentKind)).toEqual(['primary', 'primary']);
    expect(state.runs[0]?.evidenceState).toBe('complete');
    expect(state.runs[1]?.evidenceState).toBe('needs-review');
    expect(state.runs[0]?.snapshots).toHaveLength(3);
    expect(state.runs[1]?.snapshots).toHaveLength(3);
    expect(state.revisions.map((revision) => revision.version)).toEqual([1, 2, 3]);
    expect(state.revisions.map((revision) => revision.eventKind)).toEqual([
      'ingestion',
      'verification',
      'ingestion',
    ]);
    expect(state.revisions[0]).toMatchObject({
      projectId: historyProject.projectId,
      createdAt: '2026-09-17T12:00:00.000Z',
      documentSnapshots: [{ documentId: historyProject.sourceId, documentKind: 'primary' }],
      claimSnapshots: [
        { sourceDocumentId: historyProject.sourceId, current: { text: 'Changed claim now' } },
        { sourceDocumentId: historyProject.sourceId, current: { text: 'Added claim now' } },
        { sourceDocumentId: historyProject.sourceId, current: null },
      ],
    });
    expect(state.revisions[1]).toMatchObject({
      createdAt: '2026-09-18T12:00:00.000Z',
      evidenceSnapshots: [
        {
          claimId: historyProject.changedClaimId,
          previous: expect.objectContaining({
            classification: 'unsupported',
            freshness: 'stale',
            excerpts: [expect.objectContaining({ text: 'Previous evidence excerpt.' })],
          }),
          current: expect.objectContaining({
            classification: 'supported',
            freshness: 'fresh',
            excerpts: [expect.objectContaining({ text: 'Current evidence excerpt.' })],
          }),
        },
      ],
    });
    expect(state.revisions[2]).toMatchObject({
      documentSnapshots: [{ documentId: historyProject.sourceId }],
      claimSnapshots: [],
      evidenceSnapshots: [],
    });
    expect(state.project?.source?.claims.map((claim) => claim.text)).toEqual([
      'Unchanged claim',
      'Changed claim now',
      'Added claim now',
    ]);

    const ownerResponse = await page.request.get(
      `/api/projects/${historyProject.projectId}/history`,
    );
    expect(ownerResponse.ok()).toBe(true);
    const ownerBody = (await ownerResponse.json()) as {
      versions: Array<{
        version: number;
        createdAt: string;
        claimCount: number;
        documentId: string | null;
        documentKind: string | null;
      }>;
      comparison: { added: unknown[]; removed: unknown[]; changed: unknown[] };
      revisions: Array<{
        version: number;
        eventKind: string;
        createdAt: string;
        documents: Array<{ documentId: string }>;
        claims: Array<{ previous: unknown; current: unknown }>;
        evidence: Array<{ previous: unknown; current: unknown }>;
      }>;
    };
    expect(ownerBody.versions.map((version) => version.version)).toEqual([1, 2]);
    expect(ownerBody.versions.map((version) => version.createdAt)).toEqual([
      '2026-09-17T12:00:00.000Z',
      '2026-09-18T12:00:00.000Z',
    ]);
    expect(ownerBody.versions.map((version) => version.claimCount)).toEqual([3, 3]);
    expect(ownerBody.versions.map((version) => version.documentId)).toEqual([
      historyProject.sourceId,
      historyProject.sourceId,
    ]);
    expect(ownerBody.versions.map((version) => version.documentKind)).toEqual([
      'primary',
      'primary',
    ]);
    expect(ownerBody.revisions.map((revision) => revision.version)).toEqual([1, 2, 3]);
    expect(ownerBody.revisions.map((revision) => revision.eventKind)).toEqual([
      'ingestion',
      'verification',
      'ingestion',
    ]);
    expect(ownerBody.revisions.map((revision) => revision.createdAt)).toEqual([
      '2026-09-17T12:00:00.000Z',
      '2026-09-18T12:00:00.000Z',
      '2026-09-18T12:00:00.000Z',
    ]);
    expect(ownerBody.revisions[0]).toMatchObject({
      documents: [{ documentId: historyProject.sourceId }],
      claims: [
        {
          previous: {
            text: 'Changed claim before',
            sourceQuote: 'Changed claim before',
            sourceUrl: historyProject.sourceUrl,
          },
          current: {
            text: 'Changed claim now',
            sourceQuote: 'Changed source passage now.',
            sourceUrl: expect.stringContaining('/changed-current'),
            citationLinks: [expect.stringContaining('/changed-current-citation')],
          },
        },
        {
          previous: null,
          current: {
            text: 'Added claim now',
            sourceQuote: 'Added source passage now.',
            sourceUrl: expect.stringContaining('/added-current'),
            citationLinks: [expect.stringContaining('/added-current-citation')],
          },
        },
        {
          previous: {
            text: 'Removed claim before',
            sourceQuote: 'Removed source passage before.',
            sourceUrl: expect.stringContaining('/removed-previous'),
            citationLinks: [expect.stringContaining('/removed-previous-citation')],
          },
          current: null,
        },
      ],
      evidence: [],
    });
    expect(ownerBody.revisions[1]).toMatchObject({
      documents: [],
      claims: [],
      evidence: [
        {
          claimId: historyProject.changedClaimId,
          previous: {
            classification: 'unsupported',
            freshness: 'stale',
            excerpts: [{ text: 'Previous evidence excerpt.' }],
          },
          current: {
            classification: 'supported',
            freshness: 'fresh',
            excerpts: [{ text: 'Current evidence excerpt.' }],
          },
        },
      ],
    });
    expect(ownerBody.revisions[2]).toMatchObject({
      documents: [{ documentId: historyProject.sourceId }],
      claims: [],
      evidence: [],
    });
    expect(ownerBody.comparison).toMatchObject({
      added: [{ current: { text: 'Added claim now' } }],
      removed: [{ previous: { text: 'Removed claim' }, currentClaimHref: null }],
      changed: [
        { previous: { text: 'Changed claim before' }, current: { text: 'Changed claim now' } },
      ],
    });
    expect(
      (await otherPage.request.get(`/api/projects/${historyProject.projectId}/history`)).status(),
    ).toBe(404);

    await page.goto(`/projects/${historyProject.projectId}/history`);
    await expect(page.getByRole('heading', { name: 'Saved processing versions' })).toBeVisible();
    await expect(page.getByText('Version 1', { exact: true })).toBeVisible();
    await expect(page.getByText('Version 2', { exact: true })).toBeVisible();
    await expect(page.getByText(historyProject.sourceId, { exact: true }).first()).toBeVisible();
    await expect(page.getByText('primary', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Added claims' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Removed claims' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Changed claims' })).toBeVisible();
    await expect(page.getByText('Changed claim before', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Changed claim now', { exact: true }).first()).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Revision 1 .*ingestion change set/ }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Revision 2 .*verification change set/ }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Revision 1/ }).getByText('1 document', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Revision 1/ }).getByText('3 claims', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Revision 2/ }).getByText('1 evidence', { exact: true }),
    ).toBeVisible();
    await expect(
      page
        .locator('#selected-revision-panel')
        .getByText(historyProject.sourceId, { exact: true })
        .first(),
    ).toBeVisible();
    await expect(page.locator('time[dateTime="2026-09-17T12:00:00.000Z"]').first()).toBeVisible();
    await expect(page.locator('time[dateTime="2026-09-18T12:00:00.000Z"]').first()).toBeVisible();
    await expect(page.getByText('No claim changes in this document-only revision.')).toBeVisible();
    await expect(page.getByText('Current document-only text.')).toBeVisible();
    await page.getByRole('button', { name: /Revision 1/ }).click();
    await expect(page.getByText('Added', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Removed', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Changed', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/Added source passage now\./)).toBeVisible();
    await expect(page.getByText(/Removed source passage before\./)).toBeVisible();
    await expect(page.getByText(/Changed source passage now\./)).toBeVisible();
    await expect(
      page.getByRole('link', { name: /Citation URL: .*added-current-citation/ }),
    ).toHaveAttribute('target', '_blank');
    await expect(page.getByRole('button', { name: /Revision 2/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await page.getByRole('button', { name: /Revision 2/ }).click();
    await expect(page.getByText('Previous verification expired.')).toBeVisible();
    await expect(page.getByText('Previous evidence excerpt.')).toBeVisible();
    await expect(page.getByText('Current evidence excerpt.')).toBeVisible();
    await expect(page.getByText('unsupported', { exact: true })).toBeVisible();
    await expect(page.getByText('supported', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('link', { name: /Evidence excerpt URL: .*evidence-current/ }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true);

    await page.getByRole('link', { name: 'Jump to current claim' }).first().click();
    await expect(page).toHaveURL(new RegExp(`#claim-${historyProject.addedClaimId}$`));
    await expect(page.getByText('Added claim now', { exact: true }).first()).toBeVisible();
  } finally {
    await otherContext.close();
  }
});

test('processing history loading and failure states are actionable', async ({ page }, testInfo) => {
  const suffix = `${Date.now()}-${testInfo.project.name}`;
  const email = `history-states-${suffix}@example.com`;

  await signUp(page, email);
  const historyProject = await createHistoryProject(email);
  const historyApiPattern = `**/api/projects/${historyProject.projectId}/history`;
  await page.route(historyApiPattern, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 750));
    await route.continue();
  });
  const navigation = page.goto(`/projects/${historyProject.projectId}/history`);
  await expect(page.getByText(/Loading processing history/)).toBeVisible();
  await navigation;
  await expect(page.getByRole('heading', { name: 'Saved processing versions' })).toBeVisible();
  await page.unroute(historyApiPattern);

  let failureCount = 0;
  await page.route(historyApiPattern, async (route) => {
    failureCount += 1;
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Could not load project history.' }),
    });
  });
  await page.goto(`/projects/${historyProject.projectId}/history`);
  await expect(
    page.getByRole('heading', { name: 'History is temporarily unavailable.' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to claims' })).toHaveAttribute(
    'href',
    `/projects/${historyProject.projectId}`,
  );
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect.poll(() => failureCount).toBe(2);
  await expect(
    page.getByRole('heading', { name: 'History is temporarily unavailable.' }),
  ).toBeVisible();
});

test('failed URL extraction recovers through retry and persists atomic claims', async ({
  page,
}, testInfo) => {
  const suffix = `${Date.now()}-${testInfo.project.name}`;
  const email = `workspace-retry-${suffix}@example.com`;
  const retryUrl = `https://example.com/retry-${suffix}`;
  const sourceQuote = 'Fixture source retry contains enough readable evidence for extraction.';

  await signUp(page, email);
  await page.goto('/projects/new');
  await page.getByLabel('Source URL').fill(retryUrl);
  await page.getByRole('button', { name: 'Extract claims' }).click();

  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  await expect(
    page.getByRole('main').getByText('This source needs another pass.', { exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('main').getByRole('alert')).toContainText('source could not be read');
  await expect(page.getByRole('button', { name: 'Retry processing' })).toBeEnabled();

  await page.getByRole('button', { name: 'Retry processing' }).click();
  await expect(page.getByRole('heading', { name: 'Atomic claims, with receipts.' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText(sourceQuote, { exact: true }).first()).toBeVisible();
  await expect(
    page.locator('#claims').getByText(`Source span · 0–${sourceQuote.length}`, { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('#claims').getByRole('link', { name: `Source URL: ${retryUrl}` }),
  ).toHaveAttribute('href', retryUrl);
  await expect(
    page.locator('#claims').getByRole('link', {
      name: /Citation link: https:\/\/example\.com\/retry-/,
    }),
  ).toHaveAttribute('href', expect.stringContaining(retryUrl));
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);

  const projectId = new URL(page.url()).pathname.split('/').filter(Boolean).at(-1);
  expect(projectId).toBeTruthy();
  const state = await readRetryState(projectId as string);
  const source = state.project?.source;
  expect(state.ownerEmail).toBe(email);
  expect(state.processingRuns).toBe(1);
  expect(source).toMatchObject({
    url: retryUrl,
    normalizedContent: sourceQuote,
    status: 'complete',
    processingError: null,
  });
  expect(source?.claims).toHaveLength(1);
  const claim = source?.claims[0];
  expect(claim).toMatchObject({
    sourceStart: 0,
    sourceEnd: sourceQuote.length,
    sourceQuote,
    sourceUrl: retryUrl,
    citationLinks: expect.arrayContaining([retryUrl]),
  });
  expect(claim?.sourceStart).toBeLessThan(claim?.sourceEnd ?? 0);
});

test('pasted text is persisted and rendered with its exact source passage', async ({
  page,
}, testInfo) => {
  const email = `workspace-text-${Date.now()}-${testInfo.project.name}@example.com`;
  const sourceText =
    'Claimweave preserves every meaningful passage. Analysts can inspect the saved quote and offsets. ' +
    'The evidence remains attached to the extracted claim.';

  await signUp(page, email);
  await page.goto('/projects/new');
  await expect(page.getByRole('radio', { name: /Pasted text/ })).toBeVisible();
  await page.getByRole('radio', { name: /Pasted text/ }).check();
  await expect(page.getByLabel('Source text')).toBeVisible();
  await page.getByLabel('Source text').fill(sourceText);
  await page.route('**/api/projects/*/process', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    await route.continue();
  });
  await page.getByRole('button', { name: 'Extract claims' }).click();

  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  await expect(
    page.getByRole('heading', { name: 'Your evidence trail is taking shape.' }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Atomic claims, with receipts.' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText('Pasted text', { exact: true }).first()).toBeVisible();
  await expect(
    page.getByText('Claimweave preserves every meaningful passage.', { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText('Source passage', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Pasted text has no external source URL/).first()).toBeVisible();
  await expect(page.getByText(/Pasted text has no external citations/).first()).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);

  await assertPersistedTextProject(sourceText, email);

  const projectId = new URL(page.url()).pathname.split('/').filter(Boolean).at(-1);
  expect(projectId).toBeTruthy();
  const initialClaimText = 'Claimweave preserves every meaningful passage.';

  const beforeReloadResponse = await page.request.get(`/api/projects/${projectId}/claims`);
  expect(beforeReloadResponse.ok()).toBe(true);
  const beforeReload = (await beforeReloadResponse.json()) as {
    documentId: string;
    sourceType: string;
    sourceUrl: string | null;
    extractedAt: string;
    claims: Array<{
      text: string;
      sourcePassage: string;
      sourceUrl: string | null;
      extractedAt: string;
    }>;
  };
  expect(beforeReload.claims[0]).toMatchObject({
    text: initialClaimText,
    sourcePassage: initialClaimText,
    sourceUrl: null,
    extractedAt: beforeReload.extractedAt,
  });

  await page.reload();
  await expect(page.getByText(initialClaimText, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(beforeReload.documentId, { exact: true })).toBeVisible();
  await expect(page.getByText('Pasted text', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Pasted text has no external source URL/).first()).toBeVisible();

  const afterReloadResponse = await page.request.get(`/api/projects/${projectId}/claims`);
  expect(afterReloadResponse.ok()).toBe(true);
  const afterReload = (await afterReloadResponse.json()) as typeof beforeReload;
  expect(afterReload).toMatchObject({
    documentId: beforeReload.documentId,
    sourceType: beforeReload.sourceType,
    sourceUrl: beforeReload.sourceUrl,
    extractedAt: beforeReload.extractedAt,
    claims: [
      {
        text: initialClaimText,
        sourcePassage: initialClaimText,
        sourceUrl: null,
        extractedAt: beforeReload.extractedAt,
      },
    ],
  });

  await expect(page.getByText(initialClaimText, { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Reprocess claims' }).click();
  await expect(page.getByRole('button', { name: 'Reprocess claims' })).toBeEnabled();
  await expect(page.getByText(initialClaimText, { exact: true }).first()).toBeVisible();

  const state = await readProcessingState(projectId as string);
  const runs = state.runs;
  expect(runs).toHaveLength(2);
  expect(runs.map((run) => run.version)).toEqual([1, 2]);
  expect(runs.map((run) => run.documentId)).toEqual([
    beforeReload.documentId,
    beforeReload.documentId,
  ]);
  expect(runs.map((run) => run.documentKind)).toEqual(['primary', 'primary']);
  expect(runs[0]?.evidenceState).toBe('complete');
  expect(runs[0]?.createdAt).toEqual(expect.any(String));
  expect(runs[0]?.snapshots).toHaveLength(1);
  expect(runs[1]?.snapshots).toHaveLength(1);
  expect(state.revisions.length).toBeGreaterThanOrEqual(1);
  expect(state.revisions.every((revision) => revision.projectId === projectId)).toBe(true);
  expect(state.revisions.flatMap((revision) => revision.documentSnapshots)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ documentId: expect.any(String), documentKind: 'primary' }),
    ]),
  );
  expect(state.revisions.flatMap((revision) => revision.claimSnapshots)).toEqual(
    expect.arrayContaining([expect.objectContaining({ sourceDocumentId: expect.any(String) })]),
  );
  const firstSnapshot = runs[0]?.snapshots[0];
  const secondSnapshot = runs[1]?.snapshots[0];
  expect(firstSnapshot).toBeTruthy();
  expect(secondSnapshot).toBeTruthy();
  expect(firstSnapshot).toMatchObject({
    text: initialClaimText,
    sourceQuote: initialClaimText,
    sourceStart: 0,
    sourceEnd: initialClaimText.length,
    sourceUrl: null,
    citationLinks: [],
    createdAt: runs[0]?.createdAt,
  });
  expect(secondSnapshot).toMatchObject({
    text: initialClaimText,
    sourceQuote: initialClaimText,
    sourceStart: 0,
    sourceEnd: initialClaimText.length,
    sourceUrl: null,
    citationLinks: [],
    createdAt: runs[1]?.createdAt,
  });
  expect(firstSnapshot?.createdAt).not.toEqual(secondSnapshot?.createdAt);

  expect(state.project?.source?.claims).toHaveLength(1);
  expect(state.project?.source?.claims[0]?.text).toBe(initialClaimText);
});
