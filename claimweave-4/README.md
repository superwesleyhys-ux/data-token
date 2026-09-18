# Claimweave

Claimweave is a Next.js 16 / React 19 application for **local-first AI work reuse** with an evidence-extraction workload.

The product goal is simple: do deterministic work first, reuse a validated prior result when it is safe, and call a model only when genuinely new computation is required.

## What is implemented in this snapshot

- Next.js App Router application with auth, PostgreSQL/Prisma persistence, project workspaces, URL and pasted-text intake, claims extraction, evidence verification, history, API keys, CSV import/export, and benchmark tooling.
- Exact-result reuse for claim extraction with acceptance checks for content, task/model/prompt/schema versions, generation parameters, tenant/permission scope, evidence identity, freshness, source spans, and citations.
- A provider-free local-first route demo showing cold start, exact repeat, changed input, and fallback decisions.
- Usage/observability plumbing and a frozen benchmark fixture set under `benchmarks/claim-extraction/`.

## Important architecture truth

This snapshot does **not** yet implement real peer-to-peer/LAN result reuse on the user's device. The current reusable extraction cache is backed by the application's PostgreSQL data store. The homepage labels trusted-device reuse as planned. Do not describe server-side cache reuse as local-device or LAN execution, and do not claim token savings until live provider usage has been measured.

## Quick start

Requirements:

- Node.js >= 20.18.1
- npm
- PostgreSQL 16+ (or use the included Compose file)

```bash
cd claimweave-4
cp .env.example .env

docker compose up -d postgres
npm ci
npm run db:generate
npm run db:migrate:dev
npm run dev
```

Open <http://localhost:3000>.

### Environment

`.env.example` contains safe local placeholders. At minimum the full app needs:

- `DATABASE_URL`
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `NEXT_PUBLIC_APP_URL`

Model-backed extraction also needs access to the Polsia-compatible AI proxy via `POLSIA_API_KEY` or `POLSIA_API_TOKEN`. Without that key, deterministic/local demo routes and offline tests can still run, while live model-backed routes should fail closed rather than invent usage.

## Checks

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

Focused local-first/reuse checks:

```bash
npm run test -- --run \
  tests/unit/local-first.test.ts \
  tests/unit/claim-extraction-reuse.test.ts \
  tests/unit/claim-extraction-observability.test.ts \
  tests/unit/claim-extraction-usage.test.ts
```

The repository also contains Playwright journeys under `tests/e2e/`. Those use deterministic local fixtures and a disposable PostgreSQL database; they are not evidence of live-provider token savings.

## Benchmark material

`benchmarks/claim-extraction/` contains the current extraction benchmark runner, versioned fixtures, independent annotations/corroboration, request sequences, and acceptance-gate evidence. Keep mock/offline results separate from live provider measurements.

## Original Polsia template documentation

The exported project's original template README is preserved as [`POLSIA_TEMPLATE_README.md`](./POLSIA_TEMPLATE_README.md).
