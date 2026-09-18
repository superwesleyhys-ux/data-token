// @polsia:framework-owned

import { apiFetch } from '@/lib/api-client';
import {
  CSV_EXPORT_ERRORS,
  type CsvExportInput,
  exportErrorSchema,
  exportResponseSchema,
} from './contracts';

export async function requestCsvExport(input: CsvExportInput, signal: AbortSignal) {
  return apiFetch('/api/csv-export', {
    method: 'POST',
    body: JSON.stringify(input),
    signal,
    schema: exportResponseSchema,
  });
}

export function csvExportErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const parsed = exportErrorSchema.safeParse(error.cause);
    if (parsed.success) {
      const match = Object.entries(CSV_EXPORT_ERRORS).find(
        ([code]) => code === parsed.data.error.code,
      );
      if (match) return match[1].message;
    }
  }
  return 'Le téléchargement a échoué. Réessayez.';
}

export function saveCsvFile(csv: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv; charset=utf-8' }));
  const link = document.createElement('a');
  try {
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    // Keep the URL alive until the browser has consumed the download click.
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
}
