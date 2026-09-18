// @polsia:user-owned — API-key generation, hashing, and revoked-key filtering coverage.
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findFirst } = vi.hoisted(() => ({ findFirst: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ prisma: { apiKey: { findFirst } } }));

import {
  API_KEY_PREFIX,
  findActiveApiKey,
  generateApiKey,
  hashApiKey,
  parseApiKeyAuthorization,
} from '@/lib/api-key-auth';

beforeEach(() => vi.clearAllMocks());

describe('API-key security helper', () => {
  it('accepts only the documented bearer transport and full secret format', () => {
    expect(parseApiKeyAuthorization('Bearer cw_live_abc_123')).toBe('cw_live_abc_123');
    expect(parseApiKeyAuthorization(null)).toBeNull();
    expect(parseApiKeyAuthorization('cw_live_abc_123')).toBeNull();
    expect(parseApiKeyAuthorization('Basic cw_live_abc_123')).toBeNull();
    expect(parseApiKeyAuthorization('Bearer cw_test_abc_123')).toBeNull();
    expect(parseApiKeyAuthorization('Bearer cw_live_abc.123')).toBeNull();
  });

  it('generates high-entropy prefixed material and a different persisted hash', () => {
    const generated = generateApiKey(new Uint8Array(32).fill(7));
    expect(generated.secret.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(generated.secret.length).toBeGreaterThan(40);
    expect(generated.keyPrefix).toBe(generated.secret.slice(0, 16));
    expect(generated.keyHash).toBe(hashApiKey(generated.secret));
    expect(generated.keyHash).not.toContain(generated.secret);
  });

  it('looks up only active hashes and returns no revoked or unknown key', async () => {
    const generated = generateApiKey(new Uint8Array(32).fill(8));
    const record = {
      id: 'key-1',
      keyHash: generated.keyHash,
      revokedAt: null,
    };
    findFirst.mockResolvedValue(record);

    await expect(findActiveApiKey(generated.secret)).resolves.toEqual(record);
    expect(findFirst).toHaveBeenCalledWith({
      where: { keyHash: generated.keyHash, revokedAt: null },
    });

    findFirst.mockResolvedValue(null);
    await expect(findActiveApiKey(generated.secret)).resolves.toBeNull();
  });
});
