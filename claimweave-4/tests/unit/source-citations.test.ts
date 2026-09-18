// @polsia:user-owned — focused tests for persisted source citation targets.
import { describe, expect, it } from 'vitest';
import { buildSourceCitationTarget } from '@/lib/business/source-citations';

const sourceText = 'A verified passage appears in the saved source document.';
const sourceQuote = 'verified passage appears';

describe('buildSourceCitationTarget', () => {
  it('creates an encoded text fragment for a quote at its persisted offsets', () => {
    expect(
      buildSourceCitationTarget({
        url: 'https://example.com/source?mode=full',
        sourceText,
        sourceQuote,
        sourceStart: 2,
        sourceEnd: 2 + sourceQuote.length,
      }),
    ).toEqual({
      url: 'https://example.com/source?mode=full',
      href: 'https://example.com/source?mode=full#:~:text=verified%20passage%20appears',
      status: 'available',
      reason: 'located',
    });
  });

  it('locates an exact quote when persisted offsets are stale', () => {
    expect(
      buildSourceCitationTarget({
        url: 'https://example.com/source',
        sourceText,
        sourceQuote,
        sourceStart: 0,
        sourceEnd: sourceQuote.length,
      }).status,
    ).toBe('available');
  });

  it.each([
    [
      'missing source',
      { sourceText: null, sourceQuote, sourceStart: 0, sourceEnd: 1 },
      'missing-source',
    ],
    [
      'empty quote',
      { sourceText, sourceQuote: '   ', sourceStart: 0, sourceEnd: 1 },
      'empty-quote',
    ],
    [
      'quote not found',
      { sourceText, sourceQuote: 'not in the document', sourceStart: 0, sourceEnd: 19 },
      'quote-not-found',
    ],
  ] as const)('returns a usable fallback for %s', (_label, input, reason) => {
    expect(buildSourceCitationTarget({ url: 'https://example.com/source', ...input })).toEqual({
      url: 'https://example.com/source',
      href: 'https://example.com/source',
      status: 'fallback',
      reason,
    });
  });

  it('preserves query strings and existing URL fragments', () => {
    expect(
      buildSourceCitationTarget({
        url: 'https://example.com/source?tab=evidence#section-2',
        sourceText,
        sourceQuote: 'saved source document.',
        sourceStart: sourceText.indexOf('saved source document.'),
        sourceEnd: sourceText.length,
      }).href,
    ).toBe('https://example.com/source?tab=evidence#section-2:~:text=saved%20source%20document.');
  });

  it('preserves the original URL for unavailable and malformed targets', () => {
    expect(
      buildSourceCitationTarget({
        url: 'https://example.com/source#original',
        sourceText,
        sourceQuote: 'stale quote',
        sourceStart: 0,
        sourceEnd: 11,
      }).href,
    ).toBe('https://example.com/source#original');
    expect(
      buildSourceCitationTarget({
        url: 'not-a-url',
        sourceText,
        sourceQuote,
        sourceStart: 2,
        sourceEnd: 2 + sourceQuote.length,
      }),
    ).toMatchObject({ status: 'fallback', reason: 'invalid-url', href: 'not-a-url' });
  });
});
