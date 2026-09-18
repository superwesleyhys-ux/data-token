// @polsia:user-owned — brand identity. Edit freely. `site.ts` re-exports
// siteName/siteDescription; `manifest.ts` + `opengraph-image.tsx` read `brandVisual`.

export const siteName = 'Claimweave';
export const siteDescription = 'Reuse local work, validate evidence, and make fewer AI calls.';

// PWA + social-share colors. HEX only (the oklch() tokens in globals.css aren't
// readable here) — set to match your brand seed.
export const brandVisual = {
  /** PWA browser-UI / status-bar color. */
  themeColor: '#b7791f',
  /** PWA splash + install background. */
  backgroundColor: '#fbfaf7',
  /** Social-share (OG/Twitter) image. */
  og: {
    background: '#181613',
    foreground: '#fff7e6',
    tagline: 'Reuse local work, validate evidence, and make fewer AI calls.',
  },
} as const;
