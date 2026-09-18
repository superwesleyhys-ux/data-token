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
      { stdio: ['pipe', 'ignore', 'pipe'] },
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
  await page.goto('/signup');
  await page.getByLabel('Name').fill('Verification Fixture');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function createProject(email: string) {
  const projectId = `verification-${randomUUID()}`;
  const sourceId = `verification-${randomUUID()}`;
  const sourceUrl = `https://primary.example/${projectId}`;
  const createdAt = '2026-09-18T12:00:00.000Z';
  const claims = [
    ['supported', 'Review supports offline access.'],
    ['unsupported', 'Review exports signed reports.'],
    ['contradicted', 'Review includes multilingual support.'],
    ['current', 'Service costs 49 dollars per month.'],
    ['stale', 'Legacy plan costs 49 dollars per month.'],
  ] as const;
  const claimSql = claims
    .map(
      ([id, text]) =>
        `INSERT INTO "ClaimweaveClaim" ("id", "sourceId", "text", "sourceStart", "sourceEnd", "sourceQuote", "citationLinks", "sourceUrl", "extractedAt") VALUES (${sqlValue(`${projectId}-${id}`)}, ${sqlValue(sourceId)}, ${sqlValue(text)}, 0, ${String(text.length)}, ${sqlValue(text)}, jsonb_build_array(${sqlValue(sourceUrl)}), ${sqlValue(sourceUrl)}, ${sqlValue(createdAt)});`,
    )
    .join('\n');
  await executeSql(`
    INSERT INTO "ClaimweaveProject" ("id", "createdAt", "userId")
    VALUES (${sqlValue(projectId)}, ${sqlValue(createdAt)}, (SELECT "id" FROM "user" WHERE "email" = ${sqlValue(email)}));
    INSERT INTO "ClaimweaveSource" ("id", "projectId", "url", "normalizedContent", "extractedAt", "status")
    VALUES (${sqlValue(sourceId)}, ${sqlValue(projectId)}, ${sqlValue(sourceUrl)}, 'Primary extraction source only.', ${sqlValue(createdAt)}, 'complete');
    ${claimSql}
  `);
  return { projectId, claimIds: claims.map(([id]) => `${projectId}-${id}`) };
}

async function readVerificationState(projectId: string) {
  if (!databaseUrl) throw new Error('DATABASE_URL is required for the E2E fixture.');
  const script = `
    import { PrismaClient } from '@prisma/client';
    const prisma = new PrismaClient();
    try {
      const run = await prisma.claimweaveVerificationRun.findFirst({
        where: { projectId: process.env.VERIFICATION_PROJECT_ID },
        orderBy: { completedAt: 'desc' },
        include: { results: { include: { excerpts: true } } },
      });
      const claims = await prisma.claimweaveClaim.findMany({
        where: { source: { projectId: process.env.VERIFICATION_PROJECT_ID } },
        orderBy: { id: 'asc' },
        select: { id: true, approvalStatus: true, reviewerId: true, reviewedAt: true },
      });
      const revisions = await prisma.claimweaveRevision.findMany({
        where: { projectId: process.env.VERIFICATION_PROJECT_ID, eventKind: 'verification' },
        orderBy: { version: 'asc' },
        include: { evidenceSnapshots: true },
      });
      const project = await prisma.claimweaveProject.findUnique({
        where: { id: process.env.VERIFICATION_PROJECT_ID },
        select: { minimumSupportingSources: true },
      });
      process.stdout.write(JSON.stringify({ run, claimIds: claims, revisions, project }));
    } finally { await prisma.$disconnect(); }
  `;
  return new Promise<{
    run: {
      status: string;
      results: Array<{
        claimId: string;
        classification: string;
        excerpts: Array<{
          id: string;
          passageId: string;
          documentId: string;
          documentTitle: string;
          role: string;
          text: string;
          sourceUrl: string | null;
          evidenceDate: string | null;
        }>;
      }>;
    } | null;
    claimIds: Array<{
      id: string;
      approvalStatus: string;
      reviewerId: string | null;
      reviewedAt: string | null;
    }>;
    revisions: Array<{
      eventKind: string;
      evidenceSnapshots: Array<{
        claimId: string;
        evidenceDocumentId: string | null;
        passageId: string | null;
        sourceUrl: string | null;
      }>;
    }>;
    project: { minimumSupportingSources: number } | null;
  }>((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, VERIFICATION_PROJECT_ID: projectId },
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
            run: {
              status: string;
              results: Array<{
                claimId: string;
                classification: string;
                excerpts: Array<{
                  id: string;
                  passageId: string;
                  documentId: string;
                  documentTitle: string;
                  role: string;
                  text: string;
                  sourceUrl: string | null;
                  evidenceDate: string | null;
                }>;
              }>;
            } | null;
            claimIds: Array<{
              id: string;
              approvalStatus: string;
              reviewerId: string | null;
              reviewedAt: string | null;
            }>;
            revisions: Array<{
              eventKind: string;
              evidenceSnapshots: Array<{
                claimId: string;
                evidenceDocumentId: string | null;
                passageId: string | null;
                sourceUrl: string | null;
              }>;
            }>;
            project: { minimumSupportingSources: number } | null;
          },
        );
    });
  });
}

test('the authenticated project route runs and renders independent verification', async ({
  page,
}, testInfo) => {
  const email = `verification-${Date.now()}-${testInfo.project.name}@example.com`;
  await signUp(page, email);
  const project = await createProject(email);

  const current = new Date('2026-09-18T12:00:00.000Z').toISOString();
  const currentEvidence = await page.request.post(
    `/api/projects/${project.projectId}/evidence-documents`,
    {
      data: {
        title: 'Current product brief',
        sourceUrl: `https://evidence.example/current-${project.projectId}`,
        passages: [
          { text: 'Review supports offline access.', evidenceDate: current },
          { text: 'Service costs 49 dollars per month.', evidenceDate: current },
        ],
      },
    },
  );
  expect(currentEvidence.status()).toBe(201);
  const secondSupportingDocument = await page.request.post(
    `/api/projects/${project.projectId}/evidence-documents`,
    {
      data: {
        title: 'Second independent product brief',
        sourceUrl: `https://evidence.example/second-${project.projectId}`,
        content: 'Review supports offline access.',
      },
    },
  );
  expect(secondSupportingDocument.status()).toBe(201);
  const negation = await page.request.post(
    `/api/projects/${project.projectId}/evidence-documents`,
    {
      data: {
        title: 'Independent limitation note',
        sourceUrl: `https://evidence.example/limits-${project.projectId}`,
        content: 'Review does not include multilingual support.',
      },
    },
  );
  expect(negation.status()).toBe(201);
  const stale = await page.request.post(`/api/projects/${project.projectId}/evidence-documents`, {
    data: {
      title: 'Archived plan sheet',
      sourceUrl: `https://evidence.example/archive-${project.projectId}`,
      passages: [
        {
          text: 'Legacy plan costs 49 dollars per month.',
          evidenceDate: '2024-01-01T00:00:00.000Z',
        },
      ],
    },
  });
  expect(stale.status()).toBe(201);

  await page.goto(`/projects/${project.projectId}`);
  const outcomeSummary = page.getByRole('region', { name: 'Verification outcome summary' });
  await expect(outcomeSummary).toContainText('Latest verification: Not verified yet');
  const verifyApiPattern = `**/api/projects/${project.projectId}/verify`;
  await page.route(verifyApiPattern, async (route) => {
    if (route.request().method() === 'POST') {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    await route.continue();
  });
  const verifyButton = page.getByRole('button', { name: 'Verify evidence', exact: true });
  await verifyButton.click();
  const pendingVerifyButton = page.getByRole('button', { name: 'Verifying…', exact: true });
  await expect(pendingVerifyButton).toBeVisible();
  await expect(pendingVerifyButton).toBeDisabled();
  await expect(page.getByText('Independent evidence verified and saved.')).toBeVisible();
  await page.unroute(verifyApiPattern);
  await expect(page.getByText('deterministic / mock')).toBeVisible();
  await expect(outcomeSummary).toContainText('Supported');
  await expect(outcomeSummary).toContainText('Contradicted');
  await expect(outcomeSummary).toContainText('No independent evidence');
  await expect(outcomeSummary).toContainText('Latest verification: Completed');
  await expect(outcomeSummary.locator('p').filter({ hasText: 'Supported' }).locator('..')).toContainText('2');
  await expect(outcomeSummary.locator('p').filter({ hasText: 'Contradicted' }).locator('..')).toContainText('1');
  await expect(
    outcomeSummary.locator('p').filter({ hasText: 'No independent evidence' }).locator('..'),
  ).toContainText('1');
  const verificationApiResponse = await page.request.get(verifyApiPattern.replaceAll('**', ''));
  expect(verificationApiResponse.status()).toBe(200);
  await expect(verificationApiResponse.json()).resolves.toMatchObject({
    verification: {
      outcomeSummary: { supported: 2, contradicted: 1, noIndependentEvidence: 1 },
      status: 'completed',
    },
  });
  await page.route(verifyApiPattern, async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Verification failed unexpectedly.' }),
      });
      return;
    }
    await route.continue();
  });
  await page.getByRole('button', { name: 'Verify evidence', exact: true }).click();
  await expect(page.getByText('Evidence verification did not complete.')).toBeVisible();
  await expect(outcomeSummary).toContainText('Latest verification: Completed');
  await expect(
    outcomeSummary.locator('p').filter({ hasText: 'Supported' }).locator('..'),
  ).toContainText('2');
  await page.unroute(verifyApiPattern);
  await expect(page.getByText('supported', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('contradicted', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('stale evidence', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('no independent evidence', { exact: true }).first()).toBeVisible();
  await expect(
    page.getByText('Review does not include multilingual support.').first(),
  ).toBeVisible();

  const claimsFilterResponse = async (query: string) =>
    page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        response.url().includes(`/api/projects/${project.projectId}/claims?${query}`),
    );
  const chooseFilter = async (label: string, option: string, query: string) => {
    const responsePromise = claimsFilterResponse(query);
    await page.getByLabel(label).click();
    await page.getByRole('option', { name: option, exact: true }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    return (await response.json()) as { pagination: { total: number }; claims: Array<{ id: string }> };
  };
  const expectOnlyVisibleClaims = async (claimIds: readonly (string | undefined)[]) => {
    const visibleClaimIds = new Set(claimIds);
    for (const claimId of project.claimIds) {
      const row = page.locator(`#review-claim-${claimId}`);
      if (visibleClaimIds.has(claimId)) await expect(row).toBeVisible();
      else await expect(row).toHaveCount(0);
    }
  };

  const pendingClaims = await chooseFilter(
    'Approval state filter',
    'Pending',
    'approvalStatus=pending',
  );
  expect(pendingClaims.pagination.total).toBe(5);
  await expect(page.getByLabel('Verification status filter')).toBeVisible();

  const supportedClaims = await chooseFilter(
    'Verification status filter',
    'Supported',
    'approvalStatus=pending&verificationStatus=supported',
  );
  expect(supportedClaims.pagination.total).toBe(2);
  await expect(page.locator(`#review-claim-${project.claimIds[0]}`)).toBeVisible();
  await expect(page.locator(`#review-claim-${project.claimIds[1]}`)).toHaveCount(0);
  await expect(
    page.locator(`#review-claim-${project.claimIds[0]}`).getByText('Source passage', { exact: true }),
  ).toBeVisible();

  const emptyClaims = await chooseFilter(
    'Contradiction state filter',
    'Contradiction found',
    'approvalStatus=pending&verificationStatus=supported&contradictionStatus=found',
  );
  expect(emptyClaims.pagination.total).toBe(0);
  await expect(page.getByText('No claims match these filters.', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).first().click();
  await expect(page.getByText('No claims match these filters.', { exact: true })).toHaveCount(0);
  await expect(page.locator(`#review-claim-${project.claimIds[2]}`)).toBeVisible();

  const primarySourceUrl = `https://primary.example/${project.projectId}`;
  const supportedReview = page.locator(`#review-claim-${project.claimIds[0]}`);
  await expect(supportedReview.getByText('Source passage', { exact: true })).toBeVisible();
  await expect(
    supportedReview.getByText('Review supports offline access.', { exact: true }).first(),
  ).toBeVisible();
  const reviewSourceLink = supportedReview.getByRole('link', {
    name: `Source URL: ${primarySourceUrl}`,
  });
  await expect(reviewSourceLink).toHaveAttribute('href', primarySourceUrl);
  await expect(reviewSourceLink).toHaveAttribute('target', '_blank');
  await expect(reviewSourceLink).toHaveAttribute('rel', 'noreferrer');
  const reviewCitationLink = supportedReview.getByRole('link', {
    name: `Citation link: ${primarySourceUrl}`,
  });
  await expect(reviewCitationLink).toHaveAttribute('href', primarySourceUrl);
  await expect(reviewCitationLink).toHaveAttribute('target', '_blank');
  const savedClaim = page.locator(`#claim-${project.claimIds[0]}`);
  await expect(savedClaim.getByText('Source passage', { exact: true })).toBeVisible();
  await expect(
    savedClaim.getByRole('link', { name: `Source URL: ${primarySourceUrl}` }),
  ).toHaveAttribute('href', primarySourceUrl);
  await expect(
    savedClaim.getByRole('link', { name: `Citation link: ${primarySourceUrl}` }),
  ).toHaveAttribute('href', primarySourceUrl);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);

  const reviewCases = [
    [project.claimIds[0], 'Supporting evidence found'],
    [project.claimIds[1], 'No independent evidence found'],
    [project.claimIds[2], 'Contradiction found'],
    [project.claimIds[3], 'Supporting evidence found'],
    [project.claimIds[4], 'Supporting evidence is stale'],
  ] as const;
  for (const [claimId, evidenceStatus] of reviewCases) {
    const reviewRow = page.locator(`#review-claim-${claimId}`);
    await expect(reviewRow).toBeVisible();
    await expect(reviewRow.getByText('pending review', { exact: true })).toBeVisible();
    await expect(reviewRow.getByText(evidenceStatus, { exact: true })).toBeVisible();
  }

  const bulkApproveButton = page.getByRole('button', { name: 'Approve selected', exact: true });
  const bulkRejectButton = page.getByRole('button', { name: 'Reject selected', exact: true });
  await expect(bulkApproveButton).toBeDisabled();
  await expect(bulkRejectButton).toBeDisabled();
  const supportedCheckbox = supportedReview.getByRole('checkbox');
  const currentReview = page.locator(`#review-claim-${project.claimIds[3]}`);
  await supportedCheckbox.click();
  await currentReview.getByRole('checkbox').click();
  await expect(page.getByText('2 selected', { exact: true })).toBeVisible();
  await expect(bulkApproveButton).toBeEnabled();
  const claimsApiPattern = `**/api/projects/${project.projectId}/claims`;
  await page.route(claimsApiPattern, async (route) => {
    if (route.request().method() === 'PATCH') {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    await route.continue();
  });
  await bulkApproveButton.click();
  await expect(bulkApproveButton).toBeDisabled();
  await expect(page.getByText('2 claims approved.')).toBeVisible();
  await page.unroute(claimsApiPattern);
  await expect(supportedReview.getByText('approved', { exact: true })).toBeVisible();
  await expect(currentReview.getByText('approved', { exact: true })).toBeVisible();

  const unsupportedReview = page.locator(`#review-claim-${project.claimIds[1]}`);
  const staleReview = page.locator(`#review-claim-${project.claimIds[4]}`);
  await unsupportedReview.getByRole('checkbox').click();
  await staleReview.getByRole('checkbox').click();
  await bulkRejectButton.click();
  await expect(page.getByText('2 claims rejected.')).toBeVisible();
  await expect(unsupportedReview.getByText('rejected', { exact: true })).toBeVisible();
  await expect(staleReview.getByText('rejected', { exact: true })).toBeVisible();

  await supportedCheckbox.click();
  await page.route(claimsApiPattern, async (route) => {
    if (route.request().method() === 'PATCH') {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Could not save the claim review.' }),
      });
      return;
    }
    await route.continue();
  });
  await bulkApproveButton.click();
  await expect(page.getByText('1 claim could not be approved. Selection was kept.')).toBeVisible();
  await expect(supportedCheckbox).toBeChecked();
  await page.unroute(claimsApiPattern);
  await supportedCheckbox.click();

  const contradictedReview = page.locator(`#review-claim-${project.claimIds[2]}`);
  await contradictedReview.getByRole('button', { name: 'Reject' }).click();
  await expect(page.getByText('Claim rejected.')).toBeVisible();
  await expect(contradictedReview.getByText('rejected', { exact: true })).toBeVisible();

  const approvedClaims = await chooseFilter('Approval state filter', 'Approved', 'approvalStatus=approved');
  expect(approvedClaims.pagination.total).toBe(2);
  expect(approvedClaims.claims.map(({ id }) => id).sort()).toEqual(
    [project.claimIds[0], project.claimIds[3]].sort(),
  );
  await expectOnlyVisibleClaims([project.claimIds[0], project.claimIds[3]]);

  const rejectedClaims = await chooseFilter('Approval state filter', 'Rejected', 'approvalStatus=rejected');
  expect(rejectedClaims.pagination.total).toBe(3);
  expect(rejectedClaims.claims.map(({ id }) => id).sort()).toEqual(
    [project.claimIds[1], project.claimIds[2], project.claimIds[4]].sort(),
  );
  await expectOnlyVisibleClaims([project.claimIds[1], project.claimIds[2], project.claimIds[4]]);

  await expect(page.getByLabel('Minimum independent sources')).toHaveValue('1');
  await expect(page.getByText('Active threshold: 1 independent source')).toBeVisible();
  await page.getByLabel('Minimum independent sources').fill('2');
  await page.getByRole('button', { name: 'Save threshold', exact: true }).click();
  await expect(page.getByText('Verification threshold saved. The next verification will use it.')).toBeVisible();
  await expect(page.getByLabel('Minimum independent sources')).toHaveValue('2');
  const savedPolicy = await page.request.get(`/api/projects/${project.projectId}/verify`);
  expect(savedPolicy.status()).toBe(200);
  await expect(savedPolicy.json()).resolves.toMatchObject({
    minimumSupportingSources: 2,
    verification: { status: 'completed' },
  });
  const invalidPolicy = await page.request.patch(`/api/projects/${project.projectId}/verify`, {
    data: { minimumSupportingSources: 101 },
  });
  expect(invalidPolicy.status()).toBe(400);

  await page.getByRole('button', { name: 'Verify evidence', exact: true }).click();
  await expect(page.getByText('Independent evidence verified and saved.')).toBeVisible();
  await expect(
    outcomeSummary.locator('p').filter({ hasText: 'Supported' }).locator('..'),
  ).toContainText('1');
  await expect(
    outcomeSummary.locator('p').filter({ hasText: 'No independent evidence' }).locator('..'),
  ).toContainText('2');

  const stored = await readVerificationState(project.projectId);
  expect(stored.run?.status).toBe('completed');
  expect(stored.run?.results).toHaveLength(5);
  expect(stored.run?.results.some((result) => result.excerpts.length > 0)).toBe(true);
  expect(stored.project?.minimumSupportingSources).toBe(2);
  expect(stored.run?.results.find((result) => result.claimId === project.claimIds[0])?.classification).toBe(
    'supported',
  );
  expect(stored.run?.results.find((result) => result.claimId === project.claimIds[3])?.classification).toBe(
    'unsupported',
  );
  expect(stored.revisions).toHaveLength(2);
  expect(stored.revisions[1]?.eventKind).toBe('verification');
  expect(stored.revisions[1]?.evidenceSnapshots.length).toBeGreaterThan(0);
  expect(stored.revisions[1]?.evidenceSnapshots[0]).toMatchObject({
    claimId: expect.any(String),
    evidenceDocumentId: expect.any(String),
    passageId: expect.any(String),
    sourceUrl: expect.stringContaining('https://evidence.example/'),
  });

  const exportResponse = await page.request.get(`/api/projects/${project.projectId}/claims`);
  expect(exportResponse.status()).toBe(200);
  const exported = (await exportResponse.json()) as {
    projectId: string;
    documentId: string;
    sourceType: string;
    sourceUrl: string | null;
    claims: Array<{
      id: string;
      text: string;
      sourceSpan: { quote: string };
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
    }>;
  };
  expect(exported).toMatchObject({
    projectId: project.projectId,
    sourceType: 'url',
    sourceUrl: `https://primary.example/${project.projectId}`,
  });
  const storedByClaimId = new Map(stored.run?.results.map((result) => [result.claimId, result]));
  const storedClaimsById = new Map(stored.claimIds.map((claim) => [claim.id, claim]));
  const supportedClaimId = project.claimIds[0];
  const contradictedClaimId = project.claimIds[2];
  const unsupportedClaimId = project.claimIds[1];
  const currentClaimId = project.claimIds[3];
  const staleClaimId = project.claimIds[4];
  if (!supportedClaimId || !contradictedClaimId || !unsupportedClaimId || !currentClaimId || !staleClaimId) {
    throw new Error('The review fixture did not create the expected claims.');
  }
  expect(storedClaimsById.get(supportedClaimId)).toMatchObject({
    approvalStatus: 'approved',
    reviewerId: expect.any(String),
  });
  expect(storedClaimsById.get(contradictedClaimId)).toMatchObject({
    approvalStatus: 'rejected',
    reviewerId: expect.any(String),
  });
  expect(storedClaimsById.get(supportedClaimId)?.reviewedAt).not.toBeNull();
  expect(storedClaimsById.get(contradictedClaimId)?.reviewedAt).not.toBeNull();
  expect(storedClaimsById.get(unsupportedClaimId)).toMatchObject({
    approvalStatus: 'rejected',
    reviewerId: expect.any(String),
  });
  expect(storedClaimsById.get(currentClaimId)).toMatchObject({
    approvalStatus: 'approved',
    reviewerId: expect.any(String),
  });
  expect(storedClaimsById.get(staleClaimId)).toMatchObject({
    approvalStatus: 'rejected',
    reviewerId: expect.any(String),
  });
  for (const claim of exported.claims) {
    const persisted = storedByClaimId.get(claim.id);
    expect(persisted).toBeDefined();
    if (!persisted) continue;
    expect(claim.text).toBe(claim.sourcePassage);
    expect(claim.sourceSpan.quote).toBe(claim.sourcePassage);
    expect(claim.sourceUrl).toBe(exported.sourceUrl);
    expect(claim.extractedAt).toBe('2026-09-18T12:00:00.000Z');
    expect(claim.citationLinks).toEqual([exported.sourceUrl]);
    expect(claim.verificationStatus).toBe(persisted.classification);
    expect(claim.evidenceExcerpts).toEqual(
      persisted.excerpts.map((excerpt) => ({
        id: excerpt.id,
        passageId: excerpt.passageId,
        documentId: excerpt.documentId,
        documentTitle: excerpt.documentTitle,
        role: excerpt.role,
        text: excerpt.text,
        sourceUrl: excerpt.sourceUrl,
        evidenceDate: excerpt.evidenceDate,
      })),
    );
  }

  await page.reload();
  await expect(page.getByLabel('Approval state filter')).toBeVisible();
  const reloadedApprovedClaims = await chooseFilter(
    'Approval state filter',
    'Approved',
    'approvalStatus=approved',
  );
  expect(reloadedApprovedClaims.pagination.total).toBe(2);
  await expectOnlyVisibleClaims([project.claimIds[0], project.claimIds[3]]);
  const reloadedRejectedClaims = await chooseFilter(
    'Approval state filter',
    'Rejected',
    'approvalStatus=rejected',
  );
  expect(reloadedRejectedClaims.pagination.total).toBe(3);
  await expectOnlyVisibleClaims([project.claimIds[1], project.claimIds[2], project.claimIds[4]]);
  await expect(
    page.locator(`#review-claim-${project.claimIds[0]}`).getByText('approved', { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(`#review-claim-${project.claimIds[2]}`).getByText('rejected', { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(`#claim-${project.claimIds[0]}`).getByText('approved', { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(`#claim-${project.claimIds[2]}`).getByText('rejected', { exact: true }),
  ).toBeVisible();

  const browser = page.context().browser();
  expect(browser).not.toBeNull();
  if (!browser) throw new Error('The E2E browser is unavailable.');
  const secondContext = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  const secondPage = await secondContext.newPage();
  try {
    const secondEmail = `verification-other-${Date.now()}@example.com`;
    await signUp(secondPage, secondEmail);
    const foreignVerification = await secondPage.request.get(
      `/api/projects/${project.projectId}/verify`,
    );
    expect(foreignVerification.status()).toBe(404);
    const foreignRun = await secondPage.request.post(`/api/projects/${project.projectId}/verify`, {
      data: { mode: 'deterministic' },
    });
    expect(foreignRun.status()).toBe(404);
    const foreignDecision = await secondPage.request.patch(
      `/api/projects/${project.projectId}/claims`,
      { data: { claimId: project.claimIds[0], status: 'rejected' } },
    );
    expect(foreignDecision.status()).toBe(404);
    const foreignBulkDecision = await secondPage.request.patch(
      `/api/projects/${project.projectId}/claims`,
      { data: { claimIds: [project.claimIds[0], project.claimIds[1]], status: 'approved' } },
    );
    expect(foreignBulkDecision.status()).toBe(404);
  } finally {
    await secondContext.close();
  }

  const anonymousContext = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  try {
    const anonymousRun = await anonymousContext.request.post(
      `/api/projects/${project.projectId}/verify`,
      { data: { mode: 'deterministic' } },
    );
    expect(anonymousRun.status()).toBe(401);
  } finally {
    await anonymousContext.close();
  }
});
