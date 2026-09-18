// @polsia:user-owned — metadata-only shell for the new project flow.
import type { Metadata } from 'next';
import { ProjectForm } from './project-form';

export const metadata: Metadata = {
  title: 'Extract claims',
  description:
    'Try a guided demo or submit one public URL and turn its evidence into atomic, citation-ready claims.',
  alternates: { canonical: '/projects/new' },
};

export default function NewProjectPage() {
  return <ProjectForm />;
}
