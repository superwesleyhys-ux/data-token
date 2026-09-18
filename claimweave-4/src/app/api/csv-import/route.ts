// @polsia:user-owned

import 'server-only';
import { authorizeCsvImport, csvImportTargets } from '@/lib/csv-import/targets.server';
import { siteUrl } from '@/lib/site';
import { createCsvImportHandlers } from '@/modules/csv-import/server';

export const dynamic = 'force-dynamic';

const handlers = createCsvImportHandlers({
  targets: csvImportTargets,
  authorize: authorizeCsvImport,
  allowedOrigin: new URL(siteUrl).origin,
});

export const GET = handlers.GET;
export const POST = handlers.POST;
