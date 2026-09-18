# Claimweave source import and review

## Preservation

The supplied `claimweave-4.zip` contains 264 files. Its code was unpacked into `claimweave-4/`, separate from the existing root Python FlowCache harness. The ZIP is no longer the runnable entry point. The original template README is preserved as `POLSIA_TEMPLATE_README.md`.

Before subsequent safe test formatting, these Git tree hashes matched the uploaded archive byte-for-byte at import commit `b6d608cd675fb6ff33fe06370e01f69e1f9b0b27`:

| Directory | Git tree SHA-1 |
| --- | --- |
| `src` | `3f7511c69eb887e51737d2f6fbb80abee2e9172b` |
| `tests` | `2977f67266eb350d6d046fa0a79e31105dac1e71` |
| `prisma` | `1729d3199a273c5ca40261c2b3becae48edfc3d1` |
| `benchmarks` | `0f0fce7368a13dfb9cb2c4d480389e42d65d9b44` |
| `public` | `d564d0bc3dd917926892c55e3706cc116d5b165e` |
| `.polsia` | `30cd74a2baac53775920da138fbe34970804c2dd` |

Safe Biome formatting was applied to imported test files after the first CI run reported formatting/import-order errors. No assertions were removed, no test suite was excluded to obtain a pass, and the application business logic was not replaced.

## What this code actually does

The application serves pages and API routes with Next.js. Better Auth supplies application sessions backed by Prisma/PostgreSQL. Project ingestion retains source documents, normalized claims, citation positions and revision records. The extraction business layer checks exact-result eligibility before invoking the AI adapter and persists route/measurement records. The AI adapter sends chat-completion requests to a configured Polsia-compatible proxy; real-model operations still require authorized access.

The provider-free homepage trace is a demonstration of routing decisions. A server cache hit, a local deterministic demo, and a true multi-device LAN transfer are different execution modes. This import does not implement missing LAN/device networking, replace the model adapter, demonstrate physical Wi-Fi reuse, or establish a token-reduction percentage.

## Startup corrections

The previous root repository was a Python project; running npm there would not launch the web app. The root README now directs users into `claimweave-4/` and preserves the old harness documentation in `FLOWCACHE_README.md`.

The export did not include a ready-to-use local environment or a complete application SQL migration history. Local setup now generates a private environment file with a random auth secret, provides loopback-bound PostgreSQL Compose, and synchronizes all exported Prisma models through a development-only helper. Next.js type generation precedes TypeScript checking for fresh checkouts.

## Evidence, not promises

Use the current Claimweave CI run for installation, lint, typecheck, unit-test, build and HTTP/auth/database smoke results. A source import, green Python-harness tests, or the historical benchmark files do not establish that the web application passed those checks. A successful local smoke test also does not establish live-model correctness, token savings, security audit completion, or production readiness.

The initial imported app CI log also reported npm dependency advisories. This import does not perform a forced major-version upgrade; review dependency advisories before production deployment. Never copy a production database or model secret into CI to test the app.
