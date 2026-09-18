import 'dotenv/config';

import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { expect, type Page, test } from '@playwright/test';

const password = 'Claimweave-e2e-password-123!';
const databaseUrl = process.env.DATABASE_URL;

type ClaimsFixture = {
  projectId: string;
  sourceId: string;
  claimId: string;
  claimIds: string[];
  evidenceDocumentId: string;
  passageId: string;
  excerptId: string;
  approvalStatus: 'pending' | 'approved' | 'rejected';
  reviewedAt: string | null;
  reviewerId: string | null;
};

async function signUp(page: Page, email: string) {
  const ipSuffix =
    (Array.from(email).reduce((total, character) => total + character.charCodeAt(0), 0) % 240) + 1;
  await page.context().setExtraHTTPHeaders({
    'x-forwarded-for': `203.0.113.${ipSuffix}`,
    'x-real-ip': `203.0.113.${ipSuffix}`,
  });
  await page.goto('/signup');
  await page.getByLabel('Name').fill('API Key Fixture');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function readStoredKey(email: string, applicationName: string) {
  if (!databaseUrl) throw new Error('DATABASE_URL is required for the E2E fixture.');
  const script = `
    import { PrismaClient } from '@prisma/client';
    const prisma = new PrismaClient();
    try {
      const user = await prisma.user.findUnique({ where: { email: process.env.API_KEYS_E2E_EMAIL } });
      const key = user ? await prisma.apiKey.findFirst({ where: { userId: user.id, applicationName: process.env.API_KEYS_E2E_APP } }) : null;
      process.stdout.write(JSON.stringify(key));
    } finally {
      await prisma.$disconnect();
    }
  `;
  return new Promise<{ keyHash: string; keyPrefix: string; revokedAt: string | null } | null>(
    (resolve, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
        env: { ...process.env, API_KEYS_E2E_EMAIL: email, API_KEYS_E2E_APP: applicationName },
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
        if (code !== 0)
          reject(new Error(errorOutput || `Database query exited with code ${code ?? 'unknown'}.`));
        else
          resolve(
            JSON.parse(output) as {
              keyHash: string;
              keyPrefix: string;
              revokedAt: string | null;
            } | null,
          );
      });
    },
  );
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
}

async function seedClaimsFixture(
  email: string,
  label: string,
  reviewed = false,
): Promise<ClaimsFixture> {
  if (!databaseUrl) throw new Error('DATABASE_URL is required for the E2E fixture.');
  const script = `
    import { PrismaClient } from '@prisma/client';
    const prisma = new PrismaClient();
    try {
      const user = await prisma.user.findUnique({ where: { email: process.env.CLAIMS_E2E_EMAIL } });
      if (!user) throw new Error('Claims fixture user was not found.');
      const projectId = process.env.CLAIMS_E2E_PROJECT_ID;
      const sourceId = process.env.CLAIMS_E2E_SOURCE_ID;
      const claimId = process.env.CLAIMS_E2E_CLAIM_ID;
      const tieClaimId = process.env.CLAIMS_E2E_TIE_CLAIM_ID;
      const laterClaimId = process.env.CLAIMS_E2E_LATER_CLAIM_ID;
      const evidenceDocumentId = process.env.CLAIMS_E2E_EVIDENCE_DOCUMENT_ID;
      const passageId = process.env.CLAIMS_E2E_PASSAGE_ID;
      const runId = process.env.CLAIMS_E2E_RUN_ID;
      const resultId = process.env.CLAIMS_E2E_RESULT_ID;
      const excerptId = process.env.CLAIMS_E2E_EXCERPT_ID;
      if (!projectId || !sourceId || !claimId || !tieClaimId || !laterClaimId || !evidenceDocumentId || !passageId || !runId || !resultId || !excerptId) {
        throw new Error('Claims fixture ids are incomplete.');
      }
      const extractedAt = new Date('2026-09-18T12:00:00.000Z');
      const isReviewed = ${reviewed ? 'true' : 'false'};
      const decisionAt = new Date('2026-09-18T13:30:00.000Z');
      const sourceUrl = 'https://example.com/api-key-claims-source';
      const claimText = 'API-key claims retain their provenance.';
      const evidenceText = 'Independent evidence confirms the API-key claim.';
      const processingTrace = {
        state: 'exact-repeat',
        computationLocation: 'trusted-server',
        reuseDecision: 'hit',
        accessCorrectness: 'passed',
        modelCallCount: 0,
        providerUsage: { attempts: null, inputTokens: null, outputTokens: null, totalTokens: null, costUsd: null },
        latencyMs: 12,
        transferredBytes: 256,
        fallbackReason: null,
      };
      await prisma.claimweaveProject.create({
        data: {
          id: projectId,
          userId: user.id,
          source: {
            create: {
              id: sourceId,
              url: sourceUrl,
              normalizedContent: claimText,
              extractedAt,
              status: 'complete',
              processingRoute: 'trusted-server-reuse',
              processingTrace,
              claims: {
                create: [
                  {
                    id: claimId,
                    text: claimText,
                    sourceStart: 0,
                    sourceEnd: claimText.length,
                    sourceQuote: claimText,
                    citationLinks: [sourceUrl],
                    sourceUrl,
                    extractedAt,
                    approvalStatus: isReviewed ? 'approved' : 'pending',
                    reviewedAt: isReviewed ? decisionAt : null,
                    reviewerId: isReviewed ? user.id : null,
                  },
                  {
                    id: tieClaimId,
                    text: 'A tied API-key claim.',
                    sourceStart: 0,
                    sourceEnd: 21,
                    sourceQuote: 'A tied API-key claim.',
                    citationLinks: [sourceUrl],
                    sourceUrl,
                    extractedAt,
                  },
                  {
                    id: laterClaimId,
                    text: 'A later API-key claim.',
                    sourceStart: 40,
                    sourceEnd: 63,
                    sourceQuote: 'A later API-key claim.',
                    citationLinks: [sourceUrl],
                    sourceUrl,
                    extractedAt,
                  },
                ],
              },
            },
          },
        },
      });
      await prisma.claimweaveEvidenceDocument.create({
        data: {
          id: evidenceDocumentId,
          projectId,
          userId: user.id,
          title: 'API-key evidence',
          normalizedContent: evidenceText,
          contentHash: 'api-key-claims-fixture-hash',
          passages: {
            create: {
              id: passageId,
              text: evidenceText,
              sourceUrl: 'https://example.com/api-key-evidence',
              evidenceDate: extractedAt,
            },
          },
        },
      });
      await prisma.claimweaveVerificationRun.create({
        data: {
          id: runId,
          projectId,
          userId: user.id,
          startedAt: extractedAt,
          completedAt: extractedAt,
          mode: 'deterministic',
          policyVersion: 'independence-v1/freshness-365d',
          status: 'completed',
          results: {
            create: {
              id: resultId,
              claimId,
              classification: 'supported',
              freshness: 'fresh',
              verifiedAt: extractedAt,
              excerpts: {
                create: {
                  id: excerptId,
                  passageId,
                  documentId: evidenceDocumentId,
                  documentTitle: 'API-key evidence',
                  role: 'supporting',
                  text: evidenceText,
                  sourceUrl: 'https://example.com/api-key-evidence',
                  evidenceDate: extractedAt,
                },
              },
            },
          },
        },
      });
      process.stdout.write(JSON.stringify({
        projectId,
        sourceId,
        claimId,
        claimIds: [claimId, tieClaimId, laterClaimId],
        evidenceDocumentId,
        passageId,
        excerptId,
        approvalStatus: isReviewed ? 'approved' : 'pending',
        reviewedAt: isReviewed ? decisionAt.toISOString() : null,
        reviewerId: isReviewed ? user.id : null,
      }));
    } finally {
      await prisma.$disconnect();
    }
  `;
  const fixtureTimestamp = Date.now();
  const ids = {
    projectId: `api-key-claims-project-${fixtureTimestamp}-${label}`,
    sourceId: `api-key-claims-source-${fixtureTimestamp}-${label}`,
    claimId: `api-key-claims-claim-${fixtureTimestamp}-${label}`,
    tieClaimId: `api-key-claims-claim-${fixtureTimestamp}-${label}-a-tie`,
    laterClaimId: `api-key-claims-claim-${fixtureTimestamp}-${label}-z-later`,
    evidenceDocumentId: `api-key-claims-evidence-${fixtureTimestamp}-${label}`,
    passageId: `api-key-claims-passage-${fixtureTimestamp}-${label}`,
    runId: `api-key-claims-run-${fixtureTimestamp}-${label}`,
    resultId: `api-key-claims-result-${fixtureTimestamp}-${label}`,
    excerptId: `api-key-claims-excerpt-${fixtureTimestamp}-${label}`,
  };
  return new Promise<ClaimsFixture>((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      env: {
        ...process.env,
        CLAIMS_E2E_EMAIL: email,
        CLAIMS_E2E_PROJECT_ID: ids.projectId,
        CLAIMS_E2E_SOURCE_ID: ids.sourceId,
        CLAIMS_E2E_CLAIM_ID: ids.claimId,
        CLAIMS_E2E_TIE_CLAIM_ID: ids.tieClaimId,
        CLAIMS_E2E_LATER_CLAIM_ID: ids.laterClaimId,
        CLAIMS_E2E_EVIDENCE_DOCUMENT_ID: ids.evidenceDocumentId,
        CLAIMS_E2E_PASSAGE_ID: ids.passageId,
        CLAIMS_E2E_RUN_ID: ids.runId,
        CLAIMS_E2E_RESULT_ID: ids.resultId,
        CLAIMS_E2E_EXCERPT_ID: ids.excerptId,
      },
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
        reject(new Error(errorOutput || `Claims fixture exited with code ${code ?? 'unknown'}.`));
        return;
      }
      resolve(JSON.parse(output) as ClaimsFixture);
    });
  });
}

async function createKeyThroughSettings(page: Page, applicationName: string) {
  await page.goto('/settings/api-keys');
  await page.getByLabel('Application name').fill(applicationName);
  await page.getByRole('button', { name: 'Create key' }).click();
  const secret = await page.locator('code').filter({ hasText: 'cw_live_' }).first().textContent();
  if (!secret) throw new Error('The API-key settings flow did not return a secret.');
  expect(secret).toMatch(/^cw_live_[A-Za-z0-9_-]+$/);
  return secret;
}

test('authenticated users can create, mask, and revoke API keys', async ({ page }, testInfo) => {
  const email = `api-key-${Date.now()}-${testInfo.project.name}@example.com`;
  const applicationName = `E2E Connector ${testInfo.project.name}`;
  await signUp(page, email);

  await page.goto('/settings/api-keys');
  await expect(page).toHaveURL('/settings/api-keys');
  await expectNoHorizontalOverflow(page);

  await page.getByLabel('Application name').fill(applicationName);
  await page.getByRole('button', { name: 'Create key' }).click();
  const secret = await page.locator('code').filter({ hasText: 'cw_live_' }).first().textContent();
  expect(secret).toMatch(/^cw_live_[A-Za-z0-9_-]+$/);
  await expect(page.getByText('This is the only time we will show the full secret')).toBeVisible();

  const stored = await readStoredKey(email, applicationName);
  expect(stored?.keyHash).toBe(createHash('sha256').update(secret ?? '', 'utf8').digest('hex'));
  expect(stored?.keyPrefix).toBe(secret?.slice(0, 16));
  expect(stored).not.toHaveProperty('secret');

  await page.reload();
  await expectNoHorizontalOverflow(page);
  await expect(page.getByText('Active')).toBeVisible();
  await expect(page.locator('code').filter({ hasText: secret ?? '' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Revoke' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Revoke key' }).click();
  await expect(page.getByText('Revoked', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  const revoked = await readStoredKey(email, applicationName);
  expect(revoked?.revokedAt).toBeTruthy();
});

test('API keys authenticate the owner-scoped claims export', async ({
  page,
  browser,
  request,
}, testInfo) => {
  const suffix = `${Date.now()}-${testInfo.project.name}`;
  const ownerEmail = `api-claims-owner-${suffix}@example.com`;
  const otherEmail = `api-claims-other-${suffix}@example.com`;
  const otherContext = await browser.newContext(testInfo.project.use);
  const otherPage = await otherContext.newPage();

  try {
    await signUp(page, ownerEmail);
    await signUp(otherPage, otherEmail);
    const ownedProject = await seedClaimsFixture(ownerEmail, `owner-${suffix}`, true);
    const otherProject = await seedClaimsFixture(otherEmail, `other-${suffix}`);
    const secret = await createKeyThroughSettings(page, `Claims export ${suffix}`);

    expect((await request.get(`/api/projects/${ownedProject.projectId}/claims`)).status()).toBe(
      401,
    );

    const exportResponse = await request.get(`/api/projects/${ownedProject.projectId}/claims`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    expect(exportResponse.status()).toBe(200);
    const exported = (await exportResponse.json()) as {
      documentId: string;
      sourceType: string;
      sourceUrl: string | null;
      normalizedContentLength: number | null;
      processingRoute: string | null;
      processingTrace: { computationLocation: string; latencyMs: number | null } | null;
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
        projectId: string;
        text: string;
        sourceSpan: { start: number; end: number; quote: string };
        sourcePassage: string;
        sourceUrl: string | null;
        extractedAt: string;
        citationLinks: string[];
        evidenceExcerpts: Array<{
          id: string;
          passageId: string;
          documentId: string;
          documentTitle: string;
          role: string;
          text: string;
          sourceUrl: string | null;
          evidenceDate: string | null;
        }>;
        verificationStatus: string | null;
        approvalStatus: string;
        reviewedAt: string | null;
        reviewerId: string | null;
      }>;
    };
    expect(exported).toMatchObject({
      documentId: ownedProject.sourceId,
      sourceType: 'url',
      sourceUrl: 'https://example.com/api-key-claims-source',
      normalizedContentLength: 'API-key claims retain their provenance.'.length,
      processingRoute: 'trusted-server-reuse',
      processingTrace: { computationLocation: 'trusted-server', latencyMs: 12 },
    });
    expect(exported.pagination).toEqual({
      page: 1,
      pageSize: 50,
      total: 3,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    });
    expect(exported.claims.map((claim) => claim.id)).toEqual(ownedProject.claimIds);
    expect(exported.claims[0]).toMatchObject({
      id: ownedProject.claimId,
      projectId: ownedProject.projectId,
      text: 'API-key claims retain their provenance.',
      sourceSpan: {
        start: 0,
        end: 'API-key claims retain their provenance.'.length,
        quote: 'API-key claims retain their provenance.',
      },
      sourcePassage: 'API-key claims retain their provenance.',
      sourceUrl: 'https://example.com/api-key-claims-source',
      extractedAt: '2026-09-18T12:00:00.000Z',
      citationLinks: ['https://example.com/api-key-claims-source'],
      evidenceExcerpts: [
        {
          id: ownedProject.excerptId,
          passageId: ownedProject.passageId,
          documentId: ownedProject.evidenceDocumentId,
          documentTitle: 'API-key evidence',
          role: 'supporting',
          text: 'Independent evidence confirms the API-key claim.',
          sourceUrl: 'https://example.com/api-key-evidence',
          evidenceDate: '2026-09-18T12:00:00.000Z',
        },
      ],
      verificationStatus: 'supported',
      approvalStatus: ownedProject.approvalStatus,
      reviewedAt: ownedProject.reviewedAt,
      reviewerId: ownedProject.reviewerId,
    });
    expect(exported.claims[0]).toMatchObject({
      approvalStatus: 'approved',
      reviewedAt: '2026-09-18T13:30:00.000Z',
      reviewerId: ownedProject.reviewerId,
    });

    const secondPageResponse = await request.get(
      `/api/projects/${ownedProject.projectId}/claims?page=2&pageSize=2`,
      { headers: { Authorization: `Bearer ${secret}` } },
    );
    expect(secondPageResponse.status()).toBe(200);
    const secondPage = (await secondPageResponse.json()) as {
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
    expect(secondPage.pagination).toEqual({
      page: 2,
      pageSize: 2,
      total: 3,
      totalPages: 2,
      hasNextPage: false,
      hasPreviousPage: true,
    });
    expect(secondPage.claims.map((claim) => claim.id)).toEqual([ownedProject.claimIds[2]]);
    expect(secondPage.claims[0]).toMatchObject({
      sourceUrl: 'https://example.com/api-key-claims-source',
      citationLinks: ['https://example.com/api-key-claims-source'],
    });

    const invalidPaginationResponse = await request.get(
      `/api/projects/${ownedProject.projectId}/claims?pageSize=101`,
      { headers: { Authorization: `Bearer ${secret}` } },
    );
    expect(invalidPaginationResponse.status()).toBe(400);
    await expect(invalidPaginationResponse.json()).resolves.toEqual({
      error: 'Invalid pagination parameters.',
    });

    const crossOwnerResponse = await request.get(`/api/projects/${otherProject.projectId}/claims`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    expect(crossOwnerResponse.status()).toBe(403);

    await page.getByRole('button', { name: 'Revoke' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Revoke key' }).click();
    await expect(page.getByText('Revoked', { exact: true })).toBeVisible();

    const revokedResponse = await request.get(`/api/projects/${ownedProject.projectId}/claims`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    expect(revokedResponse.status()).toBe(401);
  } finally {
    await otherContext.close();
  }
});
