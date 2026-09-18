// @polsia:user-owned — shared API-key input and response contracts.
import { z } from 'zod';

const IsoDate = z.string().datetime({ offset: true });

export const ApiKeyCreate = z.object({
  applicationName: z
    .string()
    .trim()
    .min(1, 'Application name is required.')
    .max(100, 'Application name must be 100 characters or fewer.'),
});

export const ApiKeyItem = z.object({
  id: z.string().min(1),
  applicationName: z.string().min(1),
  keyPrefix: z.string().min(1),
  createdAt: IsoDate,
  revokedAt: IsoDate.nullable(),
});

export const ApiKeyList = z.object({
  items: z.array(ApiKeyItem),
});

export const ApiKeyCreateResponse = z.object({
  apiKey: ApiKeyItem,
  secret: z.string().min(1),
});

export const ApiKeyRevokeResponse = z.object({
  apiKey: ApiKeyItem,
});

export type ApiKeyCreate = z.infer<typeof ApiKeyCreate>;
export type ApiKeyItem = z.infer<typeof ApiKeyItem>;
export type ApiKeyList = z.infer<typeof ApiKeyList>;
export type ApiKeyCreateResponse = z.infer<typeof ApiKeyCreateResponse>;
export type ApiKeyRevokeResponse = z.infer<typeof ApiKeyRevokeResponse>;
