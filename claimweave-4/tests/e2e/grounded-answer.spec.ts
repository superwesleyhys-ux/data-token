// @polsia:user-owned — maintained authenticated HTTP coverage for grounded answers.
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

async function readStoredExcerpt(projectId: string, excerptId: string) {
  if (!databaseUrl) throw new Error('DATABASE_URL is required for the E2E fixture.');
  const script = `
    import { PrismaClient } from '@prisma/client';
    const prisma = new PrismaClient();
    try {
      const excerpt = await prisma.claimweaveVerificationExcerpt.findUnique({
        where: { id: process.env.GROUNDED_EXCERPT_ID },
        select: {
          id: true,
          passageId: true,
          documentId: true,
          documentTitle: true,
          role: true,
          text: true,
          sourceUrl: true,
          evidenceDate: true,
          result: { select: { run: { select: { projectId: true } } } },
        },
      });
      if (!excerpt || excerpt.result.run.projectId !== process.env.GROUNDED_PROJECT_ID) {
        throw new Error('Grounded fixture excerpt was not scoped to the expected project.');
      }
      process.stdout.write(JSON.stringify({
        id: excerpt.id,
        passageId: excerpt.passageId,
        documentId: excerpt.documentId,
        documentTitle: excerpt.documentTitle,
        role: excerpt.role,
        text: excerpt.text,
        sourceUrl: excerpt.sourceUrl,
        evidenceDate: excerpt.evidenceDate,
      }));
    } finally { await prisma.$disconnect(); }
  `;
  return new Promise<{
    id: string;
    passageId: string;
    documentId: string;
    documentTitle: string;
    role: string;
    text: string;
    sourceUrl: string | null;
    evidenceDate: string | null;
  }>((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      env: {
        ...process.env,
        GROUNDED_PROJECT_ID: projectId,
        GROUNDED_EXCERPT_ID: excerptId,
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
      if (code !== 0) reject(new Error(errorOutput || 'Grounded fixture read-back failed.'));
      else resolve(JSON.parse(output) as Awaited<ReturnType<typeof readStoredExcerpt>>);
    });
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
  await page.getByLabel('Name').fill('Grounded Answer Fixture');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/$/);
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

async function seedGroundedProject(email: string) {
  const projectId = `grounded-${randomUUID()}`;
  const sourceId = `grounded-source-${randomUUID()}`;
  const supportedClaimId = `grounded-supported-${randomUUID()}`;
  const unknownClaimId = `grounded-unknown-${randomUUID()}`;
  const pendingClaimId = `grounded-pending-${randomUUID()}`;
  const staleClaimId = `grounded-stale-${randomUUID()}`;
  const evidenceDocumentId = `grounded-document-${randomUUID()}`;
  const passageId = `grounded-passage-${randomUUID()}`;
  const runId = `grounded-run-${randomUUID()}`;
  const supportedResultId = `grounded-result-${randomUUID()}`;
  const unknownResultId = `grounded-result-${randomUUID()}`;
  const staleResultId = `grounded-result-${randomUUID()}`;
  const supportedExcerptId = `grounded-excerpt-${randomUUID()}`;
  const unknownExcerptId = `grounded-excerpt-${randomUUID()}`;
  const staleExcerptId = `grounded-excerpt-${randomUUID()}`;
  const timestamp = '2026-09-18T12:00:00.000Z';
  const sourceUrl = `https://primary.example/${projectId}`;
  const evidenceUrl = `https://evidence.example/${projectId}`;
  const supportedText = 'Claimweave supports citation-ready grounded answers.';
  const unknownText = 'Claimweave retains undated supporting evidence.';
  const staleText = 'Claimweave had a legacy export workflow.';
  const evidenceText = 'Independent evidence confirms citation-ready grounded answers.';

  await executeSql(`
    INSERT INTO "ClaimweaveProject" ("id", "createdAt", "userId")
    VALUES (${sqlValue(projectId)}, ${sqlValue(timestamp)}, (SELECT "id" FROM "user" WHERE "email" = ${sqlValue(email)}));
    INSERT INTO "ClaimweaveSource" ("id", "projectId", "url", "normalizedContent", "extractedAt", "status")
    VALUES (${sqlValue(sourceId)}, ${sqlValue(projectId)}, ${sqlValue(sourceUrl)}, ${sqlValue(supportedText)}, ${sqlValue(timestamp)}, 'complete');
    INSERT INTO "ClaimweaveClaim" ("id", "sourceId", "text", "sourceStart", "sourceEnd", "sourceQuote", "citationLinks", "sourceUrl", "extractedAt", "approvalStatus") VALUES
      (${sqlValue(supportedClaimId)}, ${sqlValue(sourceId)}, ${sqlValue(supportedText)}, 0, ${String(supportedText.length)}, ${sqlValue(supportedText)}, jsonb_build_array(${sqlValue(sourceUrl)}), ${sqlValue(sourceUrl)}, ${sqlValue(timestamp)}, 'approved'),
      (${sqlValue(unknownClaimId)}, ${sqlValue(sourceId)}, ${sqlValue(unknownText)}, 0, ${String(unknownText.length)}, ${sqlValue(unknownText)}, jsonb_build_array(${sqlValue(sourceUrl)}), ${sqlValue(sourceUrl)}, ${sqlValue(timestamp)}, 'approved'),
      (${sqlValue(pendingClaimId)}, ${sqlValue(sourceId)}, 'Pending claim.', 0, 13, 'Pending claim.', jsonb_build_array(${sqlValue(sourceUrl)}), ${sqlValue(sourceUrl)}, ${sqlValue(timestamp)}, 'pending'),
      (${sqlValue(staleClaimId)}, ${sqlValue(sourceId)}, ${sqlValue(staleText)}, 0, ${String(staleText.length)}, ${sqlValue(staleText)}, jsonb_build_array(${sqlValue(sourceUrl)}), ${sqlValue(sourceUrl)}, ${sqlValue(timestamp)}, 'approved');
    INSERT INTO "ClaimweaveEvidenceDocument" ("id", "projectId", "userId", "title", "sourceUrl", "submittedAt", "normalizedContent", "contentHash", "status", "createdAt", "updatedAt")
    VALUES (${sqlValue(evidenceDocumentId)}, ${sqlValue(projectId)}, (SELECT "id" FROM "user" WHERE "email" = ${sqlValue(email)}), 'Grounded fixture evidence', ${sqlValue(evidenceUrl)}, ${sqlValue(timestamp)}, ${sqlValue(evidenceText)}, ${sqlValue(`hash-${projectId}`)}, 'submitted', ${sqlValue(timestamp)}, ${sqlValue(timestamp)});
    INSERT INTO "ClaimweaveEvidencePassage" ("id", "documentId", "text", "sourceUrl", "createdAt")
    VALUES (${sqlValue(passageId)}, ${sqlValue(evidenceDocumentId)}, ${sqlValue(evidenceText)}, ${sqlValue(evidenceUrl)}, ${sqlValue(timestamp)});
    INSERT INTO "ClaimweaveVerificationRun" ("id", "projectId", "userId", "startedAt", "completedAt", "mode", "policyVersion", "status")
    VALUES (${sqlValue(runId)}, ${sqlValue(projectId)}, (SELECT "id" FROM "user" WHERE "email" = ${sqlValue(email)}), ${sqlValue(timestamp)}, ${sqlValue(timestamp)}, 'deterministic', 'independence-v1/freshness-365d', 'completed');
    INSERT INTO "ClaimweaveVerificationResult" ("id", "runId", "claimId", "classification", "freshness", "verifiedAt") VALUES
      (${sqlValue(supportedResultId)}, ${sqlValue(runId)}, ${sqlValue(supportedClaimId)}, 'supported', 'fresh', ${sqlValue(timestamp)}),
      (${sqlValue(unknownResultId)}, ${sqlValue(runId)}, ${sqlValue(unknownClaimId)}, 'supported', 'unknown', ${sqlValue(timestamp)}),
      (${sqlValue(staleResultId)}, ${sqlValue(runId)}, ${sqlValue(staleClaimId)}, 'supported', 'stale', ${sqlValue(timestamp)});
    INSERT INTO "ClaimweaveVerificationExcerpt" ("id", "resultId", "passageId", "documentId", "documentTitle", "role", "text", "sourceUrl", "evidenceDate") VALUES
      (${sqlValue(supportedExcerptId)}, ${sqlValue(supportedResultId)}, ${sqlValue(passageId)}, ${sqlValue(evidenceDocumentId)}, 'Grounded fixture evidence', 'supporting', ${sqlValue(evidenceText)}, ${sqlValue(evidenceUrl)}, ${sqlValue(timestamp)}),
      (${sqlValue(unknownExcerptId)}, ${sqlValue(unknownResultId)}, ${sqlValue(passageId)}, ${sqlValue(evidenceDocumentId)}, 'Grounded fixture evidence', 'supporting', ${sqlValue(evidenceText)}, ${sqlValue(evidenceUrl)}, NULL),
      (${sqlValue(staleExcerptId)}, ${sqlValue(staleResultId)}, ${sqlValue(passageId)}, ${sqlValue(evidenceDocumentId)}, 'Grounded fixture evidence', 'supporting', ${sqlValue(evidenceText)}, ${sqlValue(evidenceUrl)}, '2024-01-01T00:00:00.000Z');
  `);

  return {
    projectId,
    supportedClaimId,
    evidenceText,
    evidenceUrl,
    supportedExcerptId,
  };
}

async function seedEmptyProject(email: string) {
  const projectId = `grounded-empty-${randomUUID()}`;
  const sourceId = `grounded-empty-source-${randomUUID()}`;
  await executeSql(`
    INSERT INTO "ClaimweaveProject" ("id", "userId")
    VALUES (${sqlValue(projectId)}, (SELECT "id" FROM "user" WHERE "email" = ${sqlValue(email)}));
    INSERT INTO "ClaimweaveSource" ("id", "projectId", "url", "extractedAt", "status")
    VALUES (${sqlValue(sourceId)}, ${sqlValue(projectId)}, 'https://primary.example/empty', now(), 'complete');
  `);
  return projectId;
}

test('returns server-backed grounded citations and denies anonymous or foreign access', async ({
  page,
  browser,
  request,
}, testInfo) => {
  const suffix = `${Date.now()}-${testInfo.project.name}`;
  const ownerEmail = `grounded-owner-${suffix}@example.com`;
  const otherEmail = `grounded-other-${suffix}@example.com`;
  await signUp(page, ownerEmail);
  const otherContext = await browser.newContext(testInfo.project.use);
  const otherPage = await otherContext.newPage();

  try {
    await signUp(otherPage, otherEmail);
    const ownerProject = await seedGroundedProject(ownerEmail);
    const emptyProjectId = await seedEmptyProject(ownerEmail);
    const foreignProject = await seedGroundedProject(otherEmail);
    const ownerSecret = await createKeyThroughSettings(page, `Grounded answers ${suffix}`);
    const otherSecret = await createKeyThroughSettings(otherPage, `Grounded answers other ${suffix}`);
    const response = await page.request.post(
      `/api/projects/${ownerProject.projectId}/grounded-answer`,
      { data: { question: 'What does the evidence support?' } },
    );
    expect(response.status()).toBe(200);
    const body = (await response.json()) as {
      grounded: boolean;
      answer: string;
      citations: Array<{
        claimId: string;
        claimText: string;
        excerpts: Array<{ id: string; text: string; sourceUrl: string | null }>;
        citationUrls: string[];
      }>;
    };
    expect(body.grounded).toBe(true);
    expect(body.answer).toContain('citation-ready grounded answers');
    expect(body.citations).toHaveLength(1);
    expect(body.citations[0]).toMatchObject({
      claimId: ownerProject.supportedClaimId,
      claimText: 'Claimweave supports citation-ready grounded answers.',
      citationUrls: [ownerProject.evidenceUrl, `https://primary.example/${ownerProject.projectId}`],
    });
    expect(body.citations[0]?.excerpts).toEqual([
      {
        id: ownerProject.supportedExcerptId,
        passageId: expect.any(String),
        documentId: expect.any(String),
        documentTitle: 'Grounded fixture evidence',
        role: 'supporting',
        text: ownerProject.evidenceText,
        sourceUrl: ownerProject.evidenceUrl,
        evidenceDate: '2026-09-18T12:00:00.000Z',
      },
    ]);
    const storedExcerpt = await readStoredExcerpt(
      ownerProject.projectId,
      ownerProject.supportedExcerptId,
    );
    expect(body.citations[0]?.excerpts[0]).toEqual(storedExcerpt);

    const apiKeyResponse = await request.post(
      `/api/projects/${ownerProject.projectId}/grounded-answer`,
      {
        data: { question: 'What does the evidence support?' },
        headers: { Authorization: `Bearer ${ownerSecret}` },
      },
    );
    expect(apiKeyResponse.status()).toBe(200);
    await expect(apiKeyResponse.json()).resolves.toEqual(body);

    const noGrounding = await page.request.post(`/api/projects/${emptyProjectId}/grounded-answer`, {
      data: { question: 'What is known?' },
    });
    expect(noGrounding.status()).toBe(200);
    await expect(noGrounding.json()).resolves.toEqual({
      grounded: false,
      answer: null,
      citations: [],
      reason: 'insufficient-approved-evidence',
    });

    expect(
      (
        await otherPage.request.post(`/api/projects/${ownerProject.projectId}/grounded-answer`, {
          data: { question: 'What is known?' },
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await otherPage.request.post(`/api/projects/${foreignProject.projectId}/grounded-answer`, {
          data: { question: 'What is known?' },
        })
      ).status(),
    ).toBe(200);
    const crossOwner = await request.post(
      `/api/projects/${ownerProject.projectId}/grounded-answer`,
      {
        data: { question: 'What is known?' },
        headers: { Authorization: `Bearer ${otherSecret}` },
      },
    );
    expect(crossOwner.status()).toBe(403);
    await expect(crossOwner.json()).resolves.toEqual({ error: 'Forbidden' });
    const unknownProject = await request.post(
      `/api/projects/grounded-unknown-${suffix}/grounded-answer`,
      {
        data: { question: 'What is known?' },
        headers: { Authorization: `Bearer ${ownerSecret}` },
      },
    );
    expect(unknownProject.status()).toBe(404);
    await expect(unknownProject.json()).resolves.toEqual({ error: 'Project not found.' });
    const malformedAuth = await request.post(
      `/api/projects/${ownerProject.projectId}/grounded-answer`,
      {
        data: { question: 'What is known?' },
        headers: { Authorization: `Basic ${ownerSecret}` },
      },
    );
    expect(malformedAuth.status()).toBe(401);
    const unknownAuth = await request.post(
      `/api/projects/${ownerProject.projectId}/grounded-answer`,
      {
        data: { question: 'What is known?' },
        headers: { Authorization: 'Bearer cw_live_unknown-secret' },
      },
    );
    expect(unknownAuth.status()).toBe(401);
    await page.goto('/settings/api-keys');
    await page.getByRole('button', { name: 'Revoke' }).click();
    await page.getByRole('button', { name: 'Revoke key' }).click();
    await expect(page.getByText('Revoked', { exact: true })).toBeVisible();
    const revokedAuth = await request.post(
      `/api/projects/${ownerProject.projectId}/grounded-answer`,
      {
        data: { question: 'What is known?' },
        headers: { Authorization: `Bearer ${ownerSecret}` },
      },
    );
    expect(revokedAuth.status()).toBe(401);
    expect(
      (
        await request.post(`/api/projects/${ownerProject.projectId}/grounded-answer`, {
          data: { question: 'What is known?' },
        })
      ).status(),
    ).toBe(401);
    expect(
      (
        await page.request.post(`/api/projects/${ownerProject.projectId}/grounded-answer`, {
          data: { question: '   ' },
        })
      ).status(),
    ).toBe(400);
  } finally {
    await otherContext.close();
  }
});
