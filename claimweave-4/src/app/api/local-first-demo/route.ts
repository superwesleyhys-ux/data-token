// @polsia:user-owned — public provider-free local-first demo boundary.
import 'server-only';

import { NextResponse } from 'next/server';
import { buildLocalFirstDemo } from '@/lib/business/local-first-demo';
import { LocalFirstDemoPayload } from '@/lib/contracts/local-first';

export const dynamic = 'force-static';

export function GET() {
  return NextResponse.json(LocalFirstDemoPayload.parse(buildLocalFirstDemo()), {
    headers: { 'cache-control': 'public, max-age=300' },
  });
}
