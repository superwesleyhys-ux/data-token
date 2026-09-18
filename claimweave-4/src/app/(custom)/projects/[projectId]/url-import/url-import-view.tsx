// @polsia:user-owned — client island for URL import workflow and statuses.
'use client';

import {
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  Download,
  ExternalLink,
  Loader2,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { CsvImporter } from '@/components/custom/csv-importer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { apiFetch } from '@/lib/api-client';
import {
  UrlImportProcessResponse,
  type UrlImportRow,
  UrlImportStatus,
  type UrlImportStatus as UrlImportStatusData,
} from '@/lib/contracts/claimweave-url-import';
import { exportErrorSchema, exportResponseSchema } from '@/modules/csv-export/contracts';
import { saveCsvFile } from '@/modules/csv-export/download';

function statusLabel(status: UrlImportRow['status']) {
  if (status === 'queued') return 'Queued';
  if (status === 'processing') return 'Processing';
  if (status === 'completed') return 'Completed';
  return status === 'failed' ? 'Failed' : 'Needs attention';
}

function isStatus(error: unknown, status: number) {
  return error instanceof Error && error.message.includes(`(${status})`);
}

export function UrlImportView({ projectId }: { projectId: string }) {
  const [status, setStatus] = useState<UrlImportStatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState<Set<string>>(new Set());
  const [downloadingBatchId, setDownloadingBatchId] = useState<string | null>(null);
  const processingRef = useRef(false);
  const retryingRef = useRef(new Set<string>());

  const loadStatus = useCallback(async (): Promise<UrlImportStatusData | null> => {
    setLoading(true);
    try {
      const response = await apiFetch(
        `/api/projects/${encodeURIComponent(projectId)}/url-import/status`,
        { schema: UrlImportStatus },
      );
      setStatus(response);
      setError(null);
      return response;
    } catch (caught) {
      setError(caught);
      return null;
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    const hasProcessing = status?.batches.some((batch) =>
      batch.rows.some((row) => row.status === 'processing'),
    );
    if (!hasProcessing) return;
    const timer = window.setTimeout(() => void loadStatus(), 1200);
    return () => window.clearTimeout(timer);
  }, [loadStatus, status]);

  const claimsHref = `/projects/${encodeURIComponent(projectId)}`;
  const importEndpoint = `/api/projects/${encodeURIComponent(projectId)}/url-import`;
  const processEndpoint = `${importEndpoint}/process`;

  const downloadBatch = useCallback(
    async (batchId: string) => {
      setDownloadingBatchId(batchId);
      try {
        const response = await apiFetch(
          `/api/projects/${encodeURIComponent(projectId)}/url-import/export`,
          {
            method: 'POST',
            body: JSON.stringify({ batchId }),
            schema: exportResponseSchema,
          },
        );
        saveCsvFile(response.data.csv, response.data.filename);
        toast.success('CSV downloaded.');
      } catch (caught) {
        const details =
          caught instanceof Error
            ? exportErrorSchema.safeParse(caught.cause)
            : { success: false as const };
        const code = details.success ? details.data.error.code : '';
        if (code === 'NO_RESULTS') toast.info('This batch has no rows to export.');
        else if (code === 'ROW_LIMIT' || code === 'BYTE_LIMIT') {
          toast.error('This batch is too large to export.');
        } else if (isStatus(caught, 401) || isStatus(caught, 404)) {
          toast.error('This batch is not available to your account.');
        } else {
          toast.error('The CSV download failed. Please try again.');
        }
      } finally {
        setDownloadingBatchId(null);
      }
    },
    [projectId],
  );

  const processQueuedRows = useCallback(
    async (initialStatus: UrlImportStatusData) => {
      if (processingRef.current) return;
      processingRef.current = true;
      try {
        let current = initialStatus;
        for (const batch of current.batches) {
          for (const row of batch.rows) {
            if (row.status !== 'queued' || !row.normalizedUrl) continue;
            setSubmitting((previous) => new Set(previous).add(row.id));
            try {
              await apiFetch(processEndpoint, {
                method: 'POST',
                schema: UrlImportProcessResponse,
                body: JSON.stringify({ rowId: row.id, batchId: batch.id }),
              });
            } catch (caught) {
              if (!(caught instanceof Error && caught.message.includes('(409)'))) {
                toast.error('This URL could not be processed. Its failure was saved below.');
              }
            } finally {
              setSubmitting((previous) => {
                const next = new Set(previous);
                next.delete(row.id);
                return next;
              });
            }
            current = (await loadStatus()) ?? current;
          }
        }
      } finally {
        processingRef.current = false;
      }
    },
    [loadStatus, processEndpoint],
  );

  const retryRow = useCallback(
    async (rowId: string, batchId: string) => {
      if (retryingRef.current.has(rowId)) return;
      retryingRef.current.add(rowId);
      setSubmitting((previous) => new Set(previous).add(rowId));
      try {
        await apiFetch(processEndpoint, {
          method: 'POST',
          schema: UrlImportProcessResponse,
          body: JSON.stringify({ rowId, batchId, retry: true }),
        });
      } catch (caught) {
        if (!isStatus(caught, 409)) {
          toast.error('This URL could not be retried. Its saved status is shown below.');
        }
      } finally {
        await loadStatus();
        retryingRef.current.delete(rowId);
        setSubmitting((previous) => {
          const next = new Set(previous);
          next.delete(rowId);
          return next;
        });
      }
    },
    [loadStatus, processEndpoint],
  );

  return (
    <main className="min-h-[calc(100vh-3.5rem)] bg-gradient-to-b from-brand-100/45 via-background to-background px-gutter py-12 sm:py-16">
      <div className="container-page grid gap-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Button asChild variant="ghost" className="-ml-3">
            <Link href={claimsHref}>
              <ArrowLeft aria-hidden /> Back to evidence trail
            </Link>
          </Button>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Project URL intake
          </p>
        </div>

        <header className="max-w-3xl">
          <p className="text-eyebrow text-primary">Batch intake / verified extraction</p>
          <h1 className="mt-4 text-h1">Bring the URLs in. Decide what happens next.</h1>
          <p className="mt-5 max-w-2xl text-body-lg text-muted-foreground">
            Upload a UTF-8 CSV, map its URL column, and confirm the intake. Valid rows are then
            fetched and extracted one at a time, while malformed and duplicate rows stay visible.
          </p>
        </header>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(18rem,0.9fr)] lg:items-start">
          <Card className="border-primary/20 bg-card/90 shadow-lg shadow-primary/10">
            <CardHeader>
              <CardTitle className="text-h3">Import a URL list</CardTitle>
              <CardDescription>
                One required column named URL, website, source, or source_url. Duplicate and
                malformed rows stay visible after confirmation.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {isStatus(error, 401)
                    ? 'Sign in to import URLs for this project.'
                    : isStatus(error, 404)
                      ? 'This project is not available to your account.'
                      : 'The URL import workflow could not be loaded. Please try again.'}
                </p>
              ) : (
                <CsvImporter
                  targetId="claimweave-url-intake"
                  endpoint={importEndpoint}
                  onComplete={async (counts) => {
                    const nextStatus = await loadStatus();
                    toast.success(
                      counts.skipped > 0
                        ? `Saved ${counts.created} URL${counts.created === 1 ? '' : 's'}; review the flagged rows below.`
                        : `Saved ${counts.created} URL${counts.created === 1 ? '' : 's'} for intake.`,
                    );
                    if (nextStatus) void processQueuedRows(nextStatus);
                  }}
                />
              )}
            </CardContent>
          </Card>

          <Card className="border-border/80 bg-background/65 shadow-md">
            <CardHeader>
              <CardTitle className="text-h4">What is saved</CardTitle>
              <CardDescription>
                Accepted rows move from queued to processing, then finish with an extracted document
                and claims or a saved failure message.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 text-sm text-muted-foreground">
              <div className="flex gap-3">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <p>HTTP and HTTPS URLs are trimmed, normalized, and scoped to this project.</p>
              </div>
              <div className="flex gap-3">
                <CircleAlert className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <p>
                  Blank, malformed, whitespace-containing, and duplicate rows retain exact errors.
                </p>
              </div>
              <div className="flex gap-3">
                <Loader2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <p>
                  Each confirmed valid URL is processed once with duplicate protection at the
                  project boundary.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        <section aria-labelledby="url-import-status-heading" className="grid gap-4">
          <div>
            <p className="text-eyebrow text-primary">Saved batches</p>
            <h2 id="url-import-status-heading" className="mt-2 text-h2">
              Row-level status
            </h2>
          </div>
          {loading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Loading saved intake…
            </p>
          ) : error ? (
            <Card className="border-destructive/30 bg-destructive/5">
              <CardContent className="p-5">
                <p role="alert" className="text-sm text-destructive">
                  {isStatus(error, 401)
                    ? 'Sign in to view this project’s URL intake.'
                    : isStatus(error, 404)
                      ? 'This project was not found.'
                      : 'The saved URL intake could not be loaded. Please try again.'}
                </p>
              </CardContent>
            </Card>
          ) : status?.batches.length === 0 ? (
            <Card className="border-dashed bg-background/45">
              <CardContent className="p-6 text-sm text-muted-foreground">
                No URL batch has been confirmed yet.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-6">
              {status?.batches.map((batch) => (
                <Card key={batch.id} className="min-w-0 overflow-hidden bg-card/80 shadow-md">
                  <CardHeader className="border-b border-border/70 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <CardTitle className="text-xl">Batch {batch.id.slice(-8)}</CardTitle>
                      <CardDescription>
                        {new Date(batch.createdAt).toLocaleString()} · {batch.acceptedRows} accepted
                        · {batch.errorRows} flagged
                      </CardDescription>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={downloadingBatchId !== null || batch.rows.length === 0}
                        onClick={() => void downloadBatch(batch.id)}
                      >
                        {downloadingBatchId === batch.id ? (
                          <Loader2 className="size-3.5 animate-spin" aria-hidden />
                        ) : (
                          <Download className="size-3.5" aria-hidden />
                        )}
                        {downloadingBatchId === batch.id ? 'Downloading…' : 'Download CSV'}
                      </Button>
                      <Badge variant={batch.status === 'failed' ? 'destructive' : 'secondary'}>
                        {batch.status === 'completed'
                          ? 'Batch complete'
                          : batch.status === 'failed'
                            ? 'Batch finished with failures'
                            : statusLabel(batch.status === 'processing' ? 'processing' : 'queued')}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="divide-y divide-border/70">
                      {batch.rows.map((row) => (
                        <div
                          key={row.id}
                          className="grid gap-2 px-5 py-4 sm:grid-cols-[3rem_minmax(0,1fr)_auto] sm:items-start sm:gap-4"
                        >
                          <p className="font-mono text-xs text-muted-foreground">
                            #{row.rowNumber}
                          </p>
                          <div className="min-w-0">
                            <p className="break-all text-sm text-foreground">
                              {row.rawValue || '(blank)'}
                            </p>
                            {row.normalizedUrl && row.normalizedUrl !== row.rawValue ? (
                              <p className="mt-1 break-all text-xs text-muted-foreground">
                                normalized: {row.normalizedUrl}
                              </p>
                            ) : null}
                            {row.error ? (
                              <p className="mt-1 break-words text-sm text-destructive">
                                {row.error}
                              </p>
                            ) : null}
                          </div>
                          <div className="flex items-center gap-2 sm:justify-self-end">
                            <Badge
                              variant={
                                row.status === 'failed' || row.status === 'error'
                                  ? 'destructive'
                                  : row.status === 'completed'
                                    ? 'default'
                                    : 'secondary'
                              }
                            >
                              {statusLabel(submitting.has(row.id) ? 'processing' : row.status)}
                            </Badge>
                            {row.status === 'completed' ? (
                              <span className="text-xs text-muted-foreground">
                                {row.claimCount} claim{row.claimCount === 1 ? '' : 's'} · document
                                saved
                              </span>
                            ) : null}
                            {row.status === 'failed' ? (
                              <>
                                <span className="text-xs text-muted-foreground">
                                  {submitting.has(row.id)
                                    ? 'Retrying this URL…'
                                    : 'Review the saved failure and source.'}
                                </span>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={submitting.has(row.id)}
                                  onClick={() => void retryRow(row.id, batch.id)}
                                >
                                  {submitting.has(row.id) ? (
                                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                                  ) : null}
                                  {submitting.has(row.id) ? 'Retrying…' : 'Retry'}
                                </Button>
                              </>
                            ) : null}
                            {row.status === 'queued' && row.normalizedUrl ? (
                              <a
                                href={row.normalizedUrl}
                                target="_blank"
                                rel="noreferrer"
                                aria-label={`Open ${row.normalizedUrl}`}
                                className="text-primary hover:text-primary/80"
                              >
                                <ExternalLink className="size-4" aria-hidden />
                              </a>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
