# Claimweave application

This is the unpacked Claimweave export: a **Next.js 16 / React 19 / TypeScript** application with **PostgreSQL, Prisma, Better Auth, Vitest and Playwright**. It is not a static HTML page or the Python FlowCache demo.

## Start locally

Use Node.js 22 (the package declares a minimum of 20.18.1). Install Docker with Compose and start its engine, or prepare a local PostgreSQL database.

From the repository root:

```bash
cd claimweave-4
npm run setup:local
docker compose up -d --wait postgres
npm ci
npm run db:push:local
npm run dev:local
```

Open **http://127.0.0.1:3000**. Sign up for a local account to use the workspace; it is separate from your account on polsia.com.

- `setup:local` generates a random `BETTER_AUTH_SECRET` in `.env`. It never overwrites an existing environment file or adds model credentials.
- `npm ci` installs the supplied lockfile and runs Prisma client generation.
- `db:push:local` initializes all exported schema models on a loopback development database. It refuses production mode, non-loopback hosts, and extra CLI flags. It does not use `--force-reset` or `--accept-data-loss`.
- `dev:local` binds the application to `127.0.0.1` rather than exposing it on every network interface.

The archive contains only the template's two auth SQL migrations; the application schema has additional models. Do not assume `prisma migrate deploy` alone installs the whole application. The local path uses the full schema. Review and create proper migrations before production deployment; never apply the development schema-sync command to a production database.

If port 5432 is occupied, use your existing local PostgreSQL with a matching `DATABASE_URL`, or choose a different host port in `compose.yaml` and `.env`. Do not stop unrelated databases. Existing `.env` values are preserved, so keep auth and public app URLs consistent with the URL you open.

## Environment and model access

Required for the full application: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, and `NEXT_PUBLIC_APP_URL`. The generated local file includes these.

Optional real-model access is configured server-side via `POLSIA_AI_BASE_URL` and either `POLSIA_API_KEY` or `POLSIA_API_TOKEN`. The default endpoint is the Polsia-compatible proxy used by the exported code. Configure access only through a provider/proxy you are authorized to use. A polsia.com browser login is not an API credential. Do not put secrets into client variables or commit `.env`.

The provider-free homepage demo and offline unit tests do not prove model quality or token savings. Real extraction needs model access and may incur provider charges; do not run paid benchmarks without an explicit budget and permission.

## Source map

| Area | Source |
| --- | --- |
| Pages and authenticated workspace | `src/app/` |
| API endpoints, projects, claims, review and history | `src/app/api/` |
| Fetching/normalization, extraction and persistence | `src/lib/business/claim-extraction.ts` |
| Exact-result acceptance and cache invalidation | `src/lib/business/claim-extraction-reuse.ts` |
| Provider proxy adapter | `src/lib/ai/client.ts` |
| Route/usage contracts and observability | `src/lib/contracts/`, `src/lib/business/claim-extraction-observability.ts` |
| Database models | `prisma/schema/` |
| Frozen benchmark inputs and evidence | `benchmarks/claim-extraction/` |
| Unit, integration and browser tests | `tests/` |

The current extraction cache is server-side PostgreSQL storage. The route demonstration is provider-free; trusted-device/LAN reuse is not implemented by this import. Serving the app on localhost does not make cloud model inference local, and colocating FlowCache does not integrate the two automatically.

## Validation

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

`typecheck` first generates Next.js route types, so it also works on a fresh checkout without an existing `.next` directory. To run the built server locally: `npm start -- --hostname 127.0.0.1`.

Focused tests:

```bash
npm test -- tests/unit/local-first.test.ts tests/unit/claim-extraction-reuse.test.ts tests/unit/claim-extraction-observability.test.ts tests/unit/claim-extraction-usage.test.ts
```

The CI smoke script is opt-in and intended only for a disposable local database. It creates a test account, reads project data, and checks authorization boundaries; it does not submit extraction or model requests. Existing Playwright tests require their local fixtures and database setup; the platform-specific PostgreSQL deployment suite also expects a `polsia.toml` file not present in the original export. Those suites are not silently presented as passing.

Original template documentation: [POLSIA_TEMPLATE_README.md](POLSIA_TEMPLATE_README.md). Import and review notes: [IMPORT_NOTES.md](IMPORT_NOTES.md).
