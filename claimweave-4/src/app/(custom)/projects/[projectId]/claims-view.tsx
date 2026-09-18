// @polsia:user-owned — client island for persisted claims.
'use client';

import {
  Check,
  CircleAlert,
  Clock3,
  ExternalLink,
  FileText,
  History,
  Loader2,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch } from '@/lib/api-client';
import type {
  ClaimApprovalFilter,
  ClaimApprovalStatus,
  ClaimContradictionFilter,
  ClaimVerificationFilter,
} from '@/lib/contracts/claims';
import {
  ClaimBulkReviewResult,
  ClaimReviewResult,
  ClaimsExport,
  type ClaimsExport as ClaimsExportData,
  type ClaimsExportItem,
  ProjectResult,
} from '@/lib/contracts/claims';
import {
  EvidenceDocument,
  LatestVerificationResponse,
  VerificationPolicyResponse,
  VerificationResponse,
  type VerificationRun,
} from '@/lib/contracts/evidence-verification';
import type { ProcessingRoute } from '@/lib/contracts/local-first';
import { getVisitorId } from '@/lib/visitor-id';

function classificationLabel(value: ClaimsExportItem['verificationStatus']) {
  if (value === null) return 'not checked';
  if (value === 'supported') return 'supported';
  if (value === 'contradicted') return 'contradicted';
  if (value === 'stale') return 'stale evidence';
  return 'no independent evidence';
}

function classificationClasses(value: ClaimsExportItem['verificationStatus']) {
  if (value === 'supported') return 'bg-emerald-100 text-emerald-900';
  if (value === 'contradicted') return 'bg-rose-100 text-rose-900';
  if (value === 'stale') return 'bg-amber-100 text-amber-950';
  return 'bg-muted text-muted-foreground';
}

function approvalLabel(value: ClaimApprovalStatus) {
  if (value === 'approved') return 'approved';
  if (value === 'rejected') return 'rejected';
  return 'pending review';
}

function approvalClasses(value: ClaimApprovalStatus) {
  if (value === 'approved') return 'bg-emerald-100 text-emerald-900';
  if (value === 'rejected') return 'bg-rose-100 text-rose-900';
  return 'bg-muted text-muted-foreground';
}

type ClaimsFilters = {
  approvalStatus: ClaimApprovalFilter;
  verificationStatus: ClaimVerificationFilter;
  contradictionStatus: ClaimContradictionFilter;
};

const defaultFilters: ClaimsFilters = {
  approvalStatus: 'all',
  verificationStatus: 'all',
  contradictionStatus: 'all',
};

function filtersAreActive(filters: ClaimsFilters) {
  return Object.values(filters).some((value) => value !== 'all');
}

function claimsQuery(filters: ClaimsFilters) {
  const query = new URLSearchParams();
  if (filters.approvalStatus !== 'all') query.set('approvalStatus', filters.approvalStatus);
  if (filters.verificationStatus !== 'all')
    query.set('verificationStatus', filters.verificationStatus);
  if (filters.contradictionStatus !== 'all')
    query.set('contradictionStatus', filters.contradictionStatus);
  const encoded = query.toString();
  return encoded ? `?${encoded}` : '';
}

function EvidenceExcerptList({
  label,
  excerpts,
}: {
  label: string;
  excerpts: ClaimsExportItem['evidenceExcerpts'];
}) {
  if (excerpts.length === 0) return null;
  return (
    <div className="grid gap-2">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-primary">{label}</p>
      <div className="grid gap-3">
        {excerpts.map((excerpt) => (
          <blockquote
            key={excerpt.id}
            className="border-l-2 border-primary/50 bg-muted/40 px-3 py-2 text-sm leading-6 text-muted-foreground"
          >
            “{excerpt.text}”
            <footer className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] uppercase tracking-[0.1em] text-primary/80">
              <span>{excerpt.documentTitle}</span>
              {excerpt.sourceUrl ? (
                <a
                  href={excerpt.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 underline underline-offset-2"
                >
                  source <ExternalLink className="size-3" aria-hidden />
                </a>
              ) : null}
              {excerpt.evidenceDate ? (
                <span>dated {new Date(excerpt.evidenceDate).toLocaleDateString()}</span>
              ) : null}
            </footer>
          </blockquote>
        ))}
      </div>
    </div>
  );
}

function ClaimProvenance({ claim }: { claim: ClaimsExportItem }) {
  return (
    <section
      aria-label="Claim provenance"
      className="grid min-w-0 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(13rem,0.62fr)]"
    >
      <blockquote className="min-w-0 rounded-sm border-l-4 border-primary bg-primary/[0.08] px-4 py-4 shadow-sm shadow-primary/10">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-primary">
          Source passage
        </p>
        <p className="mt-3 break-words text-sm leading-7 text-foreground">
          <span className="box-decoration-clone rounded-sm bg-primary/15 px-1 py-0.5">
            {claim.sourcePassage}
          </span>
        </p>
        <footer className="mt-3 font-mono text-[10px] uppercase tracking-[0.1em] text-primary/80">
          Source span · {claim.sourceSpan.start}–{claim.sourceSpan.end}
        </footer>
      </blockquote>
      <div className="grid min-w-0 gap-4 md:border-l md:border-border md:pl-5">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Source URL
          </p>
          {claim.sourceUrl ? (
            <a
              href={claim.sourceUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={`Source URL: ${claim.sourceUrl}`}
              className="mt-2 inline-flex min-w-0 items-start gap-2 text-sm text-primary underline decoration-primary/30 underline-offset-4 hover:decoration-primary"
            >
              <ExternalLink className="mt-0.5 size-3 shrink-0" aria-hidden />
              <span className="break-all">{claim.sourceUrl}</span>
            </a>
          ) : (
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Pasted text has no external source URL.
            </p>
          )}
        </div>
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Citation links
          </p>
          {claim.citationLinks.length > 0 ? (
            <div className="mt-2 grid min-w-0 gap-2">
              {claim.citationTargets.map((target) => (
                <div key={target.href} className="grid min-w-0 gap-1">
                  <a
                    href={target.href}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={
                      target.status === 'available'
                        ? `Citation link: ${target.url} — Open citation and highlight passage`
                        : `Citation link: ${target.url} — Open original citation`
                    }
                    className="inline-flex min-w-0 items-start gap-2 text-sm text-primary underline decoration-primary/30 underline-offset-4 hover:decoration-primary"
                  >
                    <ExternalLink className="mt-0.5 size-3 shrink-0" aria-hidden />
                    <span className="break-all">{target.url}</span>
                  </a>
                  {target.status === 'fallback' ? (
                    <p className="pl-5 text-xs leading-5 text-muted-foreground">
                      Passage highlight unavailable; opening the original citation.
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Pasted text has no external citations. The highlighted passage is the evidence trail.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function ClaimReviewStatus({
  claim,
  reviewingClaimId,
  bulkReviewing,
  onReview,
}: {
  claim: ClaimsExportItem;
  reviewingClaimId: string | null;
  bulkReviewing: boolean;
  onReview: (claimId: string, status: 'approved' | 'rejected') => void;
}) {
  const supportingExcerpts = claim.evidenceExcerpts.filter(
    (excerpt) => excerpt.role === 'supporting',
  );
  const contradictingExcerpts = claim.evidenceExcerpts.filter(
    (excerpt) => excerpt.role === 'contradicting',
  );
  const missingEvidenceLabel =
    claim.verificationStatus === null
      ? 'Not checked'
      : claim.verificationStatus === 'unsupported'
        ? 'No independent evidence found'
        : claim.verificationStatus === 'contradicted'
          ? 'Contradicting evidence found'
          : supportingExcerpts.length === 0
            ? 'No supporting excerpt persisted'
            : claim.verificationStatus === 'stale'
              ? 'Supporting evidence is stale'
              : 'Supporting evidence found';
  const contradictionFound =
    claim.verificationStatus === 'contradicted' || contradictingExcerpts.length > 0;
  const contradictionLabel =
    claim.verificationStatus === null
      ? 'Not checked'
      : contradictionFound
        ? 'Contradiction found'
        : 'No contradiction detected';
  const saving = reviewingClaimId === claim.id;

  return (
    <div className="grid gap-4 rounded-lg border border-border/80 bg-background/70 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          className={`rounded-sm font-mono text-[10px] ${classificationClasses(claim.verificationStatus)}`}
        >
          {classificationLabel(claim.verificationStatus)}
        </Badge>
        <Badge
          className={`rounded-sm font-mono text-[10px] ${approvalClasses(claim.approvalStatus)}`}
        >
          {approvalLabel(claim.approvalStatus)}
        </Badge>
      </div>
      <div className="grid gap-3 text-sm md:grid-cols-2">
        <div className="flex items-start gap-2">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <div>
            <p className="font-medium">Evidence status</p>
            <p className="mt-1 text-muted-foreground">{missingEvidenceLabel}</p>
          </div>
        </div>
        <div className="flex items-start gap-2">
          {contradictionFound ? (
            <X className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          ) : (
            <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          )}
          <div>
            <p className="font-medium">Contradiction status</p>
            <p className="mt-1 text-muted-foreground">{contradictionLabel}</p>
          </div>
        </div>
      </div>
      <EvidenceExcerptList label="Supporting evidence" excerpts={supportingExcerpts} />
      <EvidenceExcerptList label="Contradicting evidence" excerpts={contradictingExcerpts} />
      {claim.verificationStatus === null ? (
        <p className="text-xs leading-5 text-muted-foreground">
          Run an evidence check to attach supporting or contradicting excerpts.
        </p>
      ) : null}
      {claim.reviewedAt ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Clock3 className="size-3.5" aria-hidden /> Reviewed{' '}
          {new Date(claim.reviewedAt).toLocaleString()}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2 border-t border-border/70 pt-3">
        <Button
          type="button"
          size="sm"
          variant={claim.approvalStatus === 'approved' ? 'default' : 'outline'}
          onClick={() => onReview(claim.id, 'approved')}
          disabled={saving || bulkReviewing}
        >
          <Check aria-hidden /> {saving ? 'Saving…' : 'Approve'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={claim.approvalStatus === 'rejected' ? 'destructive' : 'outline'}
          onClick={() => onReview(claim.id, 'rejected')}
          disabled={saving || bulkReviewing}
        >
          <X aria-hidden /> {saving ? 'Saving…' : 'Reject'}
        </Button>
      </div>
    </div>
  );
}

function processingRouteLabel(value: ProcessingRoute | null) {
  if (value === null) return 'Processing route unavailable';
  if (value === 'trusted-server-reuse') return 'Trusted server reuse';
  if (value === 'trusted-device-reuse') return 'Trusted device reuse';
  if (value === 'model-fallback') return 'Live-model fallback';
  return 'Legacy route unknown';
}

function ClaimsFiltersBar({
  filters,
  loading,
  onChange,
  onClear,
}: {
  filters: ClaimsFilters;
  loading: boolean;
  onChange: (filters: Partial<ClaimsFilters>) => void;
  onClear: () => void;
}) {
  const active = filtersAreActive(filters);
  return (
    <section
      aria-label="Claim filters"
      aria-busy={loading}
      className="mt-8 rounded-lg border border-border/80 bg-card/80 p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-eyebrow">Narrow the evidence trail</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Filter saved claims by review, verification, or contradiction state.
          </p>
        </div>
        {active ? (
          <Button type="button" size="sm" variant="ghost" onClick={onClear}>
            Clear filters
          </Button>
        ) : null}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="grid gap-2">
          <Label htmlFor="claims-approval-filter">Approval state</Label>
          <Select
            value={filters.approvalStatus}
            onValueChange={(value) => onChange({ approvalStatus: value as ClaimApprovalFilter })}
          >
            <SelectTrigger id="claims-approval-filter" aria-label="Approval state filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="claims-verification-filter">Verification status</Label>
          <Select
            value={filters.verificationStatus}
            onValueChange={(value) =>
              onChange({ verificationStatus: value as ClaimVerificationFilter })
            }
          >
            <SelectTrigger id="claims-verification-filter" aria-label="Verification status filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="not-checked">Not checked</SelectItem>
              <SelectItem value="supported">Supported</SelectItem>
              <SelectItem value="unsupported">No independent evidence found</SelectItem>
              <SelectItem value="contradicted">Contradicted</SelectItem>
              <SelectItem value="stale">Stale evidence</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="claims-contradiction-filter">Contradiction state</Label>
          <Select
            value={filters.contradictionStatus}
            onValueChange={(value) =>
              onChange({ contradictionStatus: value as ClaimContradictionFilter })
            }
          >
            <SelectTrigger id="claims-contradiction-filter" aria-label="Contradiction state filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="not-checked">Not checked</SelectItem>
              <SelectItem value="found">Contradiction found</SelectItem>
              <SelectItem value="none">No contradiction detected</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </section>
  );
}

export function ClaimsView({ projectId }: { projectId: string }) {
  const [result, setResult] = useState<ClaimsExportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reprocessing, setReprocessing] = useState(false);
  const [reprocessError, setReprocessError] = useState<string | null>(null);
  const [verification, setVerification] = useState<VerificationRun | null>(null);
  const [verificationLoading, setVerificationLoading] = useState(true);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [minimumSupportingSources, setMinimumSupportingSources] = useState(1);
  const [minimumSupportingSourcesInput, setMinimumSupportingSourcesInput] = useState('1');
  const [policySaving, setPolicySaving] = useState(false);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [evidenceTitle, setEvidenceTitle] = useState('Independent evidence');
  const [evidenceUrl, setEvidenceUrl] = useState('');
  const [evidenceContent, setEvidenceContent] = useState('');
  const [evidenceSubmitting, setEvidenceSubmitting] = useState(false);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [reviewingClaimId, setReviewingClaimId] = useState<string | null>(null);
  const [selectedClaimIds, setSelectedClaimIds] = useState<Set<string>>(new Set());
  const [bulkReviewing, setBulkReviewing] = useState(false);
  const [filters, setFilters] = useState<ClaimsFilters>(defaultFilters);

  const loadClaims = useCallback(
    (nextFilters: ClaimsFilters) => {
      const visitorId = getVisitorId();
      return apiFetch(
        `/api/projects/${encodeURIComponent(projectId)}/claims${claimsQuery(nextFilters)}`,
        {
          headers: visitorId ? { 'X-Claimweave-Visitor-Id': visitorId } : undefined,
          schema: ClaimsExport,
        },
      );
    },
    [projectId],
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    loadClaims(filters)
      .then((data) => {
        if (active) setResult(data);
      })
      .catch(() => {
        if (active) setError('This project could not be loaded.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [filters, loadClaims]);

  useEffect(() => {
    let active = true;
    setVerificationLoading(true);
    apiFetch(`/api/projects/${encodeURIComponent(projectId)}/verify`, {
      schema: LatestVerificationResponse,
    })
      .then((data) => {
        if (active) {
          setVerification(data.verification);
          setMinimumSupportingSources(data.minimumSupportingSources);
          setMinimumSupportingSourcesInput(String(data.minimumSupportingSources));
        }
      })
      .catch(() => {
        if (active) setVerificationError('Sign in as the project owner to verify evidence.');
      })
      .finally(() => {
        if (active) setVerificationLoading(false);
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  useEffect(() => {
    if (!result) return;
    const visibleClaimIds = new Set(result.claims.map((claim) => claim.id));
    setSelectedClaimIds((current) => {
      const visibleSelection = new Set(
        [...current].filter((claimId) => visibleClaimIds.has(claimId)),
      );
      return visibleSelection.size === current.size ? current : visibleSelection;
    });
  }, [result]);

  async function handleReprocess() {
    if (reprocessing) return;
    setReprocessing(true);
    setReprocessError(null);
    try {
      await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/reprocess`, {
        method: 'POST',
        schema: ProjectResult,
      });
      const refreshed = await loadClaims(filters);
      setResult(refreshed);
      toast.success('Claims reprocessed and saved as a new run.');
    } catch {
      setReprocessError('Reprocessing did not complete. Your current result is unchanged.');
      toast.error('Reprocessing did not complete.');
    } finally {
      setReprocessing(false);
    }
  }

  async function handleReview(claimId: string, status: 'approved' | 'rejected') {
    if (reviewingClaimId || bulkReviewing) return;
    setReviewingClaimId(claimId);
    try {
      await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/claims`, {
        method: 'PATCH',
        body: JSON.stringify({ claimId, status }),
        schema: ClaimReviewResult,
      });
      const refreshed = await loadClaims(filters);
      setResult(refreshed);
      toast.success(status === 'approved' ? 'Claim approved.' : 'Claim rejected.');
    } catch {
      toast.error('Claim review could not be saved. Your last saved state is unchanged.');
    } finally {
      setReviewingClaimId(null);
    }
  }

  async function handleBulkReview(status: 'approved' | 'rejected') {
    if (bulkReviewing || reviewingClaimId || selectedClaimIds.size === 0 || !result) return;
    const claimIds = result.claims
      .filter((claim) => selectedClaimIds.has(claim.id))
      .map((claim) => claim.id);
    if (claimIds.length === 0) return;

    setBulkReviewing(true);
    try {
      const response = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/claims`, {
        method: 'PATCH',
        body: JSON.stringify({ claimIds, status }),
        schema: ClaimBulkReviewResult,
      });
      setSelectedClaimIds((current) => {
        const next = new Set(current);
        for (const claimId of response.claimIds) next.delete(claimId);
        return next;
      });

      try {
        const refreshed = await loadClaims(filters);
        setResult(refreshed);
        toast.success(
          `${response.claimIds.length} ${response.claimIds.length === 1 ? 'claim' : 'claims'} ${status}.`,
        );
      } catch {
        toast.error(
          `${response.claimIds.length} ${response.claimIds.length === 1 ? 'claim was' : 'claims were'} ${status}, but the panel could not refresh.`,
        );
      }
    } catch {
      toast.error(
        `${claimIds.length} ${claimIds.length === 1 ? 'claim' : 'claims'} could not be ${status}. Selection was kept.`,
      );
    } finally {
      setBulkReviewing(false);
    }
  }

  async function handleVerify() {
    if (verifying) return;
    setVerifying(true);
    setVerificationError(null);
    try {
      const response = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/verify`, {
        method: 'POST',
        body: JSON.stringify({ mode: 'deterministic' }),
        schema: VerificationResponse,
      });
      setVerification(response.verification);
      setMinimumSupportingSources(response.minimumSupportingSources);
      setMinimumSupportingSourcesInput(String(response.minimumSupportingSources));
      const refreshed = await loadClaims(filters);
      setResult(refreshed);
      toast.success('Independent evidence verified and saved.');
    } catch {
      setVerificationError('Verification did not complete. Your last saved result is unchanged.');
      toast.error('Evidence verification did not complete.');
    } finally {
      setVerifying(false);
    }
  }

  async function handlePolicySave() {
    const value = Number(minimumSupportingSourcesInput);
    if (!Number.isInteger(value) || value < 1 || value > 100) {
      setPolicyError('Enter a whole number from 1 to 100.');
      return;
    }
    setPolicySaving(true);
    setPolicyError(null);
    try {
      const response = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/verify`, {
        method: 'PATCH',
        body: JSON.stringify({ minimumSupportingSources: value }),
        schema: VerificationPolicyResponse,
      });
      setMinimumSupportingSources(response.minimumSupportingSources);
      setMinimumSupportingSourcesInput(String(response.minimumSupportingSources));
      toast.success('Verification threshold saved. The next verification will use it.');
    } catch {
      setPolicyError('The verification threshold could not be saved. It remains unchanged.');
      toast.error('Verification threshold could not be saved.');
    } finally {
      setPolicySaving(false);
    }
  }

  async function handleEvidenceSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (evidenceSubmitting) return;
    setEvidenceSubmitting(true);
    setEvidenceError(null);
    try {
      await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/evidence-documents`, {
        method: 'POST',
        body: JSON.stringify({
          title: evidenceTitle,
          sourceUrl: evidenceUrl.trim() || undefined,
          content: evidenceContent,
        }),
        schema: EvidenceDocument,
      });
      setEvidenceContent('');
      toast.success('Independent evidence submitted.');
    } catch {
      setEvidenceError('Evidence could not be submitted. Check the title, URL, and passage.');
      toast.error('Evidence submission failed.');
    } finally {
      setEvidenceSubmitting(false);
    }
  }

  function updateFilters(next: Partial<ClaimsFilters>) {
    setFilters((current) => ({ ...current, ...next }));
  }

  if (loading) {
    return (
      <main className="container-page flex min-h-[calc(100vh-3.5rem)] items-center justify-center py-20">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Loading evidence trail…
        </div>
      </main>
    );
  }
  if (error || !result) {
    return (
      <main className="container-page flex min-h-[calc(100vh-3.5rem)] flex-col items-start justify-center gap-4 py-20">
        <p role="alert" className="text-destructive">
          {error ?? 'Project not found.'}
        </p>
        <Button asChild variant="outline">
          <a href="/projects/new">
            <RefreshCw className="size-4" aria-hidden /> Start over
          </a>
        </Button>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100vh-3.5rem)] bg-gradient-to-b from-brand-100/45 via-background to-background px-gutter py-14 sm:py-20">
      <div className="container-page">
        <div className="flex flex-col gap-6 border-b border-border pb-10 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-eyebrow">Evidence trail / saved result</p>
            <h1 className="mt-4 text-h1">Atomic claims, with receipts.</h1>
            {result.sourceType === 'url' && result.sourceUrl ? (
              <a
                href={result.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex max-w-2xl items-center gap-2 break-all text-sm text-primary underline decoration-primary/30 underline-offset-4 hover:decoration-primary"
              >
                <FileText className="size-4 shrink-0" aria-hidden /> {result.sourceUrl}{' '}
                <ExternalLink className="size-3 shrink-0" aria-hidden />
              </a>
            ) : (
              <p className="mt-4 inline-flex items-center gap-2 text-sm text-muted-foreground">
                <FileText className="size-4 shrink-0 text-primary" aria-hidden /> Pasted text
              </p>
            )}
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={handleReprocess}
                disabled={reprocessing}
              >
                <RefreshCw className={reprocessing ? 'animate-spin' : ''} aria-hidden />
                {reprocessing ? 'Reprocessing…' : 'Reprocess claims'}
              </Button>
              {reprocessError ? (
                <p role="alert" className="text-sm text-destructive">
                  {reprocessError}
                </p>
              ) : null}
              <Button
                type="button"
                onClick={handleVerify}
                disabled={verifying}
                aria-busy={verifying}
              >
                <ShieldCheck className={verifying ? 'animate-pulse' : ''} aria-hidden />
                {verifying ? 'Verifying…' : 'Verify evidence'}
              </Button>
              <Button asChild type="button" variant="secondary">
                <Link href={`/projects/${encodeURIComponent(projectId)}/history`}>
                  <History aria-hidden /> Processing history
                </Link>
              </Button>
              <Button asChild type="button" variant="outline">
                <Link href={`/projects/${encodeURIComponent(projectId)}/url-import`}>
                  <FileText aria-hidden /> Import URLs
                </Link>
              </Button>
            </div>
          </div>
          <div className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
            <div className="min-w-0">
              <p className="font-mono uppercase tracking-[0.12em] text-muted-foreground">
                Document ID
              </p>
              <p className="mt-1 break-all font-mono text-foreground">{result.documentId}</p>
            </div>
            <div>
              <p className="font-mono uppercase tracking-[0.12em] text-muted-foreground">
                Source type
              </p>
              <p className="mt-1 text-foreground">
                {result.sourceType === 'url' ? 'Public URL' : 'Pasted text'}
              </p>
            </div>
            <div>
              <p className="font-mono uppercase tracking-[0.12em] text-muted-foreground">
                Processing time
              </p>
              <p className="mt-1 text-foreground">
                {new Date(result.extractedAt).toLocaleString()}
              </p>
            </div>
            <div className="min-w-0 lg:col-span-2">
              <p className="font-mono uppercase tracking-[0.12em] text-muted-foreground">
                Normalized content
              </p>
              <p className="mt-1 text-foreground">
                {result.normalizedContentLength === null
                  ? 'Unavailable on this legacy record'
                  : `${result.normalizedContentLength.toLocaleString()} characters saved`}
              </p>
            </div>
          </div>
        </div>

        <Card className="mt-8 border-primary/20 bg-primary/[0.04]">
          <CardContent className="grid gap-4 py-5 sm:grid-cols-[auto_1fr_auto] sm:items-center">
            <Badge className="w-fit rounded-sm bg-primary text-primary-foreground">
              {processingRouteLabel(result.processingRoute)}
            </Badge>
            <div>
              <p className="text-sm font-medium">Processing route</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {result.processingRoute === null
                  ? 'This result predates reliable processing-route metadata, so its route and measurements are unavailable.'
                  : result.processingRoute === 'trusted-server-reuse'
                    ? 'The saved result passed the current source, citation, freshness, and permission checks without a model call.'
                    : result.processingRoute === 'model-fallback'
                      ? 'Validated reuse was unavailable or rejected, so this saved result came through the live-model fallback.'
                      : 'This legacy result predates route metadata.'}
              </p>
            </div>
            <div className="text-xs text-muted-foreground sm:text-right">
              <p>Model calls</p>
              <p className="mt-1 font-mono text-foreground">
                {result.processingTrace?.modelCallCount === null || !result.processingTrace
                  ? 'unknown'
                  : result.processingTrace.modelCallCount}
              </p>
            </div>
          </CardContent>
        </Card>

        <ClaimsFiltersBar
          filters={filters}
          loading={loading}
          onChange={updateFilters}
          onClear={() => setFilters(defaultFilters)}
        />

        <section
          className="mt-10 grid gap-5 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]"
          aria-label="Evidence verification"
        >
          <Card className="border-primary/20 bg-primary/[0.04]">
            <CardHeader>
              <p className="text-eyebrow">Independent sources</p>
              <CardTitle className="mt-2 text-h3">Give each claim a second record.</CardTitle>
              <p className="text-sm leading-6 text-muted-foreground">
                Submit a document or passage separate from the extraction source. Dated evidence
                older than one year is retained but classified as stale.
              </p>
            </CardHeader>
            <CardContent>
              <form className="grid gap-4" onSubmit={handleEvidenceSubmit}>
                <div className="grid gap-2">
                  <Label htmlFor="evidence-title">Document title</Label>
                  <Input
                    id="evidence-title"
                    value={evidenceTitle}
                    onChange={(event) => setEvidenceTitle(event.target.value)}
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="evidence-url">Source URL (optional)</Label>
                  <Input
                    id="evidence-url"
                    type="url"
                    placeholder="https://…"
                    value={evidenceUrl}
                    onChange={(event) => setEvidenceUrl(event.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="evidence-content">Evidence passage</Label>
                  <Textarea
                    id="evidence-content"
                    value={evidenceContent}
                    onChange={(event) => setEvidenceContent(event.target.value)}
                    placeholder="Paste the independent passage here…"
                    className="min-h-32"
                    required
                  />
                </div>
                {evidenceError ? <p className="text-sm text-destructive">{evidenceError}</p> : null}
                <Button type="submit" variant="outline" disabled={evidenceSubmitting}>
                  {evidenceSubmitting ? 'Submitting…' : 'Submit evidence'}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card className="border-border/80 bg-card/90">
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <p className="text-eyebrow">Owner review</p>
                <CardTitle className="mt-2 text-h3">Evidence review panel</CardTitle>
                <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                  Inspect the evidence trail for every claim, then record a human approval decision.
                </p>
                <section
                  className="mt-5 grid max-w-xl gap-3 rounded-lg border border-primary/20 bg-primary/[0.04] p-3 sm:grid-cols-3"
                  aria-label="Verification outcome summary"
                  aria-live="polite"
                >
                  {verification ? (
                    <>
                      <div>
                        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                          Supported
                        </p>
                        <p className="mt-1 text-2xl font-semibold text-foreground">
                          {verification.outcomeSummary.supported}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                          Contradicted
                        </p>
                        <p className="mt-1 text-2xl font-semibold text-foreground">
                          {verification.outcomeSummary.contradicted}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                          No independent evidence
                        </p>
                        <p className="mt-1 text-2xl font-semibold text-foreground">
                          {verification.outcomeSummary.noIndependentEvidence}
                        </p>
                      </div>
                      <p className="text-xs text-muted-foreground sm:col-span-3">
                        Latest verification: Completed{' '}
                        {new Date(verification.completedAt).toLocaleString()}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground sm:col-span-3">
                      Latest verification: Not verified yet
                    </p>
                  )}
                </section>
                <form
                  className="grid gap-3 rounded-lg border border-border bg-background/70 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handlePolicySave();
                  }}
                  aria-label="Verification threshold"
                >
                  <div className="grid gap-1.5">
                    <Label htmlFor="minimum-supporting-sources">Minimum independent sources</Label>
                    <p className="text-xs leading-5 text-muted-foreground">
                      Active threshold: {minimumSupportingSources} independent source
                      {minimumSupportingSources === 1 ? '' : 's'}. The next verification will use
                      this setting.
                    </p>
                    <Input
                      id="minimum-supporting-sources"
                      type="number"
                      min={1}
                      max={100}
                      step={1}
                      value={minimumSupportingSourcesInput}
                      onChange={(event) => {
                        setMinimumSupportingSourcesInput(event.target.value);
                        setPolicyError(null);
                      }}
                      aria-invalid={policyError ? true : undefined}
                      className="max-w-32"
                    />
                    {policyError ? (
                      <p role="alert" className="text-xs text-destructive">
                        {policyError}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    type="submit"
                    variant="outline"
                    disabled={policySaving || verificationLoading}
                  >
                    {policySaving ? 'Saving…' : 'Save threshold'}
                  </Button>
                </form>
              </div>
              {verification ? (
                <Badge className="shrink-0 rounded-sm bg-brand-100 font-mono text-[10px] text-brand-800">
                  {verification.mode === 'deterministic' ? 'deterministic / mock' : 'live model'}
                </Badge>
              ) : null}
            </CardHeader>
            <CardContent>
              <div className="grid gap-5">
                {verificationLoading ? (
                  <p className="text-sm text-muted-foreground">Loading the last verification…</p>
                ) : verificationError ? (
                  <p role="alert" className="text-sm text-destructive">
                    {verificationError} Claim evidence can still be reviewed from the saved export.
                  </p>
                ) : verification ? (
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-border pb-4 text-xs text-muted-foreground">
                    <span>Policy {verification.policyVersion}</span>
                    <span>Completed {new Date(verification.completedAt).toLocaleString()}</span>
                    {verification.accuracy ? (
                      <span className="font-medium text-foreground">
                        Controlled accuracy: {verification.accuracy.correct}/
                        {verification.accuracy.total} ({verification.accuracy.percentage.toFixed(0)}
                        %)
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <p className="border-b border-border pb-4 text-sm leading-6 text-muted-foreground">
                    No verification run exists yet. Every claim is marked not checked until you
                    submit independent evidence and run the check.
                  </p>
                )}
                {result.claims.length === 0 ? (
                  <div className="grid gap-3">
                    <p className="text-sm leading-6 text-muted-foreground">
                      {filtersAreActive(filters)
                        ? 'No claims match these filters.'
                        : 'No claims were saved for this source, so there is nothing to review.'}
                    </p>
                    {filtersAreActive(filters) ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setFilters(defaultFilters)}
                      >
                        Clear filters
                      </Button>
                    ) : null}
                  </div>
                ) : (
                  <>
                    <fieldset
                      className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-center sm:justify-between"
                      aria-label="Bulk claim review controls"
                    >
                      <div className="flex items-center gap-3">
                        <Checkbox
                          id="select-all-claims"
                          checked={
                            result.claims.every((claim) => selectedClaimIds.has(claim.id))
                              ? true
                              : result.claims.some((claim) => selectedClaimIds.has(claim.id))
                                ? 'indeterminate'
                                : false
                          }
                          onCheckedChange={(checked) => {
                            setSelectedClaimIds(
                              checked === true
                                ? new Set(result.claims.map((claim) => claim.id))
                                : new Set(),
                            );
                          }}
                          disabled={bulkReviewing || reviewingClaimId !== null}
                          aria-label="Select all loaded claims"
                        />
                        <label htmlFor="select-all-claims" className="text-sm font-medium">
                          Select all loaded claims
                        </label>
                        <output className="text-sm text-muted-foreground" aria-live="polite">
                          {selectedClaimIds.size} selected
                        </output>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => handleBulkReview('approved')}
                          disabled={
                            selectedClaimIds.size === 0 ||
                            bulkReviewing ||
                            reviewingClaimId !== null
                          }
                          aria-busy={bulkReviewing}
                        >
                          <Check aria-hidden /> Approve selected
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          onClick={() => handleBulkReview('rejected')}
                          disabled={
                            selectedClaimIds.size === 0 ||
                            bulkReviewing ||
                            reviewingClaimId !== null
                          }
                          aria-busy={bulkReviewing}
                        >
                          <X aria-hidden /> Reject selected
                        </Button>
                      </div>
                    </fieldset>
                    {result.claims.map((claim) => (
                      <div
                        id={`review-claim-${claim.id}`}
                        key={claim.id}
                        className="grid gap-3 border-b border-border pb-5 last:border-0 last:pb-0"
                      >
                        <div className="flex items-start gap-3">
                          <Checkbox
                            id={`select-claim-${claim.id}`}
                            checked={selectedClaimIds.has(claim.id)}
                            onCheckedChange={(checked) => {
                              setSelectedClaimIds((current) => {
                                const next = new Set(current);
                                if (checked === true) next.add(claim.id);
                                else next.delete(claim.id);
                                return next;
                              });
                            }}
                            disabled={bulkReviewing || reviewingClaimId !== null}
                            aria-label={`Select claim: ${claim.text}`}
                          />
                          <p className="text-sm font-medium leading-6 text-foreground">
                            {claim.text}
                          </p>
                        </div>
                        <ClaimProvenance claim={claim} />
                        <ClaimReviewStatus
                          claim={claim}
                          reviewingClaimId={reviewingClaimId}
                          bulkReviewing={bulkReviewing}
                          onReview={handleReview}
                        />
                      </div>
                    ))}
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </section>

        <div id="claims" className="mt-10 grid gap-5">
          {result.claims.length === 0 ? (
            <Card>
              <CardContent className="grid gap-3 py-10 text-sm text-muted-foreground">
                <p>
                  {filtersAreActive(filters)
                    ? 'No claims match these filters.'
                    : 'No claims were saved for this source.'}
                </p>
                {filtersAreActive(filters) ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="w-fit"
                    onClick={() => setFilters(defaultFilters)}
                  >
                    Clear filters
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          ) : (
            result.claims.map((claim, index) => (
              <Card
                id={`claim-${claim.id}`}
                key={claim.id}
                className="lift scroll-mt-24 overflow-hidden border-border/80 bg-card/90"
              >
                <CardHeader className="pb-4">
                  <div className="flex min-w-0 items-start justify-between gap-4">
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-primary">
                        Claim {String(index + 1).padStart(2, '0')}
                      </p>
                      <CardTitle className="mt-3 text-h4 leading-tight">{claim.text}</CardTitle>
                    </div>
                    <Badge className="shrink-0 rounded-sm bg-brand-100 font-mono text-[10px] text-brand-800">
                      saved
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="grid gap-6">
                  <ClaimProvenance claim={claim} />
                  <div className="md:col-span-2">
                    <ClaimReviewStatus
                      claim={claim}
                      reviewingClaimId={reviewingClaimId}
                      bulkReviewing={bulkReviewing}
                      onReview={handleReview}
                    />
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
        <Separator className="my-12" />
        <p className="text-sm text-muted-foreground">
          Every claim above is reloaded from the persisted project record, not held only in the
          browser.
        </p>
      </div>
    </main>
  );
}
