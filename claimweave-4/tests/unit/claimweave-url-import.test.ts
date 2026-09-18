// @polsia:user-owned — deterministic URL intake and CSV boundary coverage.
import { describe, expect, it } from 'vitest';
import { normalizeImportUrl } from '@/lib/business/claimweave-url-import';
import { UrlImportProcessRequest, UrlImportStatus } from '@/lib/contracts/claimweave-url-import';
import { encodeCell, serializeRecord } from '@/modules/csv-export/serialization';
import { mapCsv, parseCsv } from '@/modules/csv-import/parser';
import { validateRows } from '@/modules/csv-import/validation';

const fields = [{ key: 'url', label: 'URL', required: true }] as const;

const validator = {
  fields,
  parseRow(raw: Record<string, string>) {
    const result = normalizeImportUrl(raw.url ?? '');
    return result.ok
      ? { ok: true as const, value: { url: result.normalizedUrl } }
      : { ok: false as const, issues: [{ field: 'url', message: result.message }] };
  },
  keyOf(row: { url: string }) {
    return row.url;
  },
};

describe('normalizeImportUrl', () => {
  it('accepts and normalizes HTTP and HTTPS URLs', () => {
    expect(normalizeImportUrl('  HTTPS://Example.com/path  ')).toEqual({
      ok: true,
      normalizedUrl: 'https://example.com/path',
    });
    expect(normalizeImportUrl('http://example.com')).toEqual({
      ok: true,
      normalizedUrl: 'http://example.com/',
    });
  });

  it.each([
    ['', 'Enter a URL.'],
    ['not a url', 'URLs cannot contain whitespace.'],
    ['ftp://example.com', 'Use an http or https URL.'],
    ['javascript:alert(1)', 'Use an http or https URL.'],
    [`https://example.com/${'a'.repeat(2048)}`, 'That URL is too long.'],
  ])('rejects %s', (value, message) => {
    expect(normalizeImportUrl(value)).toEqual({ ok: false, message });
  });
});

describe('CSV URL row mapping', () => {
  it('maps the URL column and flags duplicate rows without external work', () => {
    const parsed = parseCsv('URL\nhttps://example.com\nhttps://example.com/\n', ',');
    const mapped = mapCsv(parsed, fields, { url: 0 });
    const result = validateRows(mapped, validator);

    expect(result.invalid).toBe(2);
    expect(result.rows).toEqual([]);
    expect(result.issues).toHaveLength(2);
    expect(result.issues[0]?.message).toContain('répétée');
  });

  it('rejects a missing required URL mapping and malformed CSV', () => {
    const parsed = parseCsv('Title\nhello\n', ',');
    expect(() => mapCsv(parsed, fields, {})).toThrow('obligatoire');
    expect(() => parseCsv('URL\n"unterminated', ',')).toThrow('invalide');
  });

  it('enforces the 10,000-record and 10 MiB limits', () => {
    const records = [
      'URL',
      ...Array.from({ length: 10_001 }, (_, index) => `https://e.co/${index}`),
    ].join('\n');
    expect(() => parseCsv(records, ',')).toThrow('enregistrements');

    const oversized = `URL\nhttps://example.com/${'a'.repeat(10_485_760)}`;
    expect(() => parseCsv(oversized, ',')).toThrow('10 Mio');
  });
});

describe('URL processing status contract', () => {
  const baseRow = {
    id: 'row-1',
    rowNumber: 1,
    rawValue: 'https://example.com',
    normalizedUrl: 'https://example.com/',
    error: null,
    processingStartedAt: null,
    completedAt: null,
    failedAt: null,
    documentId: null,
    claimCount: 0,
    extractedAt: null,
  };

  it('accepts queued, processing, completed, failed, and retained CSV error rows', () => {
    const rows = [
      { ...baseRow, status: 'queued' },
      {
        ...baseRow,
        status: 'processing',
        processingStartedAt: '2026-09-18T00:00:00.000Z',
      },
      {
        ...baseRow,
        status: 'completed',
        completedAt: '2026-09-18T00:01:00.000Z',
        extractedAt: '2026-09-18T00:01:00.000Z',
        documentId: 'document-1',
        claimCount: 2,
      },
      {
        ...baseRow,
        status: 'failed',
        error: 'The source could not be read.',
        failedAt: '2026-09-18T00:01:00.000Z',
      },
      { ...baseRow, status: 'error', error: 'This URL is already imported.' },
    ];
    expect(
      UrlImportStatus.parse({
        batches: [
          {
            id: 'batch-1',
            createdAt: '2026-09-18T00:00:00.000Z',
            totalRows: rows.length,
            acceptedRows: 4,
            errorRows: 1,
            status: 'processing',
            rows,
          },
        ],
      }).batches[0]?.rows,
    ).toHaveLength(5);
  });

  it('rejects a completed row without persisted result metadata', () => {
    expect(() =>
      UrlImportStatus.parse({
        batches: [
          {
            id: 'batch-1',
            createdAt: '2026-09-18T00:00:00.000Z',
            totalRows: 1,
            acceptedRows: 1,
            errorRows: 0,
            status: 'completed',
            rows: [{ ...baseRow, status: 'completed' }],
          },
        ],
      }),
    ).toThrow();
  });

  it('accepts an explicit retry request only with row and batch identifiers', () => {
    expect(
      UrlImportProcessRequest.parse({ rowId: 'row-1', batchId: 'batch-1', retry: true }),
    ).toEqual({ rowId: 'row-1', batchId: 'batch-1', retry: true });
    expect(UrlImportProcessRequest.parse({ rowId: 'row-1' })).toEqual({
      rowId: 'row-1',
      retry: false,
    });
    expect(() => UrlImportProcessRequest.parse({ retry: true })).toThrow();
  });

  it('keeps failed rows dependent on failure metadata and error rows terminal', () => {
    expect(() =>
      UrlImportStatus.parse({
        batches: [
          {
            id: 'batch-1',
            createdAt: '2026-09-18T00:00:00.000Z',
            totalRows: 1,
            acceptedRows: 1,
            errorRows: 0,
            status: 'failed',
            rows: [{ ...baseRow, status: 'failed' }],
          },
        ],
      }),
    ).toThrow();

    expect(
      UrlImportStatus.parse({
        batches: [
          {
            id: 'batch-1',
            createdAt: '2026-09-18T00:00:00.000Z',
            totalRows: 1,
            acceptedRows: 0,
            errorRows: 1,
            status: 'completed',
            rows: [{ ...baseRow, status: 'error', error: 'This URL is repeated in this file.' }],
          },
        ],
      }).batches[0]?.rows[0]?.status,
    ).toBe('error');
  });
});

describe('URL import CSV export serialization', () => {
  it('preserves every requested status and nullable reference as a CSV field', () => {
    const rows = [
      [
        'https://example.com/valid',
        'https://example.com/valid',
        'valid',
        'queued',
        null,
        'project-a',
        null,
      ],
      [
        'not a url',
        null,
        'invalid',
        'not_processed',
        'URLs cannot contain whitespace.',
        'project-a',
        null,
      ],
      ['https://example.com/processing', null, 'valid', 'processing', null, 'project-a', null],
      [
        'https://example.com/done',
        'https://example.com/done',
        'valid',
        'completed',
        null,
        'project-a',
        'document-a',
      ],
      [
        'https://example.com/failed',
        null,
        'valid',
        'failed',
        'The source could not be read.',
        'project-a',
        null,
      ],
    ];
    const csv = [
      [
        'submitted_url',
        'normalized_url',
        'validation_status',
        'processing_status',
        'error_message',
        'project_reference',
        'document_reference',
      ],
      ...rows,
    ]
      .map((row) => serializeRecord(row.map(encodeCell), ','))
      .join('');

    expect(csv).toContain(`"'not a url","\\N","'invalid","'not_processed`);
    expect(csv).toContain(`"'project-a","'document-a`);
    expect(csv.match(/\r\n/g)).toHaveLength(6);
  });

  it('escapes commas, quotes, and newlines without dropping text', () => {
    expect(serializeRecord([encodeCell('line, "quoted"\nnext')], ',')).toBe(
      `"'line, ""quoted""\nnext"\r\n`,
    );
  });
});
