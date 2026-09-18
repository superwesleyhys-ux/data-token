// @polsia:user-owned — client island for the protected processing history.
'use client';

import { ArrowLeft, ArrowRight, Clock3, ExternalLink, History, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { apiFetch } from '@/lib/api-client';
import {
  ProjectHistory,
  type ProjectHistoryChange,
  type ProjectHistoryComparison,
  type ProjectHistoryRevision,
  type ProjectHistorySnapshot,
  type ProjectHistoryVersion,
} from '@/lib/contracts/project-history';

function isStatus(error: unknown, status: number) {
  return error instanceof Error && error.message.includes(`(${status})`);
}

function routeLabel(route: ProjectHistoryVersion['processingRoute']) {
  if (route === 'trusted-server-reuse') return 'Trusted server reuse';
  if (route === 'trusted-device-reuse') return 'Trusted device reuse';
  if (route === 'model-fallback') return 'Live-model fallback';
  return 'Legacy route unknown';
}

function statusLabel(status: string) {
  return status.replaceAll('-', ' ');
}

function SnapshotDetails({ snapshot, label }: { snapshot: ProjectHistorySnapshot; label: string }) {
  return (
    <div className="grid gap-2 rounded-sm border border-border/70 bg-background/65 p-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-primary">{label}</p>
      <p className="break-words text-sm font-medium leading-6 text-foreground">{snapshot.text}</p>
      <p className="break-words border-l-2 border-primary/40 pl-3 text-xs leading-5 text-muted-foreground">
        “{snapshot.sourceQuote}”
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
        <span>
          span {snapshot.sourceStart}–{snapshot.sourceEnd}
        </span>
        <span>
          {snapshot.citationLinks.length} citation{snapshot.citationLinks.length === 1 ? '' : 's'}
        </span>
      </div>
    </div>
  );
}

function ChangeRow({
  change,
  kind,
}: {
  change: ProjectHistoryChange & {
    claimsHref: string;
    currentClaimHref: string | null;
  };
  kind: 'added' | 'removed' | 'changed';
}) {
  return (
    <Card className="border-border/80 bg-card/90 shadow-sm">
      <CardContent className="grid gap-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Source span {change.sourceStart}–{change.sourceEnd}
            </p>
            <p className="mt-1 text-sm font-medium capitalize text-foreground">{kind} claim</p>
          </div>
          <Badge
            variant={kind === 'changed' ? 'secondary' : 'outline'}
            className={kind === 'added' ? 'border-primary/30 text-primary' : undefined}
          >
            {kind}
          </Badge>
        </div>
        {kind === 'changed' && change.previous && change.current ? (
          <div className="grid gap-3 lg:grid-cols-2">
            <SnapshotDetails snapshot={change.previous} label="Previous" />
            <SnapshotDetails snapshot={change.current} label="Current" />
          </div>
        ) : (
          <SnapshotDetails
            snapshot={(change.current ?? change.previous) as ProjectHistorySnapshot}
            label={kind === 'added' ? 'Current claim' : 'Previous claim'}
          />
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <Button asChild variant="ghost" size="sm" className="h-auto px-0 text-primary">
            <Link href={change.claimsHref}>
              Open claims section <ArrowRight aria-hidden />
            </Link>
          </Button>
          {change.currentClaimHref && kind !== 'removed' ? (
            <Button asChild variant="link" size="sm" className="h-auto px-0">
              <Link href={change.currentClaimHref}>Jump to current claim</Link>
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function ChangeGroup({
  title,
  description,
  items,
  kind,
}: {
  title: string;
  description: string;
  items: ProjectHistoryComparison['added'];
  kind: 'added' | 'removed' | 'changed';
}) {
  return (
    <section aria-labelledby={`${kind}-claims-heading`} className="grid gap-3">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h3 id={`${kind}-claims-heading`} className="text-h4">
            {title}
          </h3>
          <Badge variant="outline">{items.length}</Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {items.length > 0 ? (
        <div className="grid gap-3">
          {items.map((item) => (
            <ChangeRow key={`${kind}-${item.key}`} change={item} kind={kind} />
          ))}
        </div>
      ) : (
        <Card className="border-dashed bg-muted/20">
          <CardContent className="p-4 text-sm text-muted-foreground">
            None in this comparison.
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function VersionCard({ version }: { version: ProjectHistoryVersion }) {
  return (
    <Card className="border-border/80 bg-card/85 shadow-sm">
      <CardContent className="grid gap-4 p-5 sm:grid-cols-[auto_1fr_auto] sm:items-center">
        <div className="flex size-11 items-center justify-center rounded-sm bg-primary text-lg font-semibold text-primary-foreground">
          {version.version}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h3 className="font-medium text-foreground">Version {version.version}</h3>
            <Badge variant="outline" className="font-mono text-[10px]">
              {statusLabel(version.evidenceState)}
            </Badge>
          </div>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Clock3 className="size-3.5" aria-hidden />{' '}
              <time dateTime={version.createdAt}>
                {new Date(version.createdAt).toLocaleString()}
              </time>
            </span>
            <span>
              {version.claimCount} {version.claimCount === 1 ? 'claim' : 'claims'}
            </span>
          </p>
          <p className="mt-2 break-all text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Document identity:</span>{' '}
            {version.documentId && version.documentKind ? (
              <>
                {version.documentKind} · {version.documentId}
              </>
            ) : (
              'legacy document identity unavailable'
            )}
          </p>
        </div>
        <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground sm:text-right">
          {routeLabel(version.processingRoute)}
        </p>
      </CardContent>
    </Card>
  );
}

function ExternalUrl({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={`${label}: ${href}`}
      className="inline-flex min-w-0 items-start gap-2 text-sm text-primary underline decoration-primary/30 underline-offset-4 hover:decoration-primary"
    >
      <ExternalLink className="mt-0.5 size-3 shrink-0" aria-hidden />
      <span className="break-all">{href}</span>
    </a>
  );
}

function SnapshotValue({
  snapshot,
  label,
}: {
  snapshot: NonNullable<ProjectHistoryRevision['claims'][number]['previous']>;
  label: string;
}) {
  return (
    <div className="grid min-w-0 gap-3 rounded-sm border border-border/70 bg-background/65 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-eyebrow text-primary">{label}</p>
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
          {snapshot.sourceStart}–{snapshot.sourceEnd}
        </span>
      </div>
      <p className="break-words text-sm font-medium leading-6 text-foreground">{snapshot.text}</p>
      <blockquote className="break-words border-l-2 border-primary/40 pl-3 text-xs leading-5 text-muted-foreground">
        “{snapshot.sourceQuote}”
      </blockquote>
      <div className="grid min-w-0 gap-3 border-t border-border/60 pt-3">
        <div className="grid min-w-0 gap-1">
          <p className="text-xs font-medium text-muted-foreground">Source URL</p>
          {snapshot.sourceUrl ? (
            <ExternalUrl href={snapshot.sourceUrl} label="Source URL" />
          ) : (
            <p className="text-sm text-muted-foreground">No external source URL.</p>
          )}
        </div>
        <div className="grid min-w-0 gap-1">
          <p className="text-xs font-medium text-muted-foreground">Citation URLs</p>
          {snapshot.citationLinks.length > 0 ? (
            <div className="grid min-w-0 gap-2">
              {snapshot.citationLinks.map((link) => (
                <ExternalUrl key={link} href={link} label="Citation URL" />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No citation URLs.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function ClaimRevisionDetail({ claim }: { claim: ProjectHistoryRevision['claims'][number] }) {
  const kind = claim.previous && claim.current ? 'Changed' : claim.current ? 'Added' : 'Removed';
  return (
    <Card className="min-w-0 border-border/80 bg-card/90 shadow-sm">
      <CardContent className="grid min-w-0 gap-4 p-4 sm:p-5">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-eyebrow">{claim.documentKind} claim</p>
            <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
              {claim.sourceDocumentId} · source range {claim.sourceStart}–{claim.sourceEnd}
            </p>
          </div>
          <Badge variant={kind === 'Changed' ? 'secondary' : 'outline'}>{kind}</Badge>
        </div>
        <div className="grid min-w-0 gap-3 lg:grid-cols-2">
          {claim.previous ? <SnapshotValue snapshot={claim.previous} label="Previous" /> : null}
          {claim.current ? (
            <SnapshotValue snapshot={claim.current} label={claim.previous ? 'Current' : 'Added'} />
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function DocumentValue({
  value,
  label,
}: {
  value: NonNullable<ProjectHistoryRevision['documents'][number]['previous']>;
  label: string;
}) {
  return (
    <div className="grid min-w-0 gap-3 rounded-sm border border-border/70 bg-background/65 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-eyebrow text-primary">{label}</p>
        <Badge variant="outline">{value.status}</Badge>
      </div>
      <p className="break-all font-mono text-xs text-muted-foreground">{value.id}</p>
      <div className="grid min-w-0 gap-2 text-sm">
        <p>
          <span className="font-medium text-foreground">Route:</span>{' '}
          <span className="text-muted-foreground">{value.processingRoute ?? 'Unknown'}</span>
        </p>
        <p className="break-words text-muted-foreground">
          {value.normalizedContent ?? value.documentText ?? 'No text snapshot'}
        </p>
      </div>
      <div className="grid min-w-0 gap-1 border-t border-border/60 pt-3">
        <p className="text-xs font-medium text-muted-foreground">Document URL</p>
        {value.url ? (
          <ExternalUrl href={value.url} label="Document URL" />
        ) : (
          <p className="text-sm text-muted-foreground">No external document URL.</p>
        )}
      </div>
    </div>
  );
}

function DocumentRevisionDetail({ documents }: { documents: ProjectHistoryRevision['documents'] }) {
  return (
    <section aria-labelledby="document-details-heading" className="grid min-w-0 gap-3">
      <div>
        <h3 id="document-details-heading" className="text-h4">
          Document context
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          The persisted document values attached to this revision.
        </p>
      </div>
      {documents.length > 0 ? (
        <div className="grid min-w-0 gap-3">
          {documents.map((document) => (
            <Card key={document.id} className="min-w-0 border-border/80 bg-card/90 shadow-sm">
              <CardContent className="grid min-w-0 gap-3 p-4 sm:p-5">
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-eyebrow">{document.documentKind} document</p>
                    <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                      {document.documentId}
                    </p>
                  </div>
                  <Badge variant="outline">
                    {document.current ? (document.previous ? 'changed' : 'added') : 'removed'}
                  </Badge>
                </div>
                <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                  {document.previous ? (
                    <DocumentValue value={document.previous} label="Previous" />
                  ) : null}
                  {document.current ? (
                    <DocumentValue value={document.current} label="Current" />
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="border-dashed bg-muted/20">
          <CardContent className="p-4 text-sm text-muted-foreground">
            No document values changed in this revision.
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function EvidenceValue({
  value,
  label,
  sourceUrl,
}: {
  value: NonNullable<ProjectHistoryRevision['evidence'][number]['previous']>;
  label: string;
  sourceUrl: string | null;
}) {
  return (
    <div className="grid min-w-0 gap-3 rounded-sm border border-border/70 bg-background/65 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-eyebrow text-primary">{label}</p>
        <Badge variant="outline">{statusLabel(value.classification)}</Badge>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span>Freshness: {statusLabel(value.freshness)}</span>
        <span>Error: {value.errorState ?? 'None'}</span>
      </div>
      {sourceUrl ? (
        <div className="grid min-w-0 gap-1">
          <p className="text-xs font-medium text-muted-foreground">Evidence source URL</p>
          <ExternalUrl href={sourceUrl} label="Evidence source URL" />
        </div>
      ) : null}
      <div className="grid min-w-0 gap-3 border-t border-border/60 pt-3">
        <p className="text-xs font-medium text-muted-foreground">Evidence excerpts</p>
        {value.excerpts.length > 0 ? (
          value.excerpts.map((excerpt) => (
            <div key={excerpt.id} className="grid min-w-0 gap-2 border-l-2 border-primary/40 pl-3">
              <p className="break-words text-sm font-medium">{excerpt.documentTitle}</p>
              <p className="text-xs capitalize text-muted-foreground">{excerpt.role}</p>
              <p className="break-words text-sm leading-6 text-muted-foreground">
                “{excerpt.text}”
              </p>
              <p className="text-xs text-muted-foreground">
                Evidence date:{' '}
                {excerpt.evidenceDate
                  ? new Date(excerpt.evidenceDate).toLocaleDateString()
                  : 'Undated'}
              </p>
              {excerpt.sourceUrl ? (
                <ExternalUrl href={excerpt.sourceUrl} label="Evidence excerpt URL" />
              ) : null}
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">No displayed excerpt.</p>
        )}
      </div>
    </div>
  );
}

function EvidenceRevisionDetail({ evidence }: { evidence: ProjectHistoryRevision['evidence'] }) {
  return (
    <section aria-labelledby="evidence-details-heading" className="grid min-w-0 gap-3">
      <div>
        <h3 id="evidence-details-heading" className="text-h4">
          Verification evidence
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Previous and current evidence values are kept side by side for this revision.
        </p>
      </div>
      {evidence.length > 0 ? (
        <div className="grid min-w-0 gap-3">
          {evidence.map((item) => (
            <Card key={item.id} className="min-w-0 border-border/80 bg-card/90 shadow-sm">
              <CardContent className="grid min-w-0 gap-4 p-4 sm:p-5">
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                  <p className="break-all font-mono text-xs text-muted-foreground">
                    Claim {item.claimId} · {item.evidenceDocumentId ?? 'no evidence document'}
                  </p>
                  <span className="text-xs text-muted-foreground">
                    {item.evidenceDate
                      ? new Date(item.evidenceDate).toLocaleDateString()
                      : 'Undated'}
                  </span>
                </div>
                <div className="grid min-w-0 gap-3 lg:grid-cols-2">
                  {item.previous ? (
                    <EvidenceValue
                      value={item.previous}
                      label={item.current ? 'Previous' : 'Removed'}
                      sourceUrl={item.sourceUrl}
                    />
                  ) : null}
                  {item.current ? (
                    <EvidenceValue
                      value={item.current}
                      label={item.previous ? 'Current' : 'Added'}
                      sourceUrl={item.sourceUrl}
                    />
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="border-dashed bg-muted/20">
          <CardContent className="p-4 text-sm text-muted-foreground">
            No verification evidence changes in this revision.
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function SelectedRevisionPanel({ revision }: { revision: ProjectHistoryRevision }) {
  const changeCounts = {
    documents: revision.documents.length,
    claims: revision.claims.length,
    evidence: revision.evidence.length,
  };
  const changedCount = changeCounts.documents + changeCounts.claims + changeCounts.evidence;
  return (
    <Card id="selected-revision-panel" className="border-primary/20 bg-card/85 shadow-md">
      <CardHeader className="gap-3 border-b border-border/70 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-eyebrow">Revision {revision.version}</p>
            <CardTitle className="mt-1 capitalize">{revision.eventKind} change set</CardTitle>
          </div>
          <Badge variant="secondary">
            {changedCount} {changedCount === 1 ? 'change' : 'changes'}
          </Badge>
        </div>
        <CardDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1.5">
            <Clock3 className="size-3.5" aria-hidden />{' '}
            <time dateTime={revision.createdAt}>
              {new Date(revision.createdAt).toLocaleString()}
            </time>
          </span>
          <span>Owner-scoped snapshot</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 p-5">
        <div className="flex flex-wrap gap-2 border-b border-border/70 pb-4 text-xs text-muted-foreground">
          <Badge variant="outline">
            {changeCounts.documents} {changeCounts.documents === 1 ? 'document' : 'documents'}
          </Badge>
          <Badge variant="outline">
            {changeCounts.claims} {changeCounts.claims === 1 ? 'claim' : 'claims'}
          </Badge>
          <Badge variant="outline">
            {changeCounts.evidence} {changeCounts.evidence === 1 ? 'evidence' : 'evidence items'}
          </Badge>
        </div>
        <DocumentRevisionDetail documents={revision.documents} />
        <section aria-labelledby="claim-details-heading" className="grid min-w-0 gap-3">
          <div>
            <h3 id="claim-details-heading" className="text-h4">
              Claim changes
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Exact claim snapshots preserved by this revision.
            </p>
          </div>
          {revision.claims.length > 0 ? (
            <div className="grid min-w-0 gap-3">
              {revision.claims.map((claim) => (
                <ClaimRevisionDetail key={claim.id} claim={claim} />
              ))}
            </div>
          ) : (
            <Card className="border-dashed bg-muted/20">
              <CardContent className="p-4 text-sm text-muted-foreground">
                No claim changes in this document-only revision.
              </CardContent>
            </Card>
          )}
        </section>
        <EvidenceRevisionDetail evidence={revision.evidence} />
      </CardContent>
    </Card>
  );
}

function RevisionSelector({
  revision,
  selected,
  onSelect,
}: {
  revision: ProjectHistoryRevision;
  selected: boolean;
  onSelect: () => void;
}) {
  const changeCounts = {
    documents: revision.documents.length,
    claims: revision.claims.length,
    evidence: revision.evidence.length,
  };
  const changedCount = changeCounts.documents + changeCounts.claims + changeCounts.evidence;
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-controls="selected-revision-panel"
      onClick={onSelect}
      className={`grid w-full min-w-0 gap-4 rounded-xl border p-5 text-left shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:grid-cols-[1fr_auto] sm:items-center ${
        selected
          ? 'border-primary bg-primary/[0.07] shadow-md'
          : 'border-border/80 bg-card/85 hover:border-primary/40 hover:bg-card'
      }`}
    >
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-3">
          <span className="text-eyebrow">Revision {revision.version}</span>
          <Badge variant={selected ? 'secondary' : 'outline'}>
            {selected ? 'Selected' : `${changedCount} ${changedCount === 1 ? 'change' : 'changes'}`}
          </Badge>
        </span>
        <span className="mt-2 block text-sm font-medium capitalize text-foreground">
          {revision.eventKind} change set
        </span>
        <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Clock3 className="size-3.5" aria-hidden />
            <time dateTime={revision.createdAt}>
              {new Date(revision.createdAt).toLocaleString()}
            </time>
          </span>
          <span>Owner-scoped snapshot</span>
        </span>
      </span>
      <span className="flex flex-wrap gap-2 sm:justify-end">
        <Badge variant="outline">
          {changeCounts.documents} {changeCounts.documents === 1 ? 'document' : 'documents'}
        </Badge>
        <Badge variant="outline">
          {changeCounts.claims} {changeCounts.claims === 1 ? 'claim' : 'claims'}
        </Badge>
        <Badge variant="outline">
          {changeCounts.evidence} {changeCounts.evidence === 1 ? 'evidence' : 'evidence items'}
        </Badge>
      </span>
    </button>
  );
}

export function ProjectHistoryView({ projectId }: { projectId: string }) {
  const [history, setHistory] = useState<ReturnType<typeof ProjectHistory.parse> | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    let active = true;
    void retryToken;
    setHistory(null);
    setError(null);
    setSelectedRevisionId(null);
    apiFetch(`/api/projects/${encodeURIComponent(projectId)}/history`, { schema: ProjectHistory })
      .then((data) => {
        if (active) {
          setHistory(data);
          setSelectedRevisionId(data.revisions.at(-1)?.id ?? null);
        }
      })
      .catch((requestError: unknown) => {
        if (active) setError(requestError);
      });
    return () => {
      active = false;
    };
  }, [projectId, retryToken]);

  const claimsHref = `/projects/${encodeURIComponent(projectId)}`;
  if (history === null && !error) {
    return (
      <main className="container-page flex min-h-[calc(100vh-3.5rem)] items-center justify-center py-section">
        <output className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin text-primary" aria-hidden /> Loading processing
          history…
        </output>
      </main>
    );
  }

  if (error) {
    const title = isStatus(error, 401)
      ? 'Sign in to view this history.'
      : isStatus(error, 404)
        ? 'Project history not found.'
        : 'History is temporarily unavailable.';
    return (
      <main className="container-page flex min-h-[calc(100vh-3.5rem)] flex-col items-start justify-center gap-4 py-section">
        <p className="text-eyebrow">Private workspace</p>
        <h1 className="text-h2">{title}</h1>
        <p role="alert" className="max-w-lg text-muted-foreground">
          {isStatus(error, 401)
            ? 'Sign in as the project owner to review saved processing versions.'
            : 'The saved history could not be loaded. Please try again.'}
        </p>
        <div className="flex flex-wrap gap-3">
          <Button asChild variant="outline">
            <Link
              href={
                isStatus(error, 401)
                  ? `/login?returnTo=${encodeURIComponent(`/projects/${projectId}/history`)}`
                  : claimsHref
              }
            >
              <ArrowLeft aria-hidden /> {isStatus(error, 401) ? 'Sign in' : 'Back to claims'}
            </Link>
          </Button>
          {!isStatus(error, 401) ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setRetryToken((value) => value + 1)}
            >
              Try again
            </Button>
          ) : null}
        </div>
      </main>
    );
  }

  if (!history) return null;
  const latest = history.versions.at(-1);
  const selectedRevision =
    history.revisions.find((revision) => revision.id === selectedRevisionId) ??
    history.revisions.at(-1) ??
    null;
  return (
    <main className="min-h-[calc(100vh-3.5rem)] bg-gradient-to-b from-brand-100/45 via-background to-background px-gutter py-section">
      <div className="container-page">
        <div className="flex flex-col gap-6 border-b border-border pb-9 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-eyebrow inline-flex items-center gap-2">
              <History className="size-3.5" aria-hidden /> Evidence trail / processing history
            </p>
            <h1 className="mt-4 text-h1">Every pass, kept accountable.</h1>
            <p className="mt-4 text-body-lg text-muted-foreground">
              Review the saved versions of this project in order, then inspect exactly what changed
              between the latest two runs.
            </p>
          </div>
          <Button asChild variant="outline" className="w-full shrink-0 lg:w-auto">
            <Link href={claimsHref}>
              <ArrowLeft aria-hidden /> Current claims
            </Link>
          </Button>
        </div>

        {history.versions.length === 0 ? (
          <Card className="mt-10 border-dashed border-primary/30 bg-card/75 shadow-lg">
            <CardHeader>
              <p className="text-eyebrow">No saved runs</p>
              <CardTitle className="mt-2 text-h3">There is no processing history yet.</CardTitle>
              <CardDescription>
                Once this project is processed, each immutable version will appear here.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline">
                <Link href={claimsHref}>Open claims view</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <section aria-labelledby="versions-heading" className="mt-10">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-eyebrow">Chronological ledger</p>
                  <h2 id="versions-heading" className="mt-2 text-h2">
                    Saved processing versions
                  </h2>
                </div>
                <Badge variant="outline" className="font-mono">
                  {history.versions.length} {history.versions.length === 1 ? 'version' : 'versions'}
                </Badge>
              </div>
              <div className="mt-5 grid gap-3">
                {history.versions.map((version) => (
                  <VersionCard key={version.id} version={version} />
                ))}
              </div>
            </section>

            <Separator className="my-12" />

            <section aria-labelledby="revisions-heading" className="grid gap-5">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-eyebrow">Immutable snapshots</p>
                  <h2 id="revisions-heading" className="mt-2 text-h2">
                    Document, claim, and evidence revisions
                  </h2>
                  <p className="mt-3 max-w-2xl text-muted-foreground">
                    Each card records the persisted values before and after a changed ingestion or
                    verification result.
                  </p>
                </div>
                <Badge variant="outline" className="font-mono">
                  {history.revisions.length}{' '}
                  {history.revisions.length === 1 ? 'revision' : 'revisions'}
                </Badge>
              </div>
              {history.revisions.length > 0 ? (
                <div className="grid gap-4">
                  {history.revisions.map((revision) => (
                    <RevisionSelector
                      key={revision.id}
                      revision={revision}
                      selected={revision.id === selectedRevision?.id}
                      onSelect={() => setSelectedRevisionId(revision.id)}
                    />
                  ))}
                </div>
              ) : (
                <Card className="border-dashed bg-card/75">
                  <CardContent className="p-6 text-sm text-muted-foreground">
                    No document, claim, or evidence values have changed yet.
                  </CardContent>
                </Card>
              )}
              {selectedRevision ? <SelectedRevisionPanel revision={selectedRevision} /> : null}
            </section>

            <Separator className="my-12" />

            <section aria-labelledby="comparison-heading" className="grid gap-7">
              <div>
                <p className="text-eyebrow">Latest comparison</p>
                <h2 id="comparison-heading" className="mt-2 text-h2">
                  {history.comparison
                    ? `Version ${history.comparison.previousVersion} → version ${history.comparison.currentVersion}`
                    : 'Nothing to compare yet'}
                </h2>
                <p className="mt-3 max-w-2xl text-muted-foreground">
                  {history.comparison
                    ? 'Claims are matched by their source start and end offsets. A moved range is intentionally shown as one removal and one addition.'
                    : latest
                      ? 'This project has one saved run. A second run will unlock the added, removed, and changed claim comparison.'
                      : 'There are no runs to compare.'}
                </p>
              </div>
              {history.comparison ? (
                <>
                  <Card className="border-primary/20 bg-primary/[0.04] shadow-md">
                    <CardContent className="grid gap-5 p-5 sm:grid-cols-[1fr_auto_1fr] sm:items-center sm:p-6">
                      <div>
                        <p className="text-eyebrow">Previous evidence status</p>
                        <p className="mt-2 text-lg font-medium capitalize">
                          {statusLabel(history.comparison.evidenceState.previous)}
                        </p>
                      </div>
                      <ArrowRight className="hidden size-5 text-primary sm:block" aria-hidden />
                      <div className="sm:text-right">
                        <p className="text-eyebrow">Latest evidence status</p>
                        <p className="mt-2 text-lg font-medium capitalize">
                          {statusLabel(history.comparison.evidenceState.current)}
                        </p>
                      </div>
                      <p className="text-sm text-muted-foreground sm:col-span-3 sm:border-t sm:border-primary/15 sm:pt-4">
                        {history.comparison.evidenceState.changed
                          ? 'Evidence status changed between these runs.'
                          : 'Evidence status did not change between these runs.'}
                      </p>
                    </CardContent>
                  </Card>
                  <div className="grid gap-9">
                    <ChangeGroup
                      title="Added claims"
                      description="New source spans present in the latest run."
                      items={history.comparison.added}
                      kind="added"
                    />
                    <ChangeGroup
                      title="Removed claims"
                      description="Source spans retained in the previous run but absent from the latest."
                      items={history.comparison.removed}
                      kind="removed"
                    />
                    <ChangeGroup
                      title="Changed claims"
                      description="The source span stayed fixed, but a displayed claim value changed."
                      items={history.comparison.changed}
                      kind="changed"
                    />
                  </div>
                </>
              ) : (
                <Card className="border-dashed bg-card/75">
                  <CardContent className="p-6 text-sm text-muted-foreground">
                    Nothing to compare yet. The next persisted processing run will appear here.
                  </CardContent>
                </Card>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
