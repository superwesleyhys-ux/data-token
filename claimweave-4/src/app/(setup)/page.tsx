// @polsia:user-owned — metadata-only home shell for the local-first landing island.
import type { Metadata } from 'next';
import { ClaimweaveLanding } from '@/components/custom/claimweave-landing';
import { siteDescription, siteName } from '@/lib/site';

export const metadata: Metadata = {
  title: { absolute: siteName },
  description: siteDescription,
  alternates: { canonical: '/' },
};

export default function ClaimweaveLandingPage() {
  return <ClaimweaveLanding />;
}
