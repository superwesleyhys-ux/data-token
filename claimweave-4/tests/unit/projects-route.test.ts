// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireAuth,
  createQueuedProject,
  claimProjectForProcessing,
  processExistingProject,
  markProjectProcessingFailed,
  findFirst,
} = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  createQueuedProject: vi.fn(),
  claimProjectForProcessing: vi.fn(),
  processExistingProject: vi.fn(),
  markProjectProcessingFailed: vi.fn(),
  findFirst: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/require-auth', () => ({ requireAuth }));
vi.mock('@/lib/business/claim-extraction', () => ({
  ClaimweaveError: class ClaimweaveError extends Error {
    status: number;
    constructor(message: string, status = 422) {
      super(message);
      this.status = status;
    }
  },
  createQueuedProject,
  claimProjectForProcessing,
  processExistingProject,
  markProjectProcessingFailed,
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    claimweaveProject: { findFirst },
  },
}));
vi.mock('@/lib/business/journey', () => ({
  attachFirstProjectId: vi.fn(),
  recordFirstProjectStarted: vi.fn(),
}));

import { POST as processProject } from '@/app/api/projects/[projectId]/process/route';
import { GET as readProject } from '@/app/api/projects/[projectId]/route';
import { POST as createProject } from '@/app/api/projects/route';

const user = { id: 'user-1' };

function request(body?: unknown) {
  return new Request('http://test/api/projects', {
    method: 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { 'content-type': 'application/json' },
  });
}

function params(projectId = 'project-1') {
  return { params: Promise.resolve({ projectId }) };
}

const queued = {
  projectId: 'project-1',
  sourceType: 'text' as const,
  status: 'processing' as const,
};
const complete = {
  projectId: 'project-1',
  sourceType: 'text' as const,
  sourceUrl: null,
  createdAt: '2026-09-17T12:00:00.000Z',
  status: 'complete' as const,
  error: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  requireAuth.mockResolvedValue(user);
});

describe('POST /api/projects', () => {
  it('denies anonymous creation before parsing or creating a project', async () => {
    requireAuth.mockRejectedValue(Response.json({ error: 'Unauthorized' }, { status: 401 }));

    const response = await createProject(
      request({ text: 'This text is long enough to pass validation.' }),
    );

    expect(response.status).toBe(401);
    expect(createQueuedProject).not.toHaveBeenCalled();
  });

  it('rejects empty input without creating a row', async () => {
    const response = await createProject(request({}));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      errors: { url: 'Submit a URL or pasted text.', text: 'Submit a URL or pasted text.' },
    });
    expect(createQueuedProject).not.toHaveBeenCalled();
  });

  it('creates an owner-scoped queued project for valid text', async () => {
    createQueuedProject.mockResolvedValue(queued);

    const response = await createProject(
      request({ text: 'This text is long enough to pass validation and start processing.' }),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(queued);
    expect(createQueuedProject).toHaveBeenCalledWith(
      { text: 'This text is long enough to pass validation and start processing.' },
      'user-1',
    );
  });
});

describe('project status and processing routes', () => {
  it('masks foreign projects as not found', async () => {
    findFirst.mockResolvedValue(null);

    const response = await readProject(new Request('http://test/api/projects/project-1'), params());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Project not found.' });
  });

  it('returns a completed status after processing the claimed project', async () => {
    claimProjectForProcessing.mockResolvedValue({ kind: 'claimed', token: 'claim-1' });
    processExistingProject.mockResolvedValue({});
    findFirst.mockResolvedValue({
      id: 'project-1',
      createdAt: new Date('2026-09-17T12:00:00.000Z'),
      source: { url: null, status: 'complete', processingError: null },
    });

    const response = await processProject(
      new Request('http://test/api/projects/project-1/process', { method: 'POST' }),
      params(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(complete);
    expect(processExistingProject).toHaveBeenCalledWith({
      projectId: 'project-1',
      ownerId: 'user-1',
      processingClaim: 'claim-1',
    });
  });

  it('persists an actionable failed state when extraction fails', async () => {
    claimProjectForProcessing.mockResolvedValue({ kind: 'claimed', token: 'claim-1' });
    processExistingProject.mockRejectedValue(new Error('source unavailable'));
    markProjectProcessingFailed.mockResolvedValue(
      new (class extends Error {
        status = 422;
      })('The source could not be read.'),
    );

    const response = await processProject(
      new Request('http://test/api/projects/project-1/process', { method: 'POST' }),
      params(),
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: 'The source could not be read.' });
    expect(markProjectProcessingFailed).toHaveBeenCalledWith(
      'project-1',
      'user-1',
      'claim-1',
      expect.any(Error),
    );
  });
});
