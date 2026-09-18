// @polsia:user-owned — metadata-only shell for a persisted project.
import type { Metadata } from 'next';
import { ProjectProcessingWorkspace } from '@/components/custom/project-processing-workspace';
import { ClaimsView } from './claims-view';

export const metadata: Metadata = {
  title: 'Evidence trail',
  description: 'Review persisted atomic claims, source spans, and citation links.',
};

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return (
    <ProjectProcessingWorkspace projectId={projectId}>
      <ClaimsView projectId={projectId} />
    </ProjectProcessingWorkspace>
  );
}
