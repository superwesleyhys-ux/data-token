// @polsia:user-owned — interactive URL submission island.
'use client';

import { ArrowRight, Loader2, ScanSearch, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch } from '@/lib/api-client';
import { useSession } from '@/lib/auth-client';
import { ProjectCreate, ProjectIntakeResponse } from '@/lib/contracts/projects';
import { demoProject } from '@/lib/demo-project';
import { applyServerErrors } from '@/lib/forms';
import { getVisitorId } from '@/lib/visitor-id';

export function ProjectForm() {
  const router = useRouter();
  const { data: session, isPending: sessionPending } = useSession();
  const [mode, setMode] = useState<'url' | 'text'>('url');
  const [extractionError, setExtractionError] = useState<string | null>(null);
  const [demoSubmitting, setDemoSubmitting] = useState(false);
  const form = useForm<{ url: string; text: string }>({
    defaultValues: { url: '', text: '' },
  });

  const submitProject = async (values: ProjectCreate, entryPoint: 'manual' | 'demo') => {
    setExtractionError(null);
    if (entryPoint === 'demo') setDemoSubmitting(true);
    const visitorId = getVisitorId();
    try {
      const result = await apiFetch('/api/projects', {
        method: 'POST',
        body: JSON.stringify(values),
        headers: {
          ...(visitorId ? { 'X-Claimweave-Visitor-Id': visitorId } : {}),
          'X-Claimweave-Entry-Point': entryPoint,
        },
        schema: ProjectIntakeResponse,
      });
      toast.success('Project created. Processing has started.');
      router.push(`/projects/${result.projectId}`);
    } catch (error) {
      const applied = error instanceof Error && applyServerErrors(error.cause, form.setError);
      if (!applied) {
        const cause = error instanceof Error && error.cause;
        const message =
          typeof cause === 'object' &&
          cause !== null &&
          'error' in cause &&
          typeof cause.error === 'string'
            ? cause.error
            : 'We could not start that project. Please try again.';
        setExtractionError(message);
        toast.error('Project intake did not complete.');
      }
    } finally {
      if (entryPoint === 'demo') setDemoSubmitting(false);
    }
  };

  const onSubmit = form.handleSubmit((values) => {
    const candidate = mode === 'url' ? { url: values.url } : { text: values.text };
    const parsed = ProjectCreate.safeParse(candidate);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === 'url' || field === 'text') form.setError(field, { message: issue.message });
      }
      return;
    }
    void submitProject(parsed.data, 'manual');
  });
  const isSubmitting = form.formState.isSubmitting || demoSubmitting;
  const textLength = form.watch('text').trim().length;
  const onDemoSubmit = () => {
    if (isSubmitting || demoSubmitting) return;
    setMode('url');
    form.setValue('url', demoProject.url, { shouldValidate: true });
    void submitProject({ url: demoProject.url }, demoProject.entryPoint);
  };

  if (sessionPending) {
    return (
      <main className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center px-gutter py-section">
        <output className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
          Checking your workspace access…
        </output>
      </main>
    );
  }

  if (!session?.user) {
    return (
      <main className="min-h-[calc(100vh-3.5rem)] bg-gradient-to-b from-brand-100/60 via-background to-background px-gutter py-section">
        <Card className="mx-auto max-w-xl border-primary/20 shadow-xl shadow-brand-900/10">
          <CardHeader>
            <p className="text-eyebrow">Private intake</p>
            <CardTitle className="mt-2 text-h2">Sign in before you add a source.</CardTitle>
            <CardDescription className="text-body">
              Projects and their evidence trails belong to your account. Sign in to start a URL or
              pasted-text intake.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild size="lg">
              <Link href="/login?returnTo=%2Fprojects">
                Sign in to start <ArrowRight aria-hidden />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100vh-3.5rem)] bg-gradient-to-b from-brand-100/60 via-background to-background px-gutter py-16 sm:py-24">
      <div className="mx-auto grid w-full max-w-5xl gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
        <div className="pt-2">
          <p className="text-eyebrow">New project / 01</p>
          <h1 className="mt-5 text-display max-w-xl">Start with one source.</h1>
          <p className="mt-6 max-w-md text-body-lg text-muted-foreground">
            Claimweave reads a public page, separates its atomic statements, and keeps the evidence
            attached to every result. Deterministic intake comes first, then validated trusted
            server reuse, with live-model fallback only when needed.
          </p>
          <div className="mt-10 flex items-center gap-3 border-l-2 border-primary pl-4 text-sm text-muted-foreground">
            <ScanSearch className="size-5 shrink-0 text-primary" aria-hidden />
            <span>Public HTML and plain-text pages up to 1.5 MB.</span>
          </div>
        </div>

        <Card className="border-border/80 bg-card/90 shadow-xl shadow-brand-900/10">
          <CardHeader className="border-b border-border">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Source intake
            </p>
            <CardTitle className="mt-2 text-h3">What should we inspect?</CardTitle>
            <CardDescription>
              Submit one public URL or paste the source text directly.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-7">
            <Card className="mb-7 border-primary/25 bg-brand-50/60 shadow-sm">
              <CardHeader className="gap-3 pb-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-eyebrow">Guided first project</p>
                  <Badge variant="outline" className="shrink-0 border-primary/30 text-primary">
                    <Sparkles aria-hidden /> Demo
                  </Badge>
                </div>
                <CardTitle className="text-h4">See the full evidence trail</CardTitle>
                <CardDescription>{demoProject.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 pt-0">
                <div className="rounded-sm border border-primary/20 bg-background/75 p-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                    Sample URL
                  </p>
                  <p className="mt-2 break-all text-sm leading-6 text-foreground">
                    {demoProject.url}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-11 w-full justify-between"
                  onClick={onDemoSubmit}
                  disabled={isSubmitting}
                >
                  <span>{demoSubmitting ? 'Reading the sample…' : demoProject.label}</span>
                  {demoSubmitting ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <ArrowRight aria-hidden />
                  )}
                </Button>
                <p className="text-xs leading-5 text-muted-foreground">
                  You’ll see extracted claim text, the exact source span with offsets, and citation
                  links.
                </p>
              </CardContent>
            </Card>
            <Form {...form}>
              <form onSubmit={onSubmit} className="space-y-6" noValidate>
                <div>
                  <Label>Source type</Label>
                  <RadioGroup
                    value={mode}
                    onValueChange={(value) => {
                      if (value !== 'url' && value !== 'text') return;
                      setMode(value);
                      form.clearErrors();
                      setExtractionError(null);
                    }}
                    className="mt-3 grid gap-3 sm:grid-cols-2"
                    aria-label="Choose a source type"
                  >
                    <label
                      htmlFor="source-mode-url"
                      className="flex cursor-pointer items-start gap-3 rounded-sm border border-border bg-background/60 p-4 transition-colors hover:border-primary/50 has-[:checked]:border-primary has-[:checked]:bg-brand-50/70"
                    >
                      <RadioGroupItem value="url" id="source-mode-url" disabled={isSubmitting} />
                      <span>
                        <span className="block text-sm font-medium">Public URL</span>
                        <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                          Fetch a readable public page.
                        </span>
                      </span>
                    </label>
                    <label
                      htmlFor="source-mode-text"
                      className="flex cursor-pointer items-start gap-3 rounded-sm border border-border bg-background/60 p-4 transition-colors hover:border-primary/50 has-[:checked]:border-primary has-[:checked]:bg-brand-50/70"
                    >
                      <RadioGroupItem value="text" id="source-mode-text" disabled={isSubmitting} />
                      <span>
                        <span className="block text-sm font-medium">Pasted text</span>
                        <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                          Keep the exact passage as your source.
                        </span>
                      </span>
                    </label>
                  </RadioGroup>
                </div>

                {mode === 'url' ? (
                  <FormField
                    control={form.control}
                    name="url"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Source URL</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="url"
                            inputMode="url"
                            autoComplete="url"
                            placeholder="https://example.com/article"
                            className="h-12 bg-background/70 text-base"
                            disabled={isSubmitting}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ) : (
                  <FormField
                    control={form.control}
                    name="text"
                    render={({ field }) => (
                      <FormItem>
                        <div className="flex items-center justify-between gap-4">
                          <FormLabel htmlFor="source-text">Source text</FormLabel>
                          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                            {textLength.toLocaleString()} / 80,000
                          </span>
                        </div>
                        <FormControl>
                          <Textarea
                            {...field}
                            id="source-text"
                            placeholder="Paste the passage you want Claimweave to inspect…"
                            className="min-h-64 resize-y bg-background/70 text-base leading-7"
                            disabled={isSubmitting}
                            aria-describedby="source-text-help"
                          />
                        </FormControl>
                        <p
                          id="source-text-help"
                          className="text-xs leading-5 text-muted-foreground"
                        >
                          Use at least 40 characters. Leading and trailing whitespace is trimmed;
                          internal spacing is preserved.
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
                {extractionError ? (
                  <p
                    role="alert"
                    className="border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
                  >
                    {extractionError}
                  </p>
                ) : null}
                <Button
                  type="submit"
                  size="lg"
                  className="h-12 w-full justify-between"
                  disabled={isSubmitting}
                >
                  <span>{isSubmitting ? 'Reading and extracting…' : 'Extract claims'}</span>
                  {isSubmitting ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <ArrowRight aria-hidden />
                  )}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
