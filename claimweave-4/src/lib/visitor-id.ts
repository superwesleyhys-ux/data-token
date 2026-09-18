// @polsia:user-owned — browser-only anonymous visitor identifier.
import { JourneyVisitorId } from '@/lib/contracts/journey';

const STORAGE_KEY = 'claimweave-visitor-id';

export function getVisitorId() {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && JourneyVisitorId.safeParse(stored).success) return stored;
    const visitorId = crypto.randomUUID();
    window.localStorage.setItem(STORAGE_KEY, visitorId);
    return visitorId;
  } catch {
    try {
      return crypto.randomUUID();
    } catch {
      return null;
    }
  }
}
