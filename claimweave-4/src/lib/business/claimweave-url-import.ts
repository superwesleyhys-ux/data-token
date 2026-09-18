// @polsia:user-owned — deterministic URL intake validation; never fetches URLs.

export const URL_IMPORT_MAX_LENGTH = 2048;

export type UrlValidation = { ok: true; normalizedUrl: string } | { ok: false; message: string };

export function normalizeImportUrl(raw: string): UrlValidation {
  const value = raw.trim();
  if (!value) return { ok: false, message: 'Enter a URL.' };
  if (value.length > URL_IMPORT_MAX_LENGTH) {
    return { ok: false, message: 'That URL is too long.' };
  }
  if (/\s/.test(value)) return { ok: false, message: 'URLs cannot contain whitespace.' };

  try {
    const parsed = new URL(value);
    if (!/^https?:$/i.test(parsed.protocol)) {
      return { ok: false, message: 'Use an http or https URL.' };
    }
    return { ok: true, normalizedUrl: parsed.toString() };
  } catch {
    return { ok: false, message: 'Enter a valid URL.' };
  }
}
