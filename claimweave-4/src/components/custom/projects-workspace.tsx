// @polsia:user-owned — client island for the authenticated project workspace.
'use client';

import { ArrowRight, Clock3, ExternalLink, FolderOpen, Loader2, Plus } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { apiFetch } from '@/lib/api-client';
import { ProjectList, type ProjectListItem } from '@/lib/contracts/projects';

function isUnauthorized(error: unknown) {
  return error instanceof Error && error.message.includes('(401)');
}

function statusLabel(status: string) {
  const normalized = status.trim().toLowerCase();
  if (normalized === 'complete') return 'Complete';
  if (normalized === 'processing') return 'Processing';
  if (normalized === 'failed') return 'Needs attention';
  return status;
}

function ProjectRow({ project }: { project: ProjectListItem }) {
  return (
    <Card className="lift overflow-hidden border-border/80 bg-card/90 shadow-md">
      <CardContent className="grid gap-5 p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:p-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-primary/30 bg-brand-50/60 text-primary">
              {statusLabel(project.status)}
            </Badge>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Project {project.id.slice(-8)}
            </span>
          </div>
          {project.sourceType === 'url' && project.sourceUrl ? (
            <a
              href={project.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-4 flex max-w-2xl items-start gap-2 break-all text-sm font-medium leading-6 text-foreground underline decoration-primary/30 underline-offset-4 hover:text-primary hover:decoration-primary"
            >
              <ExternalLink className="mt-1 size-4 shrink-0 text-primary" aria-hidden />
              <span>{project.sourceUrl}</span>
            </a>
          ) : (
            <p className="mt-4 flex items-center gap-2 text-sm font-medium text-foreground">
              <FolderOpen className="size-4 shrink-0 text-primary" aria-hidden />
              Pasted text
            </p>
          )}
          <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <Clock3 className="size-3.5 text-primary" aria-hidden />
            Created {new Date(project.createdAt).toLocaleString()}
          </p>
        </div>
        <Button asChild className="w-full md:w-auto">
          <Link href={`/projects/${encodeURIComponent(project.id)}`}>
            Open claims <ArrowRight aria-hidden />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export function ProjectsWorkspace() {
  const [projects, setProjects] = useState<ProjectListItem[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let active = true;
    apiFetch('/api/projects', { schema: ProjectList })
      .then((response) => {
        if (active) setProjects(response.items);
      })
      .catch((requestError: unknown) => {
        if (active) setError(requestError);
      });
    return () => {
      active = false;
    };
  }, []);

  if (projects === null && !error) {
    return (
      <main className="container-page flex min-h-[calc(100vh-3.5rem)] items-center justify-center py-section">
        <output className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
          Loading your projects…
        </output>
      </main>
    );
  }

  if (error && isUnauthorized(error)) {
    return (
      <main className="min-h-[calc(100vh-3.5rem)] bg-gradient-to-b from-brand-100/55 via-background to-background px-gutter py-section">
        <Card className="mx-auto max-w-xl border-primary/20 shadow-lg shadow-brand-900/10">
          <CardHeader>
            <p className="text-eyebrow">Private workspace</p>
            <CardTitle className="mt-2 text-h2">Sign in to see your projects.</CardTitle>
            <CardDescription className="text-body">
              Your saved evidence trails are tied to your account and stay private to you.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild size="lg">
              <Link href="/login?returnTo=%2Fprojects">
                Sign in to continue <ArrowRight aria-hidden />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (error) {
    return (
      <main className="container-page flex min-h-[calc(100vh-3.5rem)] flex-col items-start justify-center gap-4 py-section">
        <p className="text-eyebrow">Workspace unavailable</p>
        <h1 className="text-h2">Your projects could not be loaded.</h1>
        <p role="alert" className="max-w-md text-muted-foreground">
          Please refresh and try again. Your saved projects have not been changed.
        </p>
        <Button asChild variant="outline">
          <Link href="/projects">Try again</Link>
        </Button>
      </main>
    );
  }

  const hasProjects = projects !== null && projects.length > 0;
  return (
    <main className="min-h-[calc(100vh-3.5rem)] bg-gradient-to-b from-brand-100/45 via-background to-background px-gutter py-section">
      <div className="container-page">
        <div className="flex flex-col gap-7 border-b border-border pb-9 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <p className="text-eyebrow">Workspace / saved evidence</p>
            <h1 className="mt-4 text-h1">Your projects, ready to reopen.</h1>
            <p className="mt-4 text-body-lg text-muted-foreground">
              Pick up an extraction where you left it, or bring another public source into the
              evidence trail.
            </p>
          </div>
          <Button asChild size="lg" className="w-full shrink-0 md:w-auto">
            <Link href="/projects/new">
              <Plus aria-hidden /> New project
            </Link>
          </Button>
        </div>

        {hasProjects ? (
          <section aria-labelledby="project-list-heading" className="mt-9">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 id="project-list-heading" className="text-h3">
                  Saved sources
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {projects.length} {projects.length === 1 ? 'project' : 'projects'} in your
                  workspace
                </p>
              </div>
              <FolderOpen className="size-6 text-primary" aria-hidden />
            </div>
            <Separator className="my-5" />
            <div className="grid gap-4">
              {projects.map((project) => (
                <ProjectRow key={project.id} project={project} />
              ))}
            </div>
          </section>
        ) : (
          <Card className="mt-10 border-dashed border-primary/30 bg-card/75 shadow-lg">
            <CardContent className="flex flex-col items-start gap-5 p-6 md:p-8">
              <div className="flex size-12 items-center justify-center rounded-full bg-brand-100 text-primary">
                <FolderOpen className="size-5" aria-hidden />
              </div>
              <div>
                <h2 className="text-h3">No saved projects yet.</h2>
                <p className="mt-2 max-w-lg text-muted-foreground">
                  Start with a public URL or pasted text and Claimweave will keep the source,
                  status, and evidence trail here for your next visit.
                </p>
              </div>
              <Button asChild size="lg">
                <Link href="/projects/new">
                  Start your first project <ArrowRight aria-hidden />
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
