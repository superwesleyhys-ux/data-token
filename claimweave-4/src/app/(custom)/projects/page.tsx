// @polsia:user-owned — metadata-only shell for the protected project workspace.
import type { Metadata } from 'next';
import { ProjectsWorkspace } from '@/components/custom/projects-workspace';
import { ProjectForm } from './new/project-form';

export const metadata: Metadata = {
  title: 'Projects',
  description: 'Open your saved Claimweave projects and continue reviewing their evidence trails.',
  alternates: { canonical: '/projects' },
};

export default function ProjectsPage() {
  return (
    <>
      <ProjectForm />
      <ProjectsWorkspace />
    </>
  );
}
