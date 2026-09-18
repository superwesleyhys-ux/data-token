// @polsia:user-owned — shared API-key contract coverage.
import { describe, expect, it } from 'vitest';
import {
  ApiKeyCreate,
  ApiKeyCreateResponse,
  ApiKeyList,
  ApiKeyRevokeResponse,
} from '@/lib/contracts/api-keys';

const item = {
  id: 'key-1',
  applicationName: 'Reporting dashboard',
  keyPrefix: 'cw_live_12345678',
  createdAt: '2026-09-18T12:00:00.000Z',
  revokedAt: null,
};

describe('API-key contracts', () => {
  it('validates and trims a named connected application', () => {
    const result = ApiKeyCreate.safeParse({ applicationName: '  Reporting dashboard  ' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.applicationName).toBe('Reporting dashboard');
  });

  it('rejects missing, blank, and oversized application names', () => {
    expect(ApiKeyCreate.safeParse({}).success).toBe(false);
    expect(ApiKeyCreate.safeParse({ applicationName: ' ' }).success).toBe(false);
    expect(ApiKeyCreate.safeParse({ applicationName: 'x'.repeat(101) }).success).toBe(false);
  });

  it('accepts list and revoke payloads without a secret field', () => {
    expect(ApiKeyList.parse({ items: [item] })).toEqual({ items: [item] });
    expect(ApiKeyRevokeResponse.parse({ apiKey: { ...item, revokedAt: item.createdAt } })).toEqual({
      apiKey: { ...item, revokedAt: item.createdAt },
    });
    expect(ApiKeyList.safeParse({ items: [{ ...item, secret: 'must-not-be-here' }] }).success).toBe(
      true,
    );
  });

  it('allows the secret only in the create response contract', () => {
    expect(ApiKeyCreateResponse.parse({ apiKey: item, secret: 'cw_live_secret' }).secret).toBe(
      'cw_live_secret',
    );
    expect(ApiKeyCreateResponse.safeParse({ apiKey: item }).success).toBe(false);
  });
});
