import { describe, expect, it, vi } from 'vitest';

const { upsert, updateMany } = vi.hoisted(() => ({
  upsert: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: { claimweaveJourneyEvent: { upsert, updateMany } },
}));

import {
  attachFirstProjectId,
  recordClaimsViewReached,
  recordFirstProjectStarted,
} from '@/lib/business/journey';

describe('journey writes', () => {
  it('upserts first-project starts without changing the first entry point on repeats', async () => {
    await recordFirstProjectStarted('visitor-1', 'demo');
    expect(upsert).toHaveBeenCalledWith({
      where: { visitorId_event: { visitorId: 'visitor-1', event: 'first_project_started' } },
      create: { visitorId: 'visitor-1', event: 'first_project_started', entryPoint: 'demo' },
      update: {},
    });
  });

  it('attaches the first successful project only to an unassigned start', async () => {
    await attachFirstProjectId('visitor-1', 'project-1');
    expect(updateMany).toHaveBeenCalledWith({
      where: { visitorId: 'visitor-1', event: 'first_project_started', projectId: null },
      data: { projectId: 'project-1' },
    });
  });

  it('upserts a reached event with the persisted project id', async () => {
    await recordClaimsViewReached('visitor-1', 'project-1');
    expect(upsert).toHaveBeenCalledWith({
      where: { visitorId_event: { visitorId: 'visitor-1', event: 'claims_view_reached' } },
      create: { visitorId: 'visitor-1', event: 'claims_view_reached', projectId: 'project-1' },
      update: {},
    });
  });
});
