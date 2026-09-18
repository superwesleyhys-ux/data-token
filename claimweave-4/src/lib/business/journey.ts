// @polsia:user-owned — idempotent anonymous first-project funnel writes.
import type { JourneyEntryPoint } from '@/lib/contracts/journey';
import { prisma } from '@/lib/db';

const firstProjectStarted = 'first_project_started' as const;
const claimsViewReached = 'claims_view_reached' as const;

export async function recordFirstProjectStarted(visitorId: string, entryPoint?: JourneyEntryPoint) {
  await prisma.claimweaveJourneyEvent.upsert({
    where: { visitorId_event: { visitorId, event: firstProjectStarted } },
    create: { visitorId, event: firstProjectStarted, entryPoint },
    update: {},
  });
}

export async function attachFirstProjectId(visitorId: string, projectId: string) {
  await prisma.claimweaveJourneyEvent.updateMany({
    where: { visitorId, event: firstProjectStarted, projectId: null },
    data: { projectId },
  });
}

export async function recordClaimsViewReached(visitorId: string, projectId: string) {
  await prisma.claimweaveJourneyEvent.upsert({
    where: { visitorId_event: { visitorId, event: claimsViewReached } },
    create: { visitorId, event: claimsViewReached, projectId },
    update: {},
  });
}
