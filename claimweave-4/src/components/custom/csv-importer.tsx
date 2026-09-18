// @polsia:user-owned — styled CSV workflow using the installed CSV Import module.
'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { apiFetch } from '@/lib/api-client';
import {
  CSV_LIMITS,
  type CsvDelimiter,
  type CsvDescription,
  type CsvMapping,
  type CsvPreview,
  commitResponseSchema,
  descriptionResponseSchema,
  errorResponseSchema,
  type ImportCounts,
  previewResponseSchema,
} from '@/modules/csv-import/contracts';
import {
  createExampleCsv,
  decodeCsv,
  readCsvHeaders,
  suggestMapping,
} from '@/modules/csv-import/parser';

export interface CsvImporterProps {
  targetId: string;
  endpoint: string;
  onComplete?: (counts: ImportCounts) => void | Promise<void>;
}

function errorMessage(error: unknown) {
  const parsed = errorResponseSchema.safeParse(error instanceof Error ? error.cause : null);
  return parsed.success
    ? parsed.data.error.message
    : 'Unable to process the import. Please try again.';
}

function errorIssues(error: unknown) {
  const parsed = errorResponseSchema.safeParse(error instanceof Error ? error.cause : null);
  return parsed.success ? (parsed.data.error.issues ?? []) : [];
}

function rowsLabel(count: number) {
  return count === 1 ? 'row' : 'rows';
}

export function CsvImporter({ targetId, endpoint, onComplete }: CsvImporterProps) {
  const id = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [description, setDescription] = useState<CsvDescription | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<CsvMapping>({});
  const [delimiter, setDelimiter] = useState<CsvDelimiter>(',');
  const [csv, setCsv] = useState<string | null>(null);
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [result, setResult] = useState<ImportCounts | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [issues, setIssues] = useState<CsvPreview['issues']>([]);
  const [phase, setPhase] = useState<
    'loading' | 'file' | 'mapping' | 'checking' | 'preview' | 'committing' | 'done'
  >('loading');

  useEffect(() => {
    const controller = new AbortController();
    const separator = endpoint.includes('?') ? '&' : '?';
    apiFetch(`${endpoint}${separator}target=${encodeURIComponent(targetId)}`, {
      schema: descriptionResponseSchema,
      signal: controller.signal,
    })
      .then((response) => {
        setDescription(response.data);
        setPhase('file');
      })
      .catch((error) => setMessage(errorMessage(error)));
    return () => controller.abort();
  }, [endpoint, targetId]);

  async function selectFile(file: File | null) {
    setMessage(null);
    setIssues([]);
    setPreview(null);
    setResult(null);
    setCsv(null);
    setHeaders([]);
    setMapping({});
    if (!file || !description) return;
    if (file.size > CSV_LIMITS.bytes) {
      setMessage('Choose a CSV file of 10 MiB or less.');
      return;
    }
    try {
      const text = decodeCsv(new Uint8Array(await file.arrayBuffer()));
      const nextHeaders = readCsvHeaders(text, delimiter);
      setCsv(text);
      setHeaders(nextHeaders);
      setMapping(suggestMapping(nextHeaders, description.fields));
      setPhase('mapping');
    } catch {
      setMessage('Could not read this CSV. Use UTF-8, a valid header and the selected separator.');
      setPhase('file');
    }
  }

  function updateMapping(fieldKey: string, value: string) {
    const next = { ...mapping };
    delete next[fieldKey];
    if (value !== '') next[fieldKey] = Number(value);
    setMapping(next);
    setPreview(null);
    setIssues([]);
    setMessage(null);
    setPhase('mapping');
  }

  async function check() {
    if (!csv || !description) return;
    setPhase('checking');
    setMessage(null);
    setIssues([]);
    try {
      const response = await apiFetch(endpoint, {
        method: 'POST',
        schema: previewResponseSchema,
        body: JSON.stringify({ action: 'preview', targetId, csv, delimiter, mapping }),
      });
      setPreview(response.data);
      setIssues(response.data.issues);
      setPhase('preview');
    } catch (error) {
      setMessage(errorMessage(error));
      setIssues(errorIssues(error));
      setPhase('mapping');
    }
  }

  async function confirm() {
    if (!csv || !preview || preview.total === 0) return;
    setPhase('committing');
    setMessage(null);
    try {
      const response = await apiFetch(endpoint, {
        method: 'POST',
        schema: commitResponseSchema,
        body: JSON.stringify({ action: 'commit', targetId, csv, delimiter, mapping }),
      });
      setResult(response.data);
      setCsv(null);
      setPreview(null);
      setIssues([]);
      setPhase('done');
      await onComplete?.(response.data);
    } catch (error) {
      setMessage(errorMessage(error));
      setIssues(errorIssues(error));
      setPhase('preview');
    }
  }

  function reset() {
    setCsv(null);
    setHeaders([]);
    setMapping({});
    setPreview(null);
    setResult(null);
    setMessage(null);
    setIssues([]);
    setPhase('file');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function downloadExample() {
    if (!description) return;
    const blob = new Blob([createExampleCsv(description.fields, delimiter)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${targetId}-example.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const requiredFieldsMapped = description?.fields
    .filter((field) => field.required)
    .every((field) => mapping[field.key] !== undefined);

  return (
    <section className="grid gap-6" aria-labelledby={`${id}-title`}>
      <div>
        <h2 id={`${id}-title`} className="text-h3">
          {description?.label ?? 'CSV import'}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Match the URL column, preview every row, then explicitly save the batch.
        </p>
      </div>

      {phase === 'loading' ? (
        <p className="text-sm text-muted-foreground">Loading import settings…</p>
      ) : null}
      {description && phase !== 'done' ? (
        <div className="grid gap-5">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem] sm:items-end">
            <div className="grid gap-2">
              <Label htmlFor={`${id}-file`}>CSV file</Label>
              <Input
                ref={fileInputRef}
                id={`${id}-file`}
                type="file"
                accept=".csv,text/csv"
                disabled={phase === 'committing'}
                onChange={(event) => void selectFile(event.currentTarget.files?.[0] ?? null)}
              />
              <p className="text-xs text-muted-foreground">
                UTF-8, up to 10 MiB and 10,000 records.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`${id}-delimiter`}>Separator</Label>
              <select
                id={`${id}-delimiter`}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                value={delimiter}
                onChange={(event) => {
                  const next = event.currentTarget.value;
                  if (next === ',' || next === ';') setDelimiter(next);
                }}
              >
                <option value=",">Comma</option>
                <option value=";">Semicolon</option>
              </select>
            </div>
          </div>
          <Button type="button" variant="outline" onClick={downloadExample}>
            Download example CSV
          </Button>

          {headers.length > 0 ? (
            <div className="grid gap-4">
              <div>
                <h3 className="font-medium">Match columns</h3>
                <p className="mt-1 text-sm text-muted-foreground">The URL column is required.</p>
              </div>
              {description.fields.map((field) => (
                <div
                  key={field.key}
                  className="grid gap-2 sm:grid-cols-[12rem_minmax(0,1fr)] sm:items-center"
                >
                  <Label htmlFor={`${id}-${field.key}`}>{field.label} column</Label>
                  <select
                    id={`${id}-${field.key}`}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                    value={mapping[field.key] ?? ''}
                    onChange={(event) => updateMapping(field.key, event.currentTarget.value)}
                  >
                    <option value="">Choose a column</option>
                    {headers.map((header, index) => (
                      <option key={`${index}:${header}`} value={index}>
                        {header}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  onClick={() => void check()}
                  disabled={!requiredFieldsMapped || phase === 'checking' || phase === 'committing'}
                >
                  {phase === 'checking' ? 'Checking…' : 'Preview rows'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={reset}
                  disabled={phase === 'committing'}
                >
                  Start over
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {message ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
        >
          <p className="font-medium">{message}</p>
          {issues.length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {issues.map((issue) => (
                <li key={`${issue.record ?? 'file'}:${issue.field ?? 'general'}:${issue.message}`}>
                  {issue.record ? `Record ${issue.record}: ` : ''}
                  {issue.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {preview ? (
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <p>
              <span className="block text-muted-foreground">Total</span>
              <strong>{preview.total}</strong>
            </p>
            <p>
              <span className="block text-muted-foreground">Queued</span>
              <strong>{preview.toCreate}</strong>
            </p>
            <p>
              <span className="block text-muted-foreground">Duplicates</span>
              <strong>{preview.existing}</strong>
            </p>
            <p>
              <span className="block text-muted-foreground">Flagged</span>
              <strong>{preview.invalid}</strong>
            </p>
          </div>
          <p className="text-sm font-medium">
            {preview.invalid > 0 || preview.existing > 0
              ? 'You can still confirm: flagged rows will be retained with their exact errors.'
              : `Ready to save ${preview.toCreate} ${rowsLabel(preview.toCreate)} for intake.`}
          </p>
          {preview.rows.length > 0 ? (
            <div className="overflow-x-auto rounded-md border border-border/70">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Row</TableHead>
                    <TableHead scope="col">URL</TableHead>
                    <TableHead scope="col">Preview</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.rows.map((row) => (
                    <TableRow key={row.record}>
                      <TableHead scope="row">{row.record}</TableHead>
                      <TableCell className="max-w-[28rem] break-all">
                        {row.values.url ?? ''}
                      </TableCell>
                      <TableCell>
                        {row.status === 'error'
                          ? 'flagged'
                          : row.status === 'skip'
                            ? 'duplicate'
                            : 'queued'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
          <Button
            type="button"
            onClick={() => void confirm()}
            disabled={phase === 'committing' || preview.total === 0}
          >
            {phase === 'committing'
              ? 'Saving batch…'
              : `Confirm ${preview.total} ${rowsLabel(preview.total)}`}
          </Button>
        </div>
      ) : null}

      {result ? (
        <div
          className="grid gap-3 rounded-md border border-primary/25 bg-primary/5 p-4"
          aria-live="polite"
        >
          <h3 className="font-medium">Import saved</h3>
          <p className="text-sm text-muted-foreground">
            {result.created} queued, {result.skipped} flagged. Review the row-level status below.
          </p>
          <Button type="button" variant="outline" onClick={reset}>
            Import another file
          </Button>
        </div>
      ) : null}
    </section>
  );
}
