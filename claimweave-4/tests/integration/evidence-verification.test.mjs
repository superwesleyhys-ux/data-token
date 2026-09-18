import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { test } from 'node:test';

const databaseUrl = process.env.TEST_DATABASE_URL;

const persistenceScript = `
  import { randomUUID } from 'node:crypto';
  import { PrismaClient } from '@prisma/client';

  const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
  const suffix = randomUUID();
  const projectId = 'integration-project-' + suffix;
  const sourceId = 'integration-source-' + suffix;
  const claimId = 'integration-claim-' + suffix;
  const documentId = 'integration-document-' + suffix;
  const passageId = 'integration-passage-' + suffix;
  const runId = 'integration-run-' + suffix;
  const now = new Date('2026-09-18T12:00:00.000Z');
  const userId = 'integration-user-' + suffix;

  try {
    await prisma.claimweaveProject.create({ data: { id: projectId, userId } });
    const defaultProject = await prisma.claimweaveProject.findUnique({
      where: { id: projectId },
      select: { minimumSupportingSources: true },
    });
    await prisma.claimweaveProject.update({
      where: { id: projectId },
      data: { minimumSupportingSources: 2 },
    });
    const savedProject = await prisma.claimweaveProject.findUnique({
      where: { id: projectId },
      select: { minimumSupportingSources: true },
    });
    await prisma.claimweaveSource.create({
      data: { id: sourceId, projectId, normalizedContent: 'Primary extraction only.', extractedAt: now, status: 'complete' },
    });
    await prisma.claimweaveClaim.create({
      data: {
        id: claimId,
        sourceId,
        text: 'The review tool supports offline access.',
        sourceStart: 0,
        sourceEnd: 40,
        sourceQuote: 'The review tool supports offline access.',
        citationLinks: [],
        extractedAt: now,
      },
    });
    await prisma.claimweaveEvidenceDocument.create({
      data: {
        id: documentId,
        projectId,
        userId,
        title: 'Independent fixture',
        sourceUrl: 'https://evidence.example/fixture',
        submittedAt: now,
        publicationDate: now,
        normalizedContent: 'The review tool supports offline access.',
        contentHash: 'fixture-hash',
        passages: {
          create: {
            id: passageId,
            text: 'The review tool supports offline access.',
            sourceUrl: 'https://evidence.example/fixture',
            evidenceDate: now,
          },
        },
      },
    });
    await prisma.claimweaveVerificationRun.create({
      data: {
        id: runId,
        projectId,
        userId,
        startedAt: now,
        completedAt: now,
        mode: 'deterministic',
        policyVersion: 'independence-v1/freshness-365d',
        status: 'completed',
        accuracyTotal: 1,
        accuracyCorrect: 1,
        accuracyPercentage: 100,
        results: {
          create: {
            claimId,
            classification: 'supported',
            freshness: 'fresh',
            verifiedAt: now,
            excerpts: {
              create: {
                passageId,
                documentId,
                documentTitle: 'Independent fixture',
                role: 'supporting',
                text: 'The review tool supports offline access.',
                sourceUrl: 'https://evidence.example/fixture',
                evidenceDate: now,
              },
            },
          },
        },
      },
    });
    const stored = await prisma.claimweaveVerificationRun.findUnique({
      where: { id: runId },
      include: { results: { include: { excerpts: true } } },
    });
    process.stdout.write(JSON.stringify({
      status: stored?.status,
      defaultMinimumSupportingSources: defaultProject?.minimumSupportingSources,
      savedMinimumSupportingSources: savedProject?.minimumSupportingSources,
      mode: stored?.mode,
      accuracyPercentage: stored?.accuracyPercentage,
      classification: stored?.results[0]?.classification,
      passageId: stored?.results[0]?.excerpts[0]?.passageId,
      sourceUrl: stored?.results[0]?.excerpts[0]?.sourceUrl,
      evidenceDate: stored?.results[0]?.excerpts[0]?.evidenceDate?.toISOString(),
    }));
  } finally {
    await prisma.claimweaveVerificationRun.deleteMany({ where: { id: runId } });
    await prisma.claimweaveEvidenceDocument.deleteMany({ where: { id: documentId } });
    await prisma.claimweaveClaim.deleteMany({ where: { id: claimId } });
    await prisma.claimweaveSource.deleteMany({ where: { id: sourceId } });
    await prisma.claimweaveProject.deleteMany({ where: { id: projectId } });
    await prisma.$disconnect();
  }
`;

function readBack() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', persistenceScript], {
      env: { ...process.env, TEST_DATABASE_URL: databaseUrl },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let error = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      error += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(JSON.parse(output));
      else reject(new Error(error || `Persistence fixture exited with ${code ?? 'unknown'}.`));
    });
  });
}

test(
  'persists a complete verification run and reads every evidence field back',
  { skip: !databaseUrl },
  async () => {
    const stored = await readBack();
    assert.equal(stored.status, 'completed');
    assert.equal(stored.defaultMinimumSupportingSources, 1);
    assert.equal(stored.savedMinimumSupportingSources, 2);
    assert.equal(stored.mode, 'deterministic');
    assert.equal(stored.accuracyPercentage, 100);
    assert.equal(stored.classification, 'supported');
    assert.match(stored.passageId, /^integration-passage-/);
    assert.equal(stored.sourceUrl, 'https://evidence.example/fixture');
    assert.equal(stored.evidenceDate, '2026-09-18T12:00:00.000Z');
  },
);
