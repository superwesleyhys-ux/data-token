// @polsia:user-owned

import 'server-only';
import { auth } from '@/lib/auth';
import { CsvAccessError, type CsvServerTarget } from '@/modules/csv-import/server';
import { claimweaveUrlImportTarget } from './claimweave-url-import.server';

export const csvImportTargets: CsvServerTarget[] = [claimweaveUrlImportTarget];

export async function authorizeCsvImport(req: Request, _targetId: string) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.user) throw new CsvAccessError(401);
  if (session.user.role !== 'admin') throw new CsvAccessError(403);
  return { actorId: session.user.id, scopeId: session.user.id };
}
