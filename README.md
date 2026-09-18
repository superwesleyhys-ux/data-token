# data-token: FlowCache + Claimweave

This repository contains two source projects. The Claimweave application is unpacked in **[`claimweave-4/`](claimweave-4/)**, not distributed as an opaque ZIP.

| Project | Location | Run |
| --- | --- | --- |
| Claimweave web application | `claimweave-4/` | Node.js + PostgreSQL; commands below |
| Original FlowCache harness | `flowcache/` | `python3 -m flowcache demo` from the repository root |

The existing Python harness and its tests are preserved. The web app uses its own TypeScript implementation; placing both in this repository does not automatically connect them or create LAN peer functionality.

## Run Claimweave locally

Requirements: **Node.js 22**, npm, and Docker with Compose running (or your own local PostgreSQL database).

```bash
git clone https://github.com/superwesleyhys-ux/data-token.git
cd data-token/claimweave-4
npm run setup:local
docker compose up -d --wait postgres
npm ci
npm run db:push:local
npm run dev:local
```

Open **http://127.0.0.1:3000**. For an existing clone, run `git pull --ff-only` before entering `claimweave-4/`.

`setup:local` creates an ignored `.env` with a random authentication secret and preserves any existing `.env`. The database helper synchronizes all exported Prisma models, refuses non-loopback URLs and production mode, and never passes destructive reset/data-loss flags. Do not point these development commands at a production database.

The homepage and provider-free route demonstration do not require a model API key. Register a local account to use the project workspace. **Actual model-backed extraction requires separately configured, authorized AI-proxy access.** Missing credentials are not replaced with fabricated output.

Detailed setup, architecture and limits: **[Claimweave README](claimweave-4/README.md)** and **[source review](claimweave-4/IMPORT_NOTES.md)**.

## Check Claimweave

After the setup above:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

GitHub's **Claimweave CI** checks the app separately from the Python harness. It also initializes a disposable PostgreSQL database and smoke-tests the production server, local signup/session, and authenticated project listing. Those checks do not measure live-model quality or token savings.

## Run the original FlowCache harness

From the repository root, with Python 3.11 or later:

```bash
python3 -m flowcache demo
python3 -m unittest discover -s tests -v
```

The original root documentation is preserved in **[FLOWCACHE_README.md](FLOWCACHE_README.md)**, including its measured-savings limitations. Neither the provider-free demo nor a cache-hit counter establishes live-model token savings.
