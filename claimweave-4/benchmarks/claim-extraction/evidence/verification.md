# Claimweave verification log — prior offline evidence and CW-SUP-03 audit

The prior CW-SUP-01-style offline evidence below was audited for CW-SUP-03. It
does not establish a live provider result. The current durable acceptance-gate
report is `acceptance-gate-v2.json`; the live release remains `BLOCKED`.

Revision under test: `eb3d1b643f773948879b1ddf813657e74042797f` (`eb3d1b6`)
plus the uncommitted working-tree changes listed below. The workflow owns the
commit; this run did not create a commit, push, or provider request.

Changed/created surfaces:

- `benchmarks/claim-extraction/run.mjs` — provider-free offline runner.
- `benchmarks/claim-extraction/fixtures/v1/**` — synthetic source, annotation,
  corroboration, instructions, and scenario manifest.
- `benchmarks/claim-extraction/evidence/**` — offline report and this log.
- `benchmarks/claim-extraction/approval-request.md` — consolidated blocked
  approval/ledger request.
- `src/lib/business/claim-extraction-usage.ts` — app-owned offline metadata
  normalizer.
- `tests/unit/claim-extraction-usage.test.ts` and
  `tests/unit/claim-extraction-fixture.test.ts` — focused regression tests.
- `tests/README.md` — fixture provenance and commands.
- `tests/integration/evidence-verification.test.mjs` — one-line existing lint
  cleanup (`String.raw` was unnecessary).

## Commands

### Build and lint

Command: `bash .agents/verify.sh`

Result: `PASS`

Observed output:

```text
✅ npm run build passed
✅ npm run lint passed
✅ build + lint are green — the gates that fail a run pass.
```

Environment limitation: the ownership pre-check reported
`ownership pre-check skipped (git add failed)` because this sandbox cannot
create `.git/index.lock`; build and lint still passed. The authoritative
workflow must rerun that check when it commits.

### Tests

Command: `npm run test`

Result: `PASS`

Observed result: `Test Files 21 passed (21)` and `Tests 176 passed (176)` in
Vitest 3.2.6. The `env-validation` test emitted its expected missing-variable
diagnostic while asserting that failure path; it did not fail the suite. The
previously reported 161-test count was not reproduced.

### Typecheck

Command: `npm run typecheck` (run after the successful build)

Result: `PASS` — `tsc --noEmit` exited 0 with no diagnostics.

### Offline evidence

Command: `node benchmarks/claim-extraction/run.mjs --offline`

Result: `PASS` with `status: offline_ready`.

The runner verified all nine source/annotation/corroboration artifact hashes in
`offline-v1.json`, exact source annotation spans, independent
annotation/corroboration identity and content, all six ordered scenarios, and
reported `offlineProviderCallsMade: 0`,
`providerAttemptsObserved: null`, and `costUsd: null`. It performs no fetch,
database, AI proxy, or provider operation.

Fixture hashes:

```text
source-001                                      3178375b82ff845c20b05fe8a5fe62a3261bb075b93b19b6a77c3cd0138a0fac
source-001-localized-edit                       4238917f1675ffe4b0babcc58891dc8fd2d48b4b1ef32c6dfdbe4a44d0715fcc
source-001-number-negation-date-change          23cc67a0cdbb916438e562c5c7f5e7264342779f27b73011c264cd69b3ed31d5
```

The five-document pilot arithmetic is an estimate of 10 logical requests and
`10 + r` provider attempts including parse retries. Remaining budget and cost
are unknown until authorized records are supplied.
