// @polsia:user-owned — shared contract for anonymous first-project telemetry.
import { z } from 'zod';

export const JourneyVisitorId = z.string().uuid();
export const JourneyEvent = z.enum(['first_project_started', 'claims_view_reached']);
export const JourneyEntryPoint = z.enum(['manual', 'demo']);

export const JourneyHeaders = z.object({
  visitorId: JourneyVisitorId.optional(),
  entryPoint: JourneyEntryPoint.optional(),
});

export type JourneyEvent = z.infer<typeof JourneyEvent>;
export type JourneyEntryPoint = z.infer<typeof JourneyEntryPoint>;
