// @polsia:user-owned

import 'server-only';
import { auth } from '@/lib/auth';
import { claimweaveUrlImportSource } from '@/lib/csv-export/claimweave-url-import.server';
import {
  CsvAccessError,
  type CsvServerSource,
  type ExportContext,
} from '@/modules/csv-export/server';

export const csvExportSources: CsvServerSource[] = [claimweaveUrlImportSource];

export async function authorizeCsvExport(
  request: Request,
  _sourceId: string,
): Promise<ExportContext> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) throw new CsvAccessError(401);
  return { actorId: session.user.id, scopeId: session.user.id };
}
