// @polsia:user-owned — client island for the local-first product story.
'use client';

import {
  ArrowUpRight,
  Check,
  CircleDot,
  Database,
  FileCheck2,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { apiFetch } from '@/lib/api-client';
import {
  LocalFirstDemoPayload,
  type LocalFirstScenario,
  type RouteTrace,
} from '@/lib/contracts/local-first';

function valueOrUnknown(value: number | null, suffix = '') {
  return value === null ? 'unknown' : `${value.toLocaleString()}${suffix}`;
}

function routeLabel(location: RouteTrace['computationLocation']) {
  if (location === 'deterministic-local') return 'deterministic local';
  if (location === 'trusted-server') return 'trusted server reuse';
  if (location === 'trusted-device') return 'trusted device reuse';
  if (location === 'live-model') return 'live-model fallback';
  return 'unknown';
}

function decisionLabel(decision: RouteTrace['reuseDecision']) {
  if (decision === 'hit') return 'hit';
  if (decision === 'rejected') return 'rejected';
  if (decision === 'miss') return 'miss';
  return 'unknown';
}

function TraceFields({ trace }: { trace: RouteTrace }) {
  return (
    <dl className="grid grid-cols-2 gap-x-5 gap-y-4 text-xs sm:grid-cols-3">
      <div>
        <dt className="font-mono uppercase tracking-[0.12em] text-muted-foreground">where</dt>
        <dd className="mt-1 font-medium text-foreground">
          {routeLabel(trace.computationLocation)}
        </dd>
      </div>
      <div>
        <dt className="font-mono uppercase tracking-[0.12em] text-muted-foreground">reuse</dt>
        <dd className="mt-1 font-medium text-foreground">{decisionLabel(trace.reuseDecision)}</dd>
      </div>
      <div>
        <dt className="font-mono uppercase tracking-[0.12em] text-muted-foreground">
          access / correctness
        </dt>
        <dd className="mt-1 font-medium text-foreground">{trace.accessCorrectness}</dd>
      </div>
      <div>
        <dt className="font-mono uppercase tracking-[0.12em] text-muted-foreground">model calls</dt>
        <dd className="mt-1 font-medium text-foreground">{valueOrUnknown(trace.modelCallCount)}</dd>
      </div>
      <div>
        <dt className="font-mono uppercase tracking-[0.12em] text-muted-foreground">
          provider usage
        </dt>
        <dd className="mt-1 font-medium text-foreground">
          {trace.providerUsage.totalTokens === null
            ? 'unknown'
            : `${trace.providerUsage.totalTokens.toLocaleString()} tokens`}
        </dd>
      </div>
      <div>
        <dt className="font-mono uppercase tracking-[0.12em] text-muted-foreground">
          latency / bytes
        </dt>
        <dd className="mt-1 font-medium text-foreground">
          {valueOrUnknown(trace.latencyMs, ' ms')} / {valueOrUnknown(trace.transferredBytes, ' B')}
        </dd>
      </div>
    </dl>
  );
}

function RouteScenario({ scenario }: { scenario: LocalFirstScenario }) {
  return (
    <Card className="overflow-hidden border-border/80 bg-card/90 shadow-lg shadow-brand-900/5">
      <CardHeader className="border-b border-border/80 pb-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-eyebrow">request state</p>
            <CardTitle className="mt-2 text-h3">{scenario.label}</CardTitle>
          </div>
          <Badge
            variant={scenario.trace.reuseDecision === 'hit' ? 'default' : 'outline'}
            className="shrink-0 rounded-sm"
          >
            {scenario.trace.state}
          </Badge>
        </div>
        <CardDescription className="max-w-xl leading-6">{scenario.description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 pt-6">
        <TraceFields trace={scenario.trace} />
        <div className="grid gap-2 border-t border-border pt-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            inspectable route
          </p>
          {scenario.steps.map((step) => (
            <div
              key={step.id}
              className="grid gap-3 rounded-sm border border-border/80 bg-muted/30 p-3 sm:grid-cols-[1fr_auto] sm:items-center"
            >
              <div className="flex items-center gap-3">
                <CircleDot className="size-3 shrink-0 text-primary" aria-hidden />
                <span className="text-sm font-medium">{step.label}</span>
              </div>
              <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground sm:text-right">
                {routeLabel(step.computationLocation)} · {decisionLabel(step.reuseDecision)}
              </span>
            </div>
          ))}
        </div>
        {scenario.trace.fallbackReason ? (
          <p className="border-l-2 border-primary/50 pl-3 text-xs leading-5 text-muted-foreground">
            Fallback reason:{' '}
            <span className="font-mono text-foreground">{scenario.trace.fallbackReason}</span>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function ClaimweaveLanding() {
  const [payload, setPayload] = useState<LocalFirstDemoPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiFetch('/api/local-first-demo', { schema: LocalFirstDemoPayload })
      .then((value) => {
        if (active) setPayload(value);
      })
      .catch(() => {
        if (active) setError('The route demonstration could not be loaded.');
      });
    return () => {
      active = false;
    };
  }, []);

  if (!payload) {
    return (
      <main className="container-page flex min-h-[calc(100vh-3.5rem)] items-center justify-center py-20">
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : (
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Loading the route inspector…
          </div>
        )}
      </main>
    );
  }

  const featured = payload.scenarios.filter((scenario) => scenario.id !== 'fallback');
  const fallback = payload.scenarios.find((scenario) => scenario.id === 'fallback');

  return (
    <main className="overflow-hidden">
      <section className="border-b border-border bg-gradient-to-br from-brand-100/70 via-background to-background">
        <div className="container-page grid min-h-[calc(100vh-3.5rem)] items-center gap-14 py-20 lg:grid-cols-[0.86fr_1.14fr] lg:gap-20 lg:py-24">
          <div className="max-w-2xl">
            <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              <span className="flex size-8 items-center justify-center rounded-sm bg-primary font-mono text-xs text-primary-foreground">
                CW
              </span>
              <span>Local-first evidence infrastructure</span>
            </div>
            <h1 className="mt-8 max-w-2xl text-display text-foreground">{payload.headline}</h1>
            <p className="mt-8 max-w-xl text-body-lg text-muted-foreground">
              {payload.supportingCopy}
            </p>
            <div className="mt-10 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
              <Button asChild size="lg" className="h-12 rounded-sm px-6">
                <Link href="/projects/new">
                  Inspect a source <ArrowUpRight aria-hidden />
                </Link>
              </Button>
              <Button asChild variant="link" size="lg" className="h-12 px-0 text-muted-foreground">
                <Link href="#route-demo">
                  Read the route trace{' '}
                  <span aria-hidden className="text-primary">
                    →
                  </span>
                </Link>
              </Button>
            </div>
            <div className="mt-14 grid gap-4 border-t border-border pt-5 text-sm text-muted-foreground sm:grid-cols-2">
              <span className="flex items-start gap-2">
                <Check className="mt-0.5 size-4 text-primary" aria-hidden />
                Source spans and citations stay attached.
              </span>
              <span className="flex items-start gap-2">
                <Check className="mt-0.5 size-4 text-primary" aria-hidden />
                Unknown provider measurements stay unknown.
              </span>
            </div>
          </div>
          <Card className="relative overflow-hidden border-primary/20 bg-card/95 shadow-2xl shadow-primary/10">
            <div
              className="absolute right-0 top-0 h-32 w-32 rounded-bl-full bg-primary/10"
              aria-hidden
            />
            <CardHeader className="relative border-b border-border pb-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    Route trace / provider-free
                  </p>
                  <CardTitle className="mt-3 text-h3">A request should show its work.</CardTitle>
                </div>
                <Database className="size-6 text-primary" aria-hidden />
              </div>
            </CardHeader>
            <CardContent className="relative grid gap-5 pt-6">
              <div className="grid gap-3">
                <p className="text-eyebrow">deterministic local demo</p>
                <p className="leading-7 text-muted-foreground">
                  Normalization runs first. Reuse is accepted only after source, evidence,
                  freshness, and access checks.
                </p>
              </div>
              <div className="grid gap-3 border-t border-border pt-5 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">trusted device reuse</span>
                  <Badge variant="outline" className="rounded-sm">
                    Planned
                  </Badge>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">live model fallback</span>
                  <span className="font-mono text-xs">visible boundary</span>
                </div>
              </div>
              <p className="border-t border-border pt-5 font-mono text-[10px] uppercase leading-5 tracking-[0.12em] text-muted-foreground">
                {payload.measurementNote}
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      <section id="route-demo" className="section-lg">
        <div className="container-page">
          <div className="max-w-2xl">
            <p className="text-eyebrow">The primary workflow</p>
            <h2 className="mt-5 text-h2">Three requests, three honest routes.</h2>
            <p className="mt-5 text-body-lg text-muted-foreground">
              The demo is deterministic and provider-free. It demonstrates the decision order, not a
              measured token or cost result.
            </p>
          </div>
          <div className="mt-12 grid gap-5 lg:grid-cols-3">
            {featured.map((scenario) => (
              <RouteScenario key={scenario.id} scenario={scenario} />
            ))}
          </div>
          {fallback ? (
            <div className="mt-5 grid gap-5 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
              <Card className="border-primary/20 bg-primary/[0.04]">
                <CardHeader>
                  <p className="text-eyebrow">fallback boundary</p>
                  <CardTitle className="mt-2 text-h3">Correctness beats convenience.</CardTitle>
                  <CardDescription className="leading-6">{fallback.description}</CardDescription>
                </CardHeader>
              </Card>
              <RouteScenario scenario={fallback} />
            </div>
          ) : null}
        </div>
      </section>

      <section className="border-y border-border bg-muted/35">
        <div className="container-page grid gap-10 py-20 lg:grid-cols-[0.8fr_1.2fr] lg:gap-24 lg:py-28">
          <div>
            <p className="text-eyebrow">Supporting use case</p>
            <h2 className="mt-5 text-h2">Evidence verification stays in the weave.</h2>
          </div>
          <Card className="border-border/80 bg-card/90">
            <CardContent className="grid gap-5 p-7 sm:grid-cols-[auto_1fr] sm:items-start">
              <FileCheck2 className="size-7 text-primary" aria-hidden />
              <div>
                <h3 className="text-h3">Independent passages, freshness, and contradictions.</h3>
                <p className="mt-4 leading-7 text-muted-foreground">
                  {payload.evidenceVerificationCopy}
                </p>
                <Button asChild variant="outline" className="mt-6">
                  <Link href="/projects/new">
                    Create a traceable result <ArrowUpRight aria-hidden />
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="container-page py-20 sm:py-28">
        <div className="grid gap-10 border border-primary bg-primary px-6 py-12 text-primary-foreground sm:px-12 sm:py-16 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="max-w-2xl">
            <ShieldCheck className="size-7" aria-hidden />
            <h2 className="mt-5 text-h2">Keep the evidence route inspectable.</h2>
            <p className="mt-5 max-w-xl leading-7 text-primary-foreground/80">
              Start with one public source. Claimweave keeps the extraction, provenance, immutable
              run, and validation checks together.
            </p>
          </div>
          <Button asChild variant="secondary" size="lg" className="h-12 rounded-sm px-6">
            <Link href="/projects/new">
              Start with one source <ArrowUpRight aria-hidden />
            </Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
