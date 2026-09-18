// @polsia:framework-owned - DO NOT EDIT. Code installed by polsia/modules/better-auth@0.8.1. Drift = commit rejected.
// Protected core (db/secret/baseURL, admin plugin, multi-host trustedOrigins) + owner-admin grant,
// composed with the app's own databaseHooks. Configure auth in @/lib/auth-config (user-owned).

import 'server-only';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { admin } from 'better-auth/plugins';
import { authConfig } from '@/lib/auth-config';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';

// Compose the owner-admin grant with the app's hooks — don't overwrite them.
const appHooks = authConfig.databaseHooks;
const ownerEmail = env.POLSIA_OWNER_EMAIL?.trim().toLowerCase();

// Multi-host auth: ONE build is served on <slug>.polsia.app, the <slug>.polsia.io
// backup domain, and custom brand domains — each must pass better-auth's
// Origin/CSRF check on sign-in/sign-up. The wildcards cover the Polsia serving
// domains (incl. any post-rename slug); BETTER_AUTH_TRUSTED_ORIGINS is injected
// per-deploy by the Polsia backend with the company's active custom domains.
// baseURL's own origin is always trusted implicitly. Framework-owned so an
// app can't accidentally narrow it back to a single host.
const trustedOrigins = [
  'https://*.polsia.app',
  'https://*.polsia.io',
  ...(env.BETTER_AUTH_TRUSTED_ORIGINS?.split(',')
    .map((o) => o.trim())
    .filter(Boolean) ?? []),
];

export const auth = betterAuth({
  ...authConfig,
  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins,
  // Better Auth's verification callback can write the pre-verification user to
  // its cookie cache. Always read authorization state from the session store.
  session: {
    ...authConfig.session,
    cookieCache: { ...authConfig.session?.cookieCache, enabled: false },
  },
  databaseHooks: {
    ...appHooks,
    user: {
      ...appHooks?.user,
      create: {
        ...appHooks?.user?.create,
        before: async (user, ctx) => {
          // Capture the SDK's identity before application hooks can mutate it.
          const originalEmail = user.email.toLowerCase();
          const originallyVerified = user.emailVerified === true;
          const r = await appHooks?.user?.create?.before?.(user, ctx);
          if (r === false) return false;
          const base = { ...user, ...(r && typeof r === 'object' && 'data' in r ? r.data : {}) };
          const emailVerified =
            originallyVerified &&
            base.emailVerified === true &&
            base.email.toLowerCase() === originalEmail;
          return {
            data: {
              ...base,
              emailVerified,
              // Unverified identities never receive an administrative role,
              // including a role supplied by an application create hook.
              ...(!emailVerified
                ? { role: 'user' }
                : ownerEmail === originalEmail
                  ? { role: 'admin' }
                  : {}),
            },
          };
        },
      },
      update: {
        ...appHooks?.user?.update,
        after: async (user, ctx) => {
          // Verification updates carry the full persisted user. Check the stored
          // identity again so a stale update cannot promote a changed address.
          if (ownerEmail && user.emailVerified && user.email.toLowerCase() === ownerEmail) {
            await prisma.user.updateMany({
              where: { id: user.id, email: user.email, emailVerified: true },
              data: { role: 'admin' },
            });
          }
          await appHooks?.user?.update?.after?.(user, ctx);
        },
      },
    },
  },
  plugins: [
    admin({
      defaultRole: 'user',
      adminRoles: ['admin'],
    }),
    ...(authConfig.plugins ?? []),
  ],
});
