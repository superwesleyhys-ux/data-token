// @polsia:user-owned — metadata shell for the protected URL intake workflow.
import type { Metadata } from 'next';
import { UrlImportView } from './url-import-view';

export const metadata: Metadata = {
  title: 'Import URLs',
  description: 'Upload project URLs for deterministic intake and row-level status tracking.',
};

export default async function UrlImportPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <UrlImportView projectId={projectId} />;
}
