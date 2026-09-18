// @polsia:user-owned — protected URL import processing route coverage.
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { claimRow, findProject, processRow, requireAuth, transaction, updateBatch, updateClaim } =
  vi.hoisted(() => ({
    claimRow: vi.fn(),
    findProject: vi.fn(),
    processRow: vi.fn(),
    requireAuth: vi.fn(),
    transaction: vi.fn(),
    updateBatch: vi.fn(),
    updateClaim: vi.fn(),
  }));

vi.mock('@/lib/business/claim-extraction', () => ({
  ClaimweaveError: class ClaimweaveError extends Error {
    status: number;

    constructor(message: string, status = 422) {
      super(message);
      this.status = status;
    }
  },
  processUrlImportRow: processRow,
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({
  prisma: {
    $transaction: transaction,
    claimweaveProject: { findFirst: findProject },
    claimweaveUrlImportRow: { findFirst: claimRow },
  },
}));
vi.mock('@/lib/require-auth', () => ({ requireAuth }));

import { POST } from '@/app/api/projects/[projectId]/url-import/process/route';

const completedAt = new Date('2026-09-18T00:01:00.000Z');

function row(status: string, overrides: Record<string, unknown> = {}) {
  return {
    id: 'row-1',
    batchId: 'batch-1',
    rowNumber: 1,
    rawValue: 'https://example.com/one',
    normalizedUrl: 'https://example.com/one',
    status,
    error: null,
    processingStartedAt: status === 'processing' ? completedAt : null,
    completedAt: status === 'completed' ? completedAt : null,
    failedAt: status === 'failed' ? completedAt : null,
    importedDocument:
      status === 'completed'
        ? { id: 'document-1', extractedAt: completedAt, claims: [{ id: 'claim-1' }] }
        : null,
    ...overrides,
  };
}

function request(body: unknown) {
  return new Request('http://localhost/api/projects/project-1/url-import/process', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function params() {
  return { params: Promise.resolve({ projectId: 'project-1' }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAuth.mockResolvedValue({ id: 'owner-1' });
  findProject.mockResolvedValue({ id: 'project-1' });
  transaction.mockImplementation(async (callback: (client: unknown) => unknown) =>
    callback({
      claimweaveUrlImportBatch: { update: updateBatch },
      claimweaveUrlImportRow: { findFirst: claimRow, updateMany: updateClaim },
    }),
  );
  updateClaim.mockResolvedValue({ count: 1 });
  updateBatch.mockResolvedValue({});
});

describe('POST /api/projects/[projectId]/url-import/process', () => {
  it('returns 401 before reading a project for anonymous callers', async () => {
    requireAuth.mockRejectedValue(Response.json({ error: 'Unauthorized' }, { status: 401 }));

    const response = await POST(request({}), params());

    expect(response.status).toBe(401);
    expect(findProject).not.toHaveBeenCalled();
  });

  it('returns 404 for a foreign or missing project', async () => {
    findProject.mockResolvedValue(null);

    const response = await POST(request({}), params());

    expect(response.status).toBe(404);
  });

  it('validates the process body', async () => {
    const response = await POST(request({ rowId: '' }), params());

    expect(response.status).toBe(400);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('requires row and batch identifiers for an explicit retry', async () => {
    const response = await POST(request({ retry: true }), params());

    expect(response.status).toBe(400);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('claims a queued row and returns the completed persisted result', async () => {
    claimRow.mockResolvedValue(row('queued'));
    processRow.mockResolvedValue(row('completed'));

    const response = await POST(request({ rowId: 'row-1', batchId: 'batch-1' }), params());
    const body = (await response.json()) as { row: { status: string; documentId: string } };

    expect(response.status).toBe(200);
    expect(updateClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'row-1', projectId: 'project-1', status: 'queued' },
        data: expect.objectContaining({ status: 'processing' }),
      }),
    );
    expect(processRow).toHaveBeenCalledWith({
      rowId: 'row-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
    });
    expect(body.row).toMatchObject({ status: 'completed', documentId: 'document-1' });
  });

  it('does not invoke extraction for an in-flight row or a terminal row', async () => {
    claimRow.mockResolvedValueOnce(row('processing')).mockResolvedValueOnce(row('completed'));

    expect((await POST(request({ rowId: 'row-1' }), params())).status).toBe(409);
    expect((await POST(request({ rowId: 'row-1' }), params())).status).toBe(200);
    expect(processRow).not.toHaveBeenCalled();
  });

  it('claims only a failed row for retry and clears its failure metadata', async () => {
    claimRow.mockResolvedValue(row('failed', { error: 'The source could not be read.' }));
    processRow.mockResolvedValue(row('completed'));

    const response = await POST(
      request({ rowId: 'row-1', batchId: 'batch-1', retry: true }),
      params(),
    );

    expect(response.status).toBe(200);
    expect(updateClaim).toHaveBeenCalledWith({
      where: { id: 'row-1', projectId: 'project-1', batchId: 'batch-1', status: 'failed' },
      data: expect.objectContaining({
        status: 'processing',
        error: null,
        failedAt: null,
        completedAt: null,
      }),
    });
    expect(processRow).toHaveBeenCalledWith({
      rowId: 'row-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
    });
  });

  it('returns a completed row unchanged when retry is requested', async () => {
    claimRow.mockResolvedValue(row('completed'));

    const response = await POST(
      request({ rowId: 'row-1', batchId: 'batch-1', retry: true }),
      params(),
    );

    expect(response.status).toBe(200);
    expect(updateClaim).not.toHaveBeenCalled();
    expect(processRow).not.toHaveBeenCalled();
  });

  it('returns a conflict when another retry claims the failed row first', async () => {
    claimRow.mockResolvedValue(row('failed', { error: 'The source could not be read.' }));
    updateClaim.mockResolvedValue({ count: 0 });

    const response = await POST(
      request({ rowId: 'row-1', batchId: 'batch-1', retry: true }),
      params(),
    );

    expect(response.status).toBe(409);
    expect(processRow).not.toHaveBeenCalled();
  });

  it('does not retry retained CSV error rows', async () => {
    claimRow.mockResolvedValue(row('error', { error: 'This URL is repeated in this file.' }));

    const response = await POST(
      request({ rowId: 'row-1', batchId: 'batch-1', retry: true }),
      params(),
    );

    expect(response.status).toBe(409);
    expect(updateClaim).not.toHaveBeenCalled();
    expect(processRow).not.toHaveBeenCalled();
  });

  it('returns the failed terminal row after extraction failure is persisted', async () => {
    claimRow.mockResolvedValue(row('queued'));
    processRow.mockRejectedValue(new Error('source unavailable'));
    claimRow
      .mockResolvedValueOnce(row('queued'))
      .mockResolvedValueOnce(row('failed', { error: 'The source could not be read.' }));

    const response = await POST(request({ rowId: 'row-1' }), params());
    const body = (await response.json()) as { row: { status: string; error: string } };

    expect(response.status).toBe(200);
    expect(body.row).toMatchObject({ status: 'failed', error: 'The source could not be read.' });
  });

  it('returns the persisted failed row after a retry failure', async () => {
    processRow.mockRejectedValue(new Error('source unavailable'));
    claimRow
      .mockResolvedValueOnce(row('failed', { error: 'Old failure.' }))
      .mockResolvedValueOnce(row('failed', { error: 'The source could not be read.' }));

    const response = await POST(
      request({ rowId: 'row-1', batchId: 'batch-1', retry: true }),
      params(),
    );
    const body = (await response.json()) as { row: { status: string; error: string } };

    expect(response.status).toBe(200);
    expect(body.row).toMatchObject({ status: 'failed', error: 'The source could not be read.' });
  });
});
