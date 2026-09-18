import 'dotenv/config';

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
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
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(errorOutput))));
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
  await page.getByLabel('Name').fill('URL Intake Fixture');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function createProject(email: string) {
  const projectId = `url-import-${randomUUID()}`;
  const sourceId = `url-import-source-${randomUUID()}`;
  const sourceUrl = `https://example.com/project-${projectId}`;
  await executeSql(`
    INSERT INTO "ClaimweaveProject" ("id", "userId")
    VALUES (${sqlValue(projectId)}, (SELECT "id" FROM "user" WHERE "email" = ${sqlValue(email)}));
    INSERT INTO "ClaimweaveSource" ("id", "projectId", "url", "normalizedContent", "extractedAt", "status")
    VALUES (${sqlValue(sourceId)}, ${sqlValue(projectId)}, ${sqlValue(sourceUrl)}, 'Fixture source', now(), 'complete');
  `);
  return projectId;
}

async function assertPersisted(projectId: string, email: string) {
  await executeSql(`
    DO $$
    BEGIN
      IF (SELECT count(*) FROM "ClaimweaveUrlImportBatch" AS batch
          JOIN "ClaimweaveProject" AS project ON project."id" = batch."projectId"
          JOIN "user" AS account ON account."id" = project."userId"
          WHERE batch."projectId" = ${sqlValue(projectId)} AND account."email" = ${sqlValue(email)}) <> 1
      THEN RAISE EXCEPTION 'expected one URL import batch'; END IF;
      IF (SELECT count(*) FROM "ClaimweaveUrlImportRow" WHERE "projectId" = ${sqlValue(projectId)} AND "status" = 'completed') <> 2
      THEN RAISE EXCEPTION 'expected two completed URL rows'; END IF;
      IF (SELECT count(*) FROM "ClaimweaveUrlImportRow" WHERE "projectId" = ${sqlValue(projectId)} AND "status" = 'error') <> 3
      THEN RAISE EXCEPTION 'expected three retained error rows'; END IF;
      IF (SELECT count(*) FROM "ClaimweaveUrlImportEntry" WHERE "projectId" = ${sqlValue(projectId)}) <> 2
      THEN RAISE EXCEPTION 'expected two scoped URL entries'; END IF;
      IF (SELECT count(*) FROM "ClaimweaveImportedDocument" WHERE "projectId" = ${sqlValue(projectId)}) <> 2
      THEN RAISE EXCEPTION 'expected two imported documents'; END IF;
      IF (SELECT count(*) FROM "ClaimweaveImportedClaim" WHERE "projectId" = ${sqlValue(projectId)}) < 2
      THEN RAISE EXCEPTION 'expected imported claims'; END IF;
      IF (SELECT count(*) FROM "ClaimweaveRevision" WHERE "projectId" = ${sqlValue(projectId)} AND "eventKind" = 'ingestion') <> 2
      THEN RAISE EXCEPTION 'expected one ingestion revision per imported document'; END IF;
      IF (SELECT count(*) FROM "ClaimweaveDocumentRevisionSnapshot" AS snapshot
          JOIN "ClaimweaveRevision" AS revision ON revision."id" = snapshot."revisionId"
          WHERE revision."projectId" = ${sqlValue(projectId)} AND snapshot."documentKind" = 'imported') <> 2
      THEN RAISE EXCEPTION 'expected imported document revision snapshots'; END IF;
      IF (SELECT count(*) FROM "ClaimweaveClaimRevisionSnapshot" AS snapshot
          JOIN "ClaimweaveRevision" AS revision ON revision."id" = snapshot."revisionId"
          WHERE revision."projectId" = ${sqlValue(projectId)} AND snapshot."documentKind" = 'imported') < 2
      THEN RAISE EXCEPTION 'expected imported claim revision snapshots'; END IF;
    END $$;
  `);
}

async function readRows(page: Page, projectId: string) {
  const response = await page.request.get(`/api/projects/${projectId}/url-import/status`);
  expect(response.status()).toBe(200);
  return (await response.json()) as {
    batches: Array<{
      id: string;
      rows: Array<{ id: string; status: string; normalizedUrl: string | null }>;
    }>;
  };
}

test('owners confirm URL batches while foreign and anonymous callers stay out', async ({
  page,
  browser,
  request,
}, testInfo) => {
  const suffix = `${Date.now()}-${testInfo.project.name}`;
  const ownerEmail = `url-owner-${suffix}@example.com`;
  const otherEmail = `url-other-${suffix}@example.com`;
  await signUp(page, ownerEmail);
  const otherContext = await browser.newContext(testInfo.project.use);
  const otherPage = await otherContext.newPage();
  try {
    await signUp(otherPage, otherEmail);
    const projectId = await createProject(ownerEmail);
    const foreignProjectId = await createProject(otherEmail);
    const endpoint = `/api/projects/${projectId}/url-import`;
    const exportEndpoint = `${endpoint}/export`;
    const body = {
      action: 'preview',
      targetId: 'claimweave-url-intake',
      csv: `URL\nhttps://example.com/one\nhttps://example.com/retry-${suffix}\nhttps://example.com/three\nnot a url\nhttps://example.com/one\n`,
      delimiter: ',',
      mapping: { url: 0 },
    };

    expect((await request.get(`${endpoint}?target=claimweave-url-intake`)).status()).toBe(401);
    expect((await request.post(endpoint, { data: body })).status()).toBe(401);
    expect((await request.post(exportEndpoint, { data: { batchId: 'missing' } })).status()).toBe(
      401,
    );
    expect((await otherPage.request.get(`${endpoint}?target=claimweave-url-intake`)).status()).toBe(
      404,
    );
    expect((await otherPage.request.get(`${endpoint}/status`)).status()).toBe(404);
    expect((await otherPage.request.post(endpoint, { data: body })).status()).toBe(404);
    expect((await page.request.get(`${endpoint}/status`)).status()).toBe(200);

    const externalRequests: string[] = [];
    page.on('request', (requestEvent) => {
      if (requestEvent.url().startsWith('https://example.com/'))
        externalRequests.push(requestEvent.url());
    });
    await page.goto(`/projects/${projectId}/url-import`);
    await expect(
      page.getByRole('heading', { name: 'Bring the URLs in. Decide what happens next.' }),
    ).toBeVisible();
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: 'urls.csv', mimeType: 'text/csv', buffer: Buffer.from(body.csv) });
    await page.getByRole('button', { name: 'Preview rows' }).click();
    await expect(
      page.getByText(
        'You can still confirm: flagged rows will be retained with their exact errors.',
      ),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Confirm 5 rows' }).click();
    await expect(page.getByText('Import saved')).toBeVisible();
    await expect(page.getByText('Completed').first()).toBeVisible();
    await expect(page.getByText('Failed').first()).toBeVisible();
    await expect(page.getByText('This URL is repeated in this file.').first()).toBeVisible();
    await expect(page.getByText('URLs cannot contain whitespace.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(1);
    const failedStatus = await readRows(page, projectId);
    const batch = failedStatus.batches[0];
    const failedRow = batch?.rows.find((row) => row.status === 'failed');
    expect(failedRow).toBeTruthy();
    if (!batch || !failedRow) throw new Error('Expected the transient fixture row to fail once.');
    expect(
      (
        await otherPage.request.post(`${endpoint}/process`, {
          data: { rowId: failedRow.id, batchId: batch.id, retry: true },
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await request.post(`${endpoint}/process`, {
          data: { rowId: failedRow.id, batchId: batch.id, retry: true },
        })
      ).status(),
    ).toBe(401);
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByText('Batch complete')).toBeVisible();
    await expect(page.getByText('Completed')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0);
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download CSV' }).first().click();
    const download = await downloadPromise;
    const downloadedPath = await download.path();
    expect(downloadedPath).toBeTruthy();
    if (!downloadedPath) throw new Error('Expected a CSV download path.');
    const csv = await readFile(downloadedPath, 'utf8');
    expect(csv).toContain('submitted_url');
    expect(csv).toContain('validation_status');
    expect(csv).toContain('processing_status');
    expect(csv).toContain('document_reference');
    expect(csv).toContain('https://example.com/one');
    expect(csv).toContain('not_processed');
    expect(
      (
        await otherPage.request.post(exportEndpoint, {
          data: { batchId: batch.id },
        })
      ).status(),
    ).toBe(404);
    expect(externalRequests).toEqual([]);
    await page.reload();
    await expect(page.getByText('Completed').first()).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true);
    await assertPersisted(projectId, ownerEmail);
    expect(foreignProjectId).toBeTruthy();
  } finally {
    await otherContext.close();
  }
});
