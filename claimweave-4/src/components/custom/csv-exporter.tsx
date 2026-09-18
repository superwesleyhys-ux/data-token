// @polsia:user-owned
'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { CsvDelimiter } from '@/modules/csv-export/contracts';
import {
  csvExportErrorMessage,
  requestCsvExport,
  saveCsvFile,
} from '@/modules/csv-export/download';

export interface CsvExporterProps {
  sourceId: string;
  filters: unknown;
  columns?: string[];
  delimiter?: CsvDelimiter;
  label?: string;
}

export function CsvExporter({
  sourceId,
  filters,
  columns,
  delimiter = ',',
  label = 'Exporter en CSV',
}: CsvExporterProps) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const active = useRef<AbortController | null>(null);
  const requestKey = JSON.stringify({ sourceId, filters, columns, delimiter });

  useEffect(() => {
    // Changing active filters/source invalidates an outstanding export.
    if (requestKey) {
      setStatus('idle');
      setMessage('');
    }
    return () => {
      active.current?.abort();
      active.current = null;
    };
  }, [requestKey]);

  async function download() {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setStatus('loading');
    setMessage('');
    try {
      const result = await requestCsvExport(
        { sourceId, filters, columns, delimiter },
        controller.signal,
      );
      if (controller.signal.aborted || active.current !== controller) return;
      saveCsvFile(result.data.csv, result.data.filename);
      setMessage(`${result.data.records.toLocaleString('fr-FR')} ligne(s) exportée(s).`);
      setStatus('success');
    } catch (error) {
      if (controller.signal.aborted || active.current !== controller) return;
      setMessage(csvExportErrorMessage(error));
      setStatus('error');
    } finally {
      if (active.current === controller) active.current = null;
    }
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        disabled={status === 'loading'}
        onClick={download}
        aria-busy={status === 'loading'}
      >
        {status === 'loading' ? 'Export en cours…' : label}
      </Button>
      {message && (
        <p className="text-sm" role={status === 'error' ? 'alert' : 'status'}>
          {message}
        </p>
      )}
    </div>
  );
}
