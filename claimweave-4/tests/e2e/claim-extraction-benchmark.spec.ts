import 'dotenv/config';

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';

const password = 'Claimweave-benchmark-e2e-password-123!';
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

async function benchmarkRunCount() {
  if (!databaseUrl) throw new Error('DATABASE_URL is required for the E2E fixture.');
  const script = `
    import { PrismaClient } from '@prisma/client';
    const prisma = new PrismaClient();
    try { process.stdout.write(String(await prisma.claimweaveBenchmarkRun.count())); }
    finally { await prisma.$disconnect(); }
  `;
  return new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
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
      else resolve(Number(output));
    });
  });
}

async function signUp(page: Page, email: string) {
  await page.goto('/signup');
  await page.getByLabel('Name').fill('Benchmark Fixture');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/$/);
}

test('admin benchmark API is protected and stays provider-free while blocked', async ({
  page,
  browser,
}) => {
  const adminEmail = `benchmark-admin-${randomUUID()}@example.com`;
  await signUp(page, adminEmail);
  await executeSql(`UPDATE "user" SET "role" = 'admin' WHERE "email" = ${sqlValue(adminEmail)};`);
  const before = await benchmarkRunCount();
  const reportResponse = await page.request.get('/api/admin/claim-extraction-benchmark');
  expect(reportResponse.status()).toBe(200);
  const report = (await reportResponse.json()) as {
    frozenSpecIdentity: string;
    releaseStatus: string;
    traces: unknown[];
  };
  expect(report.frozenSpecIdentity).toMatch(/^[a-f0-9]{64}$/);
  expect(report.releaseStatus).toBe('blocked');
  expect(report.traces).toEqual(expect.any(Array));

  const runResponse = await page.request.post('/api/admin/claim-extraction-benchmark', {
    data: { mode: 'run' },
  });
  expect(runResponse.status()).toBe(412);
  const blocked = (await runResponse.json()) as {
    status: string;
    providerCallsMade: number;
    liveRunCreated: boolean;
  };
  expect(blocked).toMatchObject({
    status: 'blocked',
    providerCallsMade: 0,
    liveRunCreated: false,
  });
  expect(await benchmarkRunCount()).toBe(before);

  const regularContext = await browser.newContext();
  const regularPage = await regularContext.newPage();
  const regularEmail = `benchmark-user-${randomUUID()}@example.com`;
  await signUp(regularPage, regularEmail);
  const denied = await regularPage.request.get('/api/admin/claim-extraction-benchmark', {
    maxRedirects: 0,
  });
  expect(denied.status()).toBe(401);
  await regularContext.close();
});
