// @polsia:user-owned — authenticated settings shell; data loads in the client island.
import type { Metadata } from 'next';
import { ApiKeysSettings } from '@/components/custom/api-keys-settings';

export const metadata: Metadata = {
  title: 'API keys',
  description: 'Create and revoke API keys for your connected applications.',
};

export default function ApiKeysPage() {
  return <ApiKeysSettings />;
}
