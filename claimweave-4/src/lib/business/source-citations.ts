// @polsia:user-owned — pure source citation target derivation.

export type SourceCitationUnavailableReason =
  | 'missing-source'
  | 'empty-quote'
  | 'malformed-quote'
  | 'quote-not-found'
  | 'invalid-url';

export type SourceCitationTarget = {
  url: string;
  href: string;
  status: 'available' | 'fallback';
  reason: 'located' | SourceCitationUnavailableReason;
};

type SourceCitationInput = {
  url: string;
  sourceText: string | null | undefined;
  sourceQuote: string | null | undefined;
  sourceStart: number | null | undefined;
  sourceEnd: number | null | undefined;
};

function fallbackTarget(
  url: string,
  reason: SourceCitationUnavailableReason,
): SourceCitationTarget {
  return { url, href: url, status: 'fallback', reason };
}

function textFragmentUrl(url: string, quote: string) {
  const hashIndex = url.indexOf('#');
  const baseUrl = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const existingFragment = hashIndex === -1 ? '' : url.slice(hashIndex + 1);
  const fragment = existingFragment
    ? `${existingFragment}:~:text=${encodeURIComponent(quote)}`
    : `:~:text=${encodeURIComponent(quote)}`;
  return `${baseUrl}#${fragment}`;
}

export function buildSourceCitationTarget({
  url,
  sourceText,
  sourceQuote,
  sourceStart,
  sourceEnd,
}: SourceCitationInput): SourceCitationTarget {
  try {
    new URL(url);
  } catch {
    return fallbackTarget(url, 'invalid-url');
  }

  if (typeof sourceText !== 'string') return fallbackTarget(url, 'missing-source');
  if (typeof sourceQuote !== 'string' || sourceQuote.trim().length === 0) {
    return fallbackTarget(url, 'empty-quote');
  }

  const hasValidOffsets =
    typeof sourceStart === 'number' &&
    typeof sourceEnd === 'number' &&
    Number.isInteger(sourceStart) &&
    Number.isInteger(sourceEnd) &&
    sourceStart >= 0 &&
    sourceEnd > sourceStart &&
    sourceEnd <= sourceText.length;
  const quoteStart =
    hasValidOffsets && sourceText.slice(sourceStart, sourceEnd) === sourceQuote
      ? sourceStart
      : sourceText.indexOf(sourceQuote);
  if (quoteStart < 0) {
    return fallbackTarget(url, 'quote-not-found');
  }

  try {
    return {
      url,
      href: textFragmentUrl(url, sourceQuote),
      status: 'available',
      reason: 'located',
    };
  } catch {
    return fallbackTarget(url, 'malformed-quote');
  }
}
