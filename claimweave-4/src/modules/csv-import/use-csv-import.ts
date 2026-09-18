// @polsia:framework-owned
'use client';

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api-client';
import {
  CSV_LIMITS,
  type CsvDelimiter,
  type CsvDescription,
  type CsvImportMode,
  type CsvIssue,
  type CsvMapping,
  type CsvPreview,
  commitResponseSchema,
  descriptionResponseSchema,
  errorResponseSchema,
  type ImportCounts,
  previewResponseSchema,
} from './contracts';
import { createExampleCsv, decodeCsv, readCsvHeaders, suggestMapping } from './parser';

export interface CsvImportOptions {
  targetId: string;
  endpoint?: string;
  onComplete?: (counts: ImportCounts) => void;
}
export type CsvImportPhase =
  | 'loading'
  | 'file'
  | 'mapping'
  | 'checking'
  | 'preview'
  | 'committing'
  | 'done';
export interface CsvClientError {
  message: string;
  issues?: CsvIssue[];
  uncertain?: boolean;
}

function readFile(file: File, signal: AbortSignal): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const cancel = () => reader.abort();
    const cleanup = () => signal.removeEventListener('abort', cancel);
    reader.onload = () => {
      cleanup();
      if (reader.result !== null && typeof reader.result !== 'string')
        resolve(new Uint8Array(reader.result));
      else reject(new Error('Could not read the file.'));
    };
    reader.onerror = () => {
      cleanup();
      reject(new Error('Could not read the file.'));
    };
    reader.onabort = () => {
      cleanup();
      reject(new DOMException('Read cancelled', 'AbortError'));
    };
    signal.addEventListener('abort', cancel, { once: true });
    reader.readAsArrayBuffer(file);
    if (signal.aborted) cancel();
  });
}

function suggestFileMapping(headers: string[], fields: CsvDescription['fields']): CsvMapping {
  if (!headers.some((header) => header.startsWith('__polsia_')))
    return suggestMapping(headers, fields);
  const mapping: CsvMapping = {};
  for (const field of fields) {
    const column = headers.indexOf(field.key);
    if (column !== -1) mapping[field.key] = column;
  }
  return mapping;
}

function responseError(error: unknown) {
  return errorResponseSchema.safeParse(error instanceof Error ? error.cause : null);
}
function requestError(error: unknown): CsvClientError {
  const parsed = responseError(error);
  if (parsed.success && parsed.data.error.code !== 'INTERNAL_ERROR') return parsed.data.error;
  return { message: 'Unable to process the import. Please try again.' };
}

export function useCsvImport({
  targetId,
  endpoint = '/api/csv-import',
  onComplete,
}: CsvImportOptions) {
  const [description, setDescription] = useState<CsvDescription | null>(null);
  const [phase, setPhase] = useState<CsvImportPhase>('loading');
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, updateMapping] = useState<CsvMapping>({});
  const [delimiter, updateDelimiter] = useState<CsvDelimiter>(',');
  const [mode, updateMode] = useState<CsvImportMode>('create');
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [result, setResult] = useState<ImportCounts | null>(null);
  const [error, setError] = useState<CsvClientError | null>(null);
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const currentPreview = useRef<number | null>(null);
  const controller = useRef<AbortController | null>(null);
  const commitLock = useRef(false);
  const csv = useRef<string | null>(null);
  const currentMapping = useRef<CsvMapping>({});
  const currentDelimiter = useRef<CsvDelimiter>(',');
  const currentMode = useRef<CsvImportMode>('create');
  const expectedVersions = useRef<Record<string, string | null> | undefined>(undefined);
  const descriptionRef = useRef<CsvDescription | null>(null);
  const identity = useRef({ targetId, endpoint });

  useEffect(() => {
    void retry;
    const id = ++generation.current;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    identity.current = { targetId, endpoint };
    commitLock.current = false;
    currentPreview.current = null;
    csv.current = null;
    descriptionRef.current = null;
    currentMapping.current = {};
    currentDelimiter.current = ',';
    currentMode.current = 'create';
    expectedVersions.current = undefined;
    updateMode('create');
    setDescription(null);
    setPreview(null);
    setResult(null);
    setError(null);
    setHeaders([]);
    updateMapping({});
    updateDelimiter(',');
    setPhase('loading');
    const separator = endpoint.includes('?') ? '&' : '?';
    apiFetch(`${endpoint}${separator}target=${encodeURIComponent(targetId)}`, {
      schema: descriptionResponseSchema,
      signal: request.signal,
    })
      .then((response) => {
        if (id !== generation.current) return;
        if (response.data.id !== targetId) throw new Error('Destination response mismatch');
        descriptionRef.current = response.data;
        setDescription(response.data);
        setPhase('file');
      })
      .catch((caught) => {
        if (id !== generation.current) return;
        setError(requestError(caught));
        setPhase('file');
      });
    return () => {
      ++generation.current;
      controller.current?.abort();
    };
  }, [targetId, endpoint, retry]);

  function invalidate() {
    const id = ++generation.current;
    controller.current?.abort();
    currentPreview.current = null;
    expectedVersions.current = undefined;
    setPreview(null);
    setResult(null);
    setError(null);
    return id;
  }
  function isCurrent(id: number) {
    return id === generation.current;
  }
  function setMode(next: CsvImportMode) {
    if (commitLock.current || !(descriptionRef.current?.modes ?? ['create']).includes(next)) return;
    invalidate();
    currentMode.current = next;
    updateMode(next);
    setPhase(csv.current === null ? 'file' : 'mapping');
  }
  function setMapping(next: CsvMapping) {
    if (commitLock.current) return;
    invalidate();
    currentMapping.current = { ...next };
    updateMapping({ ...next });
    setPhase(csv.current === null ? 'file' : 'mapping');
  }
  function setDelimiter(next: CsvDelimiter) {
    if (commitLock.current) return;
    invalidate();
    currentDelimiter.current = next;
    updateDelimiter(next);
    currentMapping.current = {};
    updateMapping({});
    setHeaders([]);
    if (csv.current !== null && descriptionRef.current) {
      try {
        const nextHeaders = readCsvHeaders(csv.current, next);
        const nextMapping = suggestFileMapping(nextHeaders, descriptionRef.current.fields);
        currentMapping.current = nextMapping;
        updateMapping(nextMapping);
        setHeaders(nextHeaders);
      } catch {
        setError({ message: 'Check the selected separator and use a valid CSV header.' });
      }
      setPhase('mapping');
    } else setPhase('file');
  }
  async function selectFile(file: File | null) {
    if (commitLock.current || !descriptionRef.current) return;
    const id = invalidate();
    csv.current = null;
    setHeaders([]);
    currentMapping.current = {};
    updateMapping({});
    setPhase('file');
    if (!file) return;
    if (file.size > CSV_LIMITS.bytes) {
      setError({ message: 'Choose a CSV file of 10 MiB or less.' });
      return;
    }
    const request = new AbortController();
    controller.current = request;
    setPhase('loading');
    try {
      const bytes = await readFile(file, request.signal);
      if (!isCurrent(id)) return;
      const text = decodeCsv(bytes);
      const nextHeaders = readCsvHeaders(text, currentDelimiter.current);
      const nextMapping = suggestFileMapping(nextHeaders, descriptionRef.current.fields);
      csv.current = text;
      currentMapping.current = nextMapping;
      setHeaders(nextHeaders);
      updateMapping(nextMapping);
      setPhase('mapping');
    } catch {
      if (!isCurrent(id)) return;
      setError({
        message: 'Could not read this CSV. Use UTF-8, a valid header and the selected separator.',
      });
      setPhase('file');
    }
  }
  async function check() {
    if (commitLock.current || csv.current === null || !descriptionRef.current) return;
    const id = invalidate();
    const request = new AbortController();
    controller.current = request;
    setPhase('checking');
    try {
      const response = await apiFetch(endpoint, {
        method: 'POST',
        signal: request.signal,
        schema: previewResponseSchema,
        body: JSON.stringify({
          action: 'preview',
          targetId,
          csv: csv.current,
          delimiter: currentDelimiter.current,
          mapping: currentMapping.current,
          ...(currentMode.current === 'create' ? {} : { mode: currentMode.current }),
        }),
      });
      if (!isCurrent(id)) return;
      currentPreview.current = id;
      expectedVersions.current = response.data.expectedVersions;
      setPreview(response.data);
      setPhase('preview');
      if (response.data.invalid > 0)
        setError({
          message: 'Correct the invalid records before importing.',
          issues: response.data.issues,
        });
    } catch (caught) {
      if (!isCurrent(id)) return;
      setError(requestError(caught));
      setPhase('mapping');
    }
  }
  const canConfirm =
    phase === 'preview' &&
    error === null &&
    preview !== null &&
    preview.invalid === 0 &&
    preview.toCreate + (preview.toUpdate ?? 0) > 0 &&
    (mode === 'create' || expectedVersions.current !== undefined) &&
    currentPreview.current === generation.current &&
    !commitLock.current &&
    description?.id === targetId &&
    identity.current.endpoint === endpoint;
  async function confirm() {
    if (
      !canConfirm ||
      commitLock.current ||
      csv.current === null ||
      currentPreview.current !== generation.current
    )
      return;
    commitLock.current = true;
    const id = generation.current;
    setError(null);
    setPhase('committing');
    try {
      // Do not attach the read/preview AbortController: an in-flight write cannot be undone by closing the UI.
      const response = await apiFetch(endpoint, {
        method: 'POST',
        schema: commitResponseSchema,
        body: JSON.stringify({
          action: 'commit',
          targetId,
          csv: csv.current,
          delimiter: currentDelimiter.current,
          mapping: currentMapping.current,
          ...(currentMode.current === 'create'
            ? {}
            : { mode: currentMode.current, expectedVersions: expectedVersions.current }),
        }),
      });
      if (!isCurrent(id)) return;
      csv.current = null;
      currentPreview.current = null;
      expectedVersions.current = undefined;
      setResult(response.data);
      setPreview(null);
      setPhase('done');
      commitLock.current = false;
      try {
        await onComplete?.(response.data);
      } catch {
        /* A refresh callback cannot undo the confirmed write. */
      }
    } catch (caught) {
      if (!isCurrent(id)) return;
      expectedVersions.current = undefined;
      const parsed = responseError(caught);
      if (parsed.success && parsed.data.error.code !== 'INTERNAL_ERROR') {
        currentPreview.current = null;
        setPreview(null);
        setError(requestError(caught));
        setPhase('mapping');
      } else {
        currentPreview.current = null;
        const updating = currentMode.current !== 'create';
        setError({
          message: updating
            ? 'The import result is unknown. Check the saved records, then check the file again to review a fresh preview before importing.'
            : 'The import result is unknown. Check the saved records or retry this import; existing records will be skipped.',
          uncertain: true,
        });
        if (updating) setPreview(null);
        setPhase(updating ? 'mapping' : 'preview');
      }
    } finally {
      if (isCurrent(id)) commitLock.current = false;
    }
  }
  function reset() {
    if (commitLock.current) return;
    invalidate();
    csv.current = null;
    currentMapping.current = {};
    currentDelimiter.current = ',';
    currentMode.current = 'create';
    expectedVersions.current = undefined;
    updateMode('create');
    setHeaders([]);
    updateMapping({});
    updateDelimiter(',');
    setPhase('file');
    if (!descriptionRef.current) setRetry((value) => value + 1);
  }
  function downloadExample() {
    if (!descriptionRef.current) return;
    const blob = new Blob(
      [createExampleCsv(descriptionRef.current.fields, currentDelimiter.current)],
      { type: 'text/csv;charset=utf-8' },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${targetId}-example.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  return {
    description,
    phase,
    headers,
    mapping,
    delimiter,
    mode,
    preview,
    result,
    error,
    canConfirm,
    selectFile,
    setMapping,
    setDelimiter,
    setMode,
    check,
    confirm,
    reset,
    downloadExample,
  };
}
