// @polsia:user-owned — metadata-only shell for protected project history.
import type { Metadata } from 'next';
import { ProjectHistoryView } from './history-view';

export const metadata: Metadata = {
  title: 'Processing history',
  description: 'Review the saved processing versions and claim changes for this project.',
};

export default async function ProjectHistoryPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <ProjectHistoryView projectId={projectId} />;
}
