import 'dotenv/config';

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';

const password = 'Claimweave-citations-e2e-password-123!';
const databaseUrl = process.env.DATABASE_URL;
const prismaCli = 'node_modules/prisma/build/index.js';
const locatedQuote = 'exact located passage for browser highlighting.';
const locatedUrl = 'http://127.0.0.1:3300/citation/located?source=workspace#original';
const staleUrl = 'http://127.0.0.1:3300/citation/stale?source=workspace#original';

function sqlValue(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function executeSql(statement: string) {
  if (!databaseUrl) throw new Error('DATABASE_URL is required for the citation E2E fixture.');
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
      else
        reject(
          new Error(errorOutput || `Citation fixture SQL exited with code ${code ?? 'unknown'}.`),
        );
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
  await page.getByLabel('Name').fill('Citation Fixture');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function seedCitationProject(email: string) {
  const projectId = `e2e-citations-${randomUUID()}`;
  const sourceId = `e2e-citations-source-${randomUUID()}`;
  const locatedClaimId = `e2e-citations-located-${randomUUID()}`;
  const staleClaimId = `e2e-citations-stale-${randomUUID()}`;
  const sourceText = `Fixture citation source contains the ${locatedQuote}`;
  const extractedAt = '2026-09-18T12:00:00.000Z';
  const locatedStart = sourceText.indexOf(locatedQuote);
  await executeSql(`
    INSERT INTO "ClaimweaveProject" ("id", "createdAt", "userId")
    VALUES (${sqlValue(projectId)}, ${sqlValue(extractedAt)}, (SELECT "id" FROM "user" WHERE "email" = ${sqlValue(email)}));
    INSERT INTO "ClaimweaveSource" ("id", "projectId", "url", "documentText", "normalizedContent", "extractedAt", "status", "processingRoute")
    VALUES (${sqlValue(sourceId)}, ${sqlValue(projectId)}, ${sqlValue(locatedUrl)}, NULL, ${sqlValue(sourceText)}, ${sqlValue(extractedAt)}, 'complete', 'trusted-server-reuse');
    INSERT INTO "ClaimweaveClaim" ("id", "sourceId", "text", "sourceStart", "sourceEnd", "sourceQuote", "citationLinks", "sourceUrl", "extractedAt")
    VALUES
      (${sqlValue(locatedClaimId)}, ${sqlValue(sourceId)}, ${sqlValue(locatedQuote)}, ${String(locatedStart)}, ${String(locatedStart + locatedQuote.length)}, ${sqlValue(locatedQuote)}, jsonb_build_array(${sqlValue(locatedUrl)}), ${sqlValue(locatedUrl)}, ${sqlValue(extractedAt)}),
      (${sqlValue(staleClaimId)}, ${sqlValue(sourceId)}, 'A stale source passage.', 0, 22, 'A stale source passage.', jsonb_build_array(${sqlValue(staleUrl)}), ${sqlValue(locatedUrl)}, ${sqlValue(extractedAt)});
  `);
  return { projectId, locatedClaimId, staleClaimId };
}

test('owner citation links preserve URLs, highlight located passages, and fall back safely', async ({
  page,
  browser,
}, testInfo) => {
  const suffix = `${Date.now()}-${testInfo.project.name}`;
  const ownerEmail = `citation-owner-${suffix}@example.com`;
  const foreignEmail = `citation-foreign-${suffix}@example.com`;
  const foreignContext = await browser.newContext(testInfo.project.use);
  const foreignPage = await foreignContext.newPage();

  try {
    await signUp(page, ownerEmail);
    await signUp(foreignPage, foreignEmail);
    const project = await seedCitationProject(ownerEmail);

    const apiResponse = await page.request.get(`/api/projects/${project.projectId}/claims`);
    expect(apiResponse.ok()).toBe(true);
    const apiBody = (await apiResponse.json()) as {
      claims: Array<{
        id: string;
        citationLinks: string[];
        citationTargets: Array<{ href: string; status: string }>;
      }>;
    };
    const claimsById = new Map(apiBody.claims.map((claim) => [claim.id, claim]));
    expect(claimsById.get(project.locatedClaimId)?.citationLinks).toEqual([locatedUrl]);
    expect(claimsById.get(project.staleClaimId)?.citationLinks).toEqual([staleUrl]);
    expect(claimsById.get(project.locatedClaimId)?.citationTargets[0]).toMatchObject({
      status: 'available',
    });
    expect(claimsById.get(project.staleClaimId)?.citationTargets[0]).toEqual({
      url: staleUrl,
      href: staleUrl,
      status: 'fallback',
      reason: 'quote-not-found',
    });

    await page.goto(`/projects/${project.projectId}`);
    const locatedClaim = page.locator(`#claim-${project.locatedClaimId}`);
    const staleClaim = page.locator(`#claim-${project.staleClaimId}`);
    const locatedLink = locatedClaim.getByRole('link', {
      name: /Open citation and highlight passage/,
    });
    const staleLink = staleClaim.getByRole('link', { name: /Open original citation/ });
    const locatedHref = await locatedLink.getAttribute('href');
    expect(locatedHref).toContain(`${locatedUrl}:~:text=`);
    expect(locatedHref).toContain(encodeURIComponent(locatedQuote));
    await expect(staleLink).toHaveAttribute('href', staleUrl);
    await expect(staleClaim).toContainText(
      'Passage highlight unavailable; opening the original citation.',
    );

    const sourcePagePromise = page.waitForEvent('popup');
    await locatedLink.click();
    const sourcePage = await sourcePagePromise;
    await sourcePage.waitForLoadState();
    expect(sourcePage.url()).toContain(`${locatedUrl}:~:text=`);
    await expect(sourcePage.locator('body')).toContainText(locatedQuote);
    await sourcePage.close();

    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true);
    const foreignResponse = await foreignPage.request.get(
      `/api/projects/${project.projectId}/claims`,
    );
    expect(foreignResponse.status()).toBe(404);
  } finally {
    await foreignContext.close();
  }
});
