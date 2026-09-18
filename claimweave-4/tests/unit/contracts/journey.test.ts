import { describe, expect, it } from 'vitest';
import {
  JourneyEntryPoint,
  JourneyEvent,
  JourneyHeaders,
  JourneyVisitorId,
} from '@/lib/contracts/journey';

const visitorId = '8f3c1b9e-3d6e-4c8a-9f12-3a7f70d1e4a2';

describe('journey contract', () => {
  it('accepts the anonymous funnel values', () => {
    expect(JourneyVisitorId.safeParse(visitorId).success).toBe(true);
    expect(JourneyEvent.safeParse('first_project_started').success).toBe(true);
    expect(JourneyEvent.safeParse('claims_view_reached').success).toBe(true);
    expect(JourneyEntryPoint.safeParse('demo').success).toBe(true);
    expect(JourneyHeaders.parse({ visitorId, entryPoint: 'manual' })).toEqual({
      visitorId,
      entryPoint: 'manual',
    });
  });

  it('rejects malformed visitor ids and unknown event metadata', () => {
    expect(JourneyVisitorId.safeParse('not-a-uuid').success).toBe(false);
    expect(JourneyEvent.safeParse('project_created').success).toBe(false);
    expect(JourneyEntryPoint.safeParse('campaign').success).toBe(false);
  });
});
