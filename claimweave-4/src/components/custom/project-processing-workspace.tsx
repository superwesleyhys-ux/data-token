// @polsia:user-owned — client island for project processing and status states.
'use client';

import { AlertCircle, ArrowRight, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { apiFetch } from '@/lib/api-client';
import {
  ProjectWorkspaceStatus,
  type ProjectWorkspaceStatus as ProjectWorkspaceStatusData,
} from '@/lib/contracts/projects';

function apiErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  const cause = error.cause;
  if (typeof cause === 'object' && cause !== null && 'error' in cause) {
    const message = cause.error;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
}

function errorStatus(error: unknown) {
  if (error instanceof Error) {
    const match = error.message.match(/\((\d{3})\)$/);
    return match?.[1] ?? null;
  }
  return null;
}

function statusLabel(status: ProjectWorkspaceStatusData['status']) {
  if (status === 'complete') return 'Complete';
  if (status === 'failed') return 'Needs attention';
  return 'Processing';
}

export function ProjectProcessingWorkspace({
  projectId,
  children,
}: {
  projectId: string;
  children: ReactNode;
}) {
  const [status, setStatus] = useState<ProjectWorkspaceStatusData | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [retrying, setRetrying] = useState(false);
  const processStarted = useRef(false);

  const loadStatus = useCallback(async () => {
    const nextStatus = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}`, {
      schema: ProjectWorkspaceStatus,
    });
    setStatus(nextStatus);
    setError(null);
    return nextStatus;
  }, [projectId]);

  const processProject = useCallback(
    async (retry = false) => {
      try {
        const nextStatus = await apiFetch(
          `/api/projects/${encodeURIComponent(projectId)}/process`,
          {
            method: 'POST',
            body: JSON.stringify({ retry }),
            schema: ProjectWorkspaceStatus,
          },
        );
        setStatus(nextStatus);
        setError(null);
      } catch (processError) {
        if (errorStatus(processError) === '409') {
          return;
        }
        try {
          await loadStatus();
        } catch (statusError) {
          setError(statusError);
        }
        if (errorStatus(processError) !== '422') {
          setError(processError);
        }
      }
    },
    [loadStatus, projectId],
  );

  useEffect(() => {
    let active = true;
    void loadStatus()
      .then(() => undefined)
      .catch((requestError: unknown) => {
        if (active) setError(requestError);
      });
    return () => {
      active = false;
    };
  }, [loadStatus]);

  useEffect(() => {
    if (status?.status !== 'processing' || processStarted.current) return;
    const start = window.setTimeout(() => {
      processStarted.current = true;
      void processProject();
    }, 1_000);
    return () => window.clearTimeout(start);
  }, [processProject, status?.status]);

  useEffect(() => {
    if (status?.status !== 'processing') return;
    const poll = window.setInterval(() => {
      void loadStatus().catch((requestError: unknown) => setError(requestError));
    }, 1500);
    return () => window.clearInterval(poll);
  }, [loadStatus, status?.status]);

  const retry = async () => {
    setRetrying(true);
    processStarted.current = true;
    setStatus((current) => (current ? { ...current, status: 'processing', error: null } : current));
    await processProject(true);
    setRetrying(false);
  };

  if (error && errorStatus(error) === '401') {
    return (
      <main className="container-page flex min-h-[calc(100vh-3.5rem)] items-center justify-center py-section">
        <Card className="w-full max-w-xl border-primary/20 shadow-lg">
          <CardHeader>
            <p className="text-eyebrow">Private workspace</p>
            <CardTitle className="mt-2 text-h2">Sign in to open this project.</CardTitle>
          </CardHeader>
          <CardContent>
            <Button asChild size="lg">
              <Link href={`/login?returnTo=${encodeURIComponent(`/projects/${projectId}`)}`}>
                Sign in to continue <ArrowRight aria-hidden />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (error && errorStatus(error) === '404') {
    return (
      <main className="container-page flex min-h-[calc(100vh-3.5rem)] items-center justify-center py-section">
        <Card className="w-full max-w-xl border-border shadow-lg">
          <CardHeader>
            <p className="text-eyebrow">Project unavailable</p>
            <CardTitle className="mt-2 text-h2">We couldn’t find that project.</CardTitle>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/projects">Back to projects</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (error) {
    return (
      <main className="container-page flex min-h-[calc(100vh-3.5rem)] items-center justify-center py-section">
        <Alert variant="destructive" className="max-w-xl">
          <AlertCircle aria-hidden />
          <AlertTitle>Workspace unavailable</AlertTitle>
          <AlertDescription>
            {apiErrorMessage(error, 'The project status could not be loaded. Please try again.')}
          </AlertDescription>
        </Alert>
      </main>
    );
  }

  if (!status) {
    return (
      <main className="container-page flex min-h-[calc(100vh-3.5rem)] items-center justify-center py-section">
        <output className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
          Opening your project…
        </output>
      </main>
    );
  }

  if (status.status === 'complete') return children;

  if (status.status === 'failed') {
    return (
      <main className="min-h-[calc(100vh-3.5rem)] bg-gradient-to-b from-brand-100/45 via-background to-background px-gutter py-section">
        <Card className="mx-auto max-w-2xl border-destructive/30 shadow-xl shadow-brand-900/10">
          <CardHeader>
            <div className="flex items-center gap-3 text-destructive">
              <AlertCircle className="size-5" aria-hidden />
              <p className="text-eyebrow text-destructive">{statusLabel(status.status)}</p>
            </div>
            <CardTitle className="mt-3 text-h2">This source needs another pass.</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <p
              role="alert"
              className="border border-destructive/20 bg-destructive/5 p-4 text-sm leading-6"
            >
              {status.error ?? 'Claim extraction did not finish. Try processing the source again.'}
            </p>
            <Button type="button" size="lg" onClick={retry} disabled={retrying}>
              {retrying ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <RefreshCw aria-hidden />
              )}
              {retrying ? 'Retrying…' : 'Retry processing'}
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100vh-3.5rem)] bg-gradient-to-b from-brand-100/45 via-background to-background px-gutter py-section">
      <div className="container-page">
        <Card className="mx-auto max-w-3xl overflow-hidden border-primary/20 shadow-xl shadow-brand-900/10">
          <CardHeader className="border-b border-border bg-card/80">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-eyebrow">Project workspace</p>
              <span className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-brand-50/70 px-3 py-1 text-xs font-medium text-primary">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                Processing
              </span>
            </div>
            <h1 className="mt-4 text-h1">Your evidence trail is taking shape.</h1>
          </CardHeader>
          <CardContent className="space-y-7 p-6 md:p-9">
            <div aria-live="polite" className="space-y-3">
              <Progress value={58} aria-label="Project processing progress" />
              <div className="flex items-start justify-between gap-4 text-sm">
                <p className="text-muted-foreground">
                  Claimweave is reading your{' '}
                  {status.sourceType === 'url' ? 'public URL' : 'pasted text'}, validating source
                  spans, and preparing claims.
                </p>
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-primary/70" aria-hidden />
              </div>
            </div>
            <div className="grid gap-3 border-l-2 border-primary/40 pl-4 text-sm text-muted-foreground">
              <p>Next: the workspace will open automatically when the claims are ready.</p>
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-primary">
                Project {projectId.slice(-8)}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
