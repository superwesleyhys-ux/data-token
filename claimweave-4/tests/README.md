# Claimweave tests

## Project evidence verification policy

The verification policy is stored on `ClaimweaveProject` as
`minimumSupportingSources`, with a schema default of `1` for existing projects.
The focused unit command covers the shared threshold contract, default-compatible
classification, distinct-document boundaries, and owner-scoped GET/POST/PATCH
routes:

```sh
npm run test -- --run tests/unit/evidence-verification.test.ts tests/unit/contracts/evidence-verification.test.ts tests/unit/evidence-verification-route.test.ts
```

The PostgreSQL integration fixture creates a project without the field, reads the
default, updates it, and reads the persisted value back through Prisma. Run it
with `TEST_DATABASE_URL` after applying the schema with `npx prisma db push`:

```sh
npm run test:postgres
```

The authenticated Playwright journey uses five claims, two independent documents
for one claim, single-document support for another claim, a contradiction, and
stale evidence. It verifies the initial threshold of `1`, saves `2`, rejects an
out-of-range update, reruns deterministic verification, checks the changed outcome,
asserts no horizontal overflow at both configured breakpoints, and reads the
threshold, latest run, results, and revision rows back from disposable PostgreSQL:

```sh
npx playwright install chromium && npm run test:e2e -- tests/e2e/evidence-verification.spec.ts
```

## API keys

The protected `/settings/api-keys` journey uses the existing better-auth signup
fixture. It creates a named key, checks the one-time secret response and masked
reload state, revokes the key, and reads the disposable database to confirm the
hash-only row (including the SHA-256 digest) and `revokedAt`. The browser journey
also asserts no horizontal overflow in both configured mobile and desktop
projects. Focused coverage is:

```sh
npm run test -- --run tests/unit/api-keys-route.test.ts tests/unit/api-keys-auth.test.ts tests/unit/contracts/api-keys.test.ts tests/unit/claims-route.test.ts
npx playwright install chromium
npm run test:e2e -- tests/e2e/api-keys.spec.ts
```

The E2E commands require `DATABASE_URL` for the disposable PostgreSQL fixture
and the normal better-auth variables supplied by
`tests/e2e/playwright.config.ts`. The fixture signs up real users, reads only
the created API-key row through Prisma, and asserts the stored `keyHash` equals
the issued secret's SHA-256 digest, the `keyPrefix` is masked metadata, no
plaintext `secret` column exists, and revocation persists in `revokedAt`.

The claims export at `GET /api/projects/:id/claims` accepts the full secret only
as `Authorization: Bearer cw_live_<secret>`. It supports one-based `page` and
`pageSize` query parameters. Both default to `1` and `50` respectively;
`pageSize` accepts values through the inclusive maximum of `100`. Successful
responses include `pagination: { page, pageSize, total, totalPages,
hasNextPage, hasPreviousPage }` alongside the existing source and claim fields.
Missing or malformed values (including empty, non-integer, zero, negative, and
over-limit values) return `400 { error: "Invalid pagination parameters." }`.
A page beyond the last page succeeds with an empty `claims` array and truthful
metadata. Claims remain ordered by `sourceStart ASC, id ASC`.

Missing or malformed credentials, unknown keys, and revoked keys return `401 {
error: "Unauthorized" }`. A valid key may read only its owner's project; a
known foreign or ownerless project returns `403 { error: "Forbidden" }`, while
an unknown project returns `404`. Browser-session access remains owner-scoped
and returns the existing `404 { error: "Project not found." }` boundary for
foreign or ownerless projects.
The key is read-only: it is not accepted by the claims `PATCH` route.

The maintained unit suite runs with `npm run test` and covers the shared URL,
pasted-text, claim, source-span, citation, and extraction-normalization contracts.

The project URL batch intake and terminal row contract are covered by the deterministic
URL normalization/CSV boundary test:

```sh
npm run test -- --run tests/unit/claimweave-url-import.test.ts
```

The same focused suite covers the URL-import export field mapping, nullable references,
CSV quoting/newlines, validation errors, and every persisted processing status. The
authenticated browser journey clicks `Download CSV`, reads the real browser download,
checks the `polsia-csv-v2` columns and owner rows, and verifies a second user's batch
export attempt returns the same non-disclosing 404 boundary. Anonymous export attempts
remain 401. The export reads one explicit batch and enforces the CSV module's 10,000-row
and 10 MiB limits.

After a successful commit, each valid row is claimed by
`POST /api/projects/:projectId/url-import/process`, moves through `processing`, and
persists one project-scoped imported document plus its claims before becoming
`completed`. Fetch, AI, schema, and transaction failures roll back imported results
and become `failed`; malformed and duplicate CSV rows remain `error`. The shared
status contract rejects terminal rows without the matching result or failure
metadata. The process endpoint is owner-scoped, leaves completed rows unchanged,
and returns `409` for an in-flight row. An explicit `{ retry: true, rowId,
batchId }` request conditionally claims only a persisted `failed` row, clears its
failure metadata, and reuses the same processor. Concurrent retries cannot both
claim the row. A failed retry returns the persisted failure so the client can
reload and render `Batch finished with failures`; a successful retry renders the
row as `Completed` and the batch as `Batch complete`. Retained CSV `error` rows
remain non-retryable.

The maintained browser journey for URL intake should run against the disposable
PostgreSQL database with real better-auth cookies:

```sh
npx playwright install chromium && npm run test:e2e -- tests/e2e/url-batch.spec.ts
```

It asserts the owner-only route/API boundary, preview and confirmation, persisted
row transitions, duplicate handling, terminal result metadata, failed-row retry,
status reload, and mobile no-overflow at both configured browser projects. The
source fixture intentionally fails `/retry` on its first request and succeeds on
the next request, while the AI fixture remains deterministic. Database assertions
read only the project's URL import batches, rows, imported documents, and imported
claims, confirming unchanged accepted/error counts, one document per successful
URL, and no partial result for a failed row.

For the focused processor/route coverage, run the URL contract and process-route
tests together:

```sh
npm run test -- --run tests/unit/claimweave-url-import.test.ts tests/unit/url-import-process-route.test.ts
```

For database read-back coverage, apply the schema to a disposable PostgreSQL
database with `npx prisma db push`, then run the URL batch browser journey:

```sh
npx playwright install chromium && npm run test:e2e -- tests/e2e/url-batch.spec.ts
```

The extraction service is deliberately adapter-shaped around the Polsia AI
proxy and global `fetch`. Route-level integration coverage should use the
disposable PostgreSQL database, a deterministic source fixture, and a
deterministic AI adapter; the live AI proxy is not required for unit tests.

The first-project funnel is anonymous, first-time-only telemetry: a browser
UUID identifies a visitor, but it is not authenticated identity analytics.
`first_project_started` is recorded before extraction and receives its first
successful project id afterward; `claims_view_reached` is recorded only after
the persisted claims contract validates. Both events are idempotent by
`(visitorId, event)`, so refreshes and double clicks do not inflate the metric.

The guided browser journey is `/projects/new` → “Try the demo project” → the
persisted claims view. The maintained local suite is `npm run test`; a browser
runner can exercise the same journey at mobile and desktop viewports against a
disposable database without changing the production data plane.

The browser server starts `tests/e2e/ai-fixture.mjs`, a deterministic local
OpenAI-compatible `/chat/completions` endpoint, and `tests/e2e/source-fixture.mjs`,
a local readable source origin. The app maps only the explicit
`CLAIMWEAVE_TEST_SOURCE_ORIGIN` fixture setting during E2E; it still validates
the submitted public URL with the production SSRF guard. The AI fixture returns
a quote copied from the submitted source and includes a URL citation only for URL submissions, so
the URL and text journeys exercise the real route handler, AI adapter, Prisma
transaction, and persisted results without a live Polsia proxy key. Both
journeys assert the parent document id, original source field, normalized
content length/content, processing timestamp, project owner, and every claim's
parent `sourceId`. Text fixtures additionally verify the exact `documentText`,
nullable claim URL, and empty citation array; the stable RFC demo URL verifies
readable URL normalization.

Each completed processing run also writes one immutable `ClaimweaveProcessingRun`
with a per-project version and one `ClaimweaveClaimSnapshot` per returned claim.
Changed primary and URL-import documents/claims also write one owner-scoped
`ClaimweaveRevision` event with normalized before/current JSON snapshots. The
event is created inside the same transaction as the current projection; failed
fetch, AI validation, duplicate/non-processable rows, and transaction rollback
leave no revision rows. Replayed values ignore generated row ids and processing
timestamps, so they do not create a duplicate revision.
The pasted-text fixture clicks “Reprocess claims” from the real claims client
island, then queries the disposable PostgreSQL database through Prisma to assert
exactly versions 1 and 2, preserved first-run text/source offsets/citation fields,
the `complete` evidence state, and distinct run timestamps. The current mutable
claim projection is checked separately; a failed AI response or transaction must
leave both that projection and snapshot history unchanged.

The same pasted-text browser proof reloads the project after the initial
response and compares the fresh claims API payload and visible workspace against
the saved document id, claim text, source passage, nullable source URL, and
extraction timestamp. Run that focused persistence journey with:

```sh
npx playwright install chromium && npm run test:e2e -- tests/e2e/projects-workspace.spec.ts
```

The protected `POST /api/projects/[projectId]/reprocess` route is covered for
anonymous, unknown, non-owner, successful-owner, and upstream-processing-failure
branches. Reprocessing reloads the original URL or pasted source, validates the
new AI output before opening the transaction, and uses the project's version
uniqueness invariant to reject concurrent version collisions without reusing a
history version. No live Polsia AI key is required: the deterministic local AI
fixture serves both the initial and reprocessing calls.

The authenticated workspace fixture uses two repeatable better-auth users,
an owned project for user A, an owned project for user B, and an ownerless
legacy project. The API fixture must assert owner-scoped ordering, anonymous
creation compatibility, cross-user 404 access, ownerless legacy denial, and
nullable normalized-content metadata for legacy rows. The maintained browser command is `npx playwright install chromium
&& npm run test:e2e`; it signs up against the disposable database, uses real
session cookies, and exercises `/projects`, its claims link, and `/projects/new`
at mobile and desktop viewports. Unit tests are not a substitute for this route
test. The owner-only `GET /api/projects/:id/claims` export is covered by the
focused route command below and the authenticated evidence browser journey;
anonymous, cross-user, unknown, and ownerless legacy projects are denied. Set
`E2E_BASE_URL` to point at an already-running app when needed.

For the claims export route, provenance contract, and bulk approval/rejection review controls, run:

```sh
npm run test -- --run tests/unit/claims-route.test.ts tests/unit/contracts/claims.test.ts tests/unit/api-keys-auth.test.ts
```

Citation passage-linking has focused pure-helper and shared-contract coverage:

```sh
npm run test -- --run tests/unit/source-citations.test.ts tests/unit/contracts/claims.test.ts tests/unit/claims-route.test.ts
```

The maintained citation browser journey uses the disposable PostgreSQL database,
real better-auth cookies, and `tests/e2e/source-fixture.mjs`. It seeds one claim
whose persisted quote is present in the stored source and one stale claim whose
quote is absent. The owner-only API and workspace assertions preserve each
original citation URL, require an encoded `#:~:text=` target for the located
passage, require an unchanged fallback URL plus visible unavailable copy for the
stale passage, open the deterministic source fixture, and verify the existing
cross-user 404 boundary. It also checks no horizontal overflow. The journey runs
in both configured iPhone 13 mobile and desktop Chromium projects:

```sh
npx playwright install chromium && npm run test:e2e -- tests/e2e/claim-citations.spec.ts
```

The focused pagination coverage is included in the claims route and contract
tests above. The maintained session and bearer-key journeys exercise real
multi-claim page slices and metadata with the disposable PostgreSQL database:

```sh
npx playwright install chromium && npm run test:e2e -- tests/e2e/projects-workspace.spec.ts tests/e2e/api-keys.spec.ts
```

The maintained API-key HTTP journey creates a key through `/settings/api-keys`,
seeds owned and foreign projects plus persisted provenance/evidence/verification
rows in the disposable PostgreSQL database, including an owned claim with an
`approved` status, reviewer id, and deterministic `reviewedAt` timestamp. It
calls the real claims endpoint with the one-time secret and checks the reviewed
fields alongside the existing provenance/evidence/verification fields, missing,
revoked, and cross-owner responses. Focused contract and route fixtures retain
the pending/null approval metadata case:

```sh
npx playwright install chromium && npm run test:e2e -- tests/e2e/api-keys.spec.ts
```

## Protected project intake

The `/projects` surface is the authenticated intake for one public URL or one
pasted-text source. `POST /api/projects` creates an owner-scoped source in
`processing` state; the project workspace claims it through the process endpoint,
persists the existing claims/runs/revision transaction, and renders a safe retry
state when extraction fails. The shared contract suite covers exactly-one input,
trimmed text, queued responses, terminal status/error invariants, anonymous
denial, owner masking, and processing failure responses:

```sh
npm run test -- --run tests/unit/contracts/projects.test.ts tests/unit/projects-route.test.ts
```

It requires `DATABASE_URL` and the normal better-auth/E2E environment supplied
by `tests/e2e/playwright.config.ts`; the fixture stores only the API-key hash
and never persists the raw secret.

The export includes the nullable `processingRoute` discriminator and nullable
`processingTrace` metadata. Known routes preserve persisted computation
location, model-call, latency, transfer, and provider measurements; missing
measurements remain `null`. Legacy, absent, or malformed route metadata returns
both fields as `null` while preserving the claims, evidence excerpts, source
provenance, and review fields. Focused tests cover route normalization, the
exact Prisma select, malformed trace fallback, anonymous/owner-scoped 401/404
boundaries, and unchanged PATCH review semantics. The Playwright workspace
fixture signs in with real better-auth cookies, seeds a known route and an
owned legacy row, checks the API response and visible claims, and reads the
stored JSON trace back from the disposable PostgreSQL database; it also retains
cross-user and ownerless denial coverage.

The real database/API path is covered by the Playwright E2E suites; unit tests
mock only the auth, database, telemetry, and verification boundaries. Run the
focused contract and route tests with the command above; run the maintained
authenticated journey with:

```sh
npx playwright install chromium && npm run test:e2e
```

The maintained failure/retry journey in `tests/e2e/projects-workspace.spec.ts`
submits a unique `https://example.com/retry-*` URL. The source fixture returns a
503 on the first request for that path and readable text on the retry, so the
browser asserts the visible failed-source heading, role-alert error, enabled
`Retry processing` control, then the recovered atomic claim, source span, and
citation link. It also reads the disposable PostgreSQL state to confirm the
owner, normalized source content, one complete processing run, one valid claim,
and no failed or duplicate projection. The test runs under both the mobile and
desktop Playwright projects and checks for horizontal overflow:

```sh
npx playwright install chromium && npm run test:e2e -- tests/e2e/projects-workspace.spec.ts
```

## Claim evidence review panel

The protected `/projects/:projectId` route now exposes an owner-only review panel
for every persisted claim. Evidence status meanings are: `not checked` when no
verification run exists, `no independent evidence found` when a completed run
has no matching submitted passage, `contradiction found` when the persisted classification
or excerpts identify a contradiction, and `approved`/`rejected`/`pending
review` for the human decision. Supporting and contradicting excerpts retain
their document title, source link, and evidence date.

The maintained fixture seeds five claims, submits independent evidence through
the real API, verifies supported, no-evidence, contradicted, and stale cases, then
approves and rejects claims from the browser. It reloads the panel and matching
claim cards, reads approval status, reviewer id, and review timestamps back from
the disposable database, and checks that a second authenticated user receives a
404 when attempting a decision. Legacy raw SQL rows omit the approval columns
so the schema default is exercised.

Each review row and saved claim card also renders the persisted `sourcePassage`
as a highlighted source passage, its source-span offsets, the labeled source URL,
and every citation link. URL fixtures assert the link destinations, new-tab
attributes, and mobile/desktop no-overflow behavior. The pasted-text journey
asserts the same passage treatment plus the explicit no-external-source and
no-external-citations fallback.

Run the focused review contracts and route tests with:

```sh
npm run test -- --run tests/unit/claims-route.test.ts tests/unit/contracts/claims.test.ts
```

The owner review panel supports selecting the currently loaded claims and applying one
atomic approval or rejection decision to the selection. Bulk input is bounded to 100 unique
claim IDs and remains project-owner scoped. The focused route and contract tests cover valid
approval/rejection, malformed and duplicate selections, foreign IDs, transaction failures, and
preservation of the existing single-claim PATCH path. The maintained browser journey checks
disabled no-selection controls, successful approve/reject batches, failed-request selection
preservation, responsive no-overflow, individual review compatibility, and persisted
status/reviewer/timestamp values.

Run the maintained browser journey with:

```sh
npx playwright install chromium && npm run test:e2e
```

## Claims workspace filters

The protected `/projects/:projectId` claims workspace supports conjunctive filters for approval
(`pending`, `approved`, `rejected`), verification (`not-checked`, `supported`, `unsupported`,
`contradicted`, `stale`), and contradiction (`not-checked`, `found`, `none`). Omitted query
values mean `all`; repeated, empty, or unknown values return `400 { error: "Invalid claims query parameters." }`.
The route authenticates with the owner session or a valid read-only API key, derives verification
and contradiction from the latest completed owner-scoped run, and filters before count/pagination.
Contradiction is `found` for a `contradicted` result or any `contradicting` excerpt, `none` only
for a completed result without either signal, and `not-checked` when no result exists.

Run focused filter/serialization coverage with:

```sh
npm run test -- --run tests/unit/claims-route.test.ts tests/unit/contracts/claims.test.ts
```

The maintained evidence-verification journey reuses its five deterministic claims (supported,
unsupported, contradicted, current supported, and stale), exercises each filter plus a combined
zero-match selection, clears filters, and checks the filtered claim's source passage, source-span,
citation, evidence excerpts, and review control. It also asserts filtered API totals, persisted
approval decisions, failed filtered loads, accessible labels, and no horizontal overflow on the
iPhone 13 and desktop projects:

```sh
npx playwright install chromium && npm run test:e2e -- tests/e2e/evidence-verification.spec.ts
```

## Independent evidence verification

The project review route accepts secondary evidence through the protected
`POST /api/projects/:projectId/evidence-documents` endpoint. A document contains
a title, optional source URL/publication date, normalized content, and one or
more exact passages. The primary extraction `ClaimweaveSource` is never copied
into this table: the submission route rejects its URL or identical normalized
content, and verification queries only the project owner's submitted evidence
documents.

The policy is `independence-v1/freshness-365d`: dated passages older than 365
days at the verification timestamp are `stale`; fresh or undated matching
passages may support a claim, while a stale-only match is classified `stale`.
Negated matches are `contradicted`, and no matching independent passage is
`unsupported` on the wire and `no independent evidence found` in the review UI.
Each completed run stores its mode, policy, timestamps, one
result per extracted claim, and exact supporting/contradicting excerpts with
passage/document ids, source URLs, and evidence dates. Persistence is an
atomic nested Prisma transaction; failed model output is retained only as a
failed run and never as a partial completed result.
The persisted verification response also includes an `outcomeSummary` with
`supported`, `contradicted`, and `noIndependentEvidence` counts. These counts
come from the latest completed run's persisted results, not the paginated claims
response; `stale` remains visible on its claim and is excluded from all three
summary counters. The owner review header shows the same summary and reports
`Latest verification: Not verified yet` until a completed run exists, then shows
the persisted completion timestamp.
When a completed result differs from the previous completed result, that same
transaction adds an owner-scoped verification revision containing the claim,
result, evidence document/passage references, classification, freshness, error
state, source URL/date, and previous/current displayed excerpts. An identical
verification replay is a no-op; a failed verification rolls back the revision
and preserves only the existing failed-run handling.

The deterministic fixture suite is:

```sh
npm run test -- --run tests/unit/evidence-verification.test.ts tests/unit/evidence-verification-route.test.ts
```

It covers supported, unsupported/no-independent-evidence, contradicted, current dated, and stale dated
cases under a fixed clock, including summary counts of 2 supported, 1 contradicted,
and 1 no-independent-evidence result for the five-claim fixture, with stale excluded.
Controlled accuracy is supplied only by fixture
expected labels and is reported as `deterministic / mock`; normal production
runs leave accuracy unevaluated. The real browser journey is the existing
authenticated `/projects/:projectId` page: submit an independent passage,
assert the initial not-verified state, click “Verify evidence”, assert the
rendered/API summary and failed-verification preservation, and query the
disposable database for the completed run, every result, excerpt, mode, policy,
and timestamp. Run it with:

```sh
npx playwright install chromium
npm run test:e2e
```

For database-only persistence/read-back coverage, first run `npx prisma db push
--skip-generate` against a disposable `TEST_DATABASE_URL`, then run
`node --test tests/integration/evidence-verification.test.mjs`. The integration
fixture is skipped when that variable is absent and never points at a production
database.

The optional `live-model` request mode delegates only to the installed
`@/lib/ai/client` proxy, records `live-model` on the run, and never trusts
model-generated prose as evidence. It is not part of deterministic CI and may
require deployed Polsia AI credentials; malformed output returns 502 and a
missing proxy configuration returns 503.

## Citation-ready grounded answers

The protected `POST /api/projects/:projectId/grounded-answer` endpoint accepts a
question and uses only approved claims whose latest completed verification is
supported and fresh or undated. The server, rather than the model, assembles
the exact persisted supporting excerpts and validated citation URLs. Insufficient
approved evidence and a model insufficiency decision both return the stable
`grounded: false` shape. Requests may authenticate with the better-auth owner
session or an active `Authorization: Bearer cw_live_...` API key created from
`/settings/api-keys`. Invalid, malformed, unknown, and revoked keys return
`401 { error: "Unauthorized" }` without reading the project. A valid key for a
different or ownerless project returns `403 { error: "Forbidden" }`; an unknown
project returns the existing `404 { error: "Project not found." }` response.
Session-based cross-user requests remain masked as 404, and anonymous requests
remain 401.

Focused contract, eligibility, citation-assembly, AI-safety, and route-boundary
coverage:

```sh
npm run test -- --run tests/unit/grounded-answer.test.ts tests/unit/grounded-answer-route.test.ts tests/unit/api-keys-auth.test.ts
```

The maintained Playwright journey signs up two real users, seeds disposable
PostgreSQL projects with approved and ineligible claims plus persisted
verification excerpts, calls the real endpoint through the local deterministic
AI fixture, creates real Bearer keys through `/settings/api-keys`, asserts exact
server-backed citation fields for both session and API-key access, and checks
anonymous, malformed, revoked, unknown-project, and cross-owner denial:

```sh
npx playwright install chromium && npm run test:e2e -- tests/e2e/grounded-answer.spec.ts
```

## Exact extraction reuse benchmark

The exact-result reuse contract is versioned in
`src/lib/business/claim-extraction-reuse.ts`. It keys only normalized source
content plus evidence identity, task/prompt/schema versions, model and
generation parameters, tenant/permission scope, and the declared evidence
freshness policy. Cache hits are validated against the current source before
they enter the existing project/run/snapshot transaction, so source offsets and
citations are rechecked for every document version. No raw source text is
stored in cache entries or traces.

The local-first homepage route is covered by the provider-free unit selections
`npm run test -- --run tests/unit/local-first.test.ts tests/unit/contracts/local-first.test.ts`.
Those tests assert the cold-start, exact-repeat, changed-input, and fallback
trace labels plus nullable provider measurements. The homepage demo is an
authored decision trace, not live-model or token-savings evidence; it makes no
provider calls and intentionally labels device reuse as planned. The real
project journey remains the Playwright suite below against its disposable
database and local AI fixture.

The protected control route is `/api/admin/claim-extraction-benchmark`.
`GET` returns recent benchmark runs and redacted extraction traces; `POST` with
`{"mode":"preflight"}` performs the no-spend checks and `{"mode":"run"}`
would execute the real URL/text extraction path only after every gate passes.
Every route method uses the installed better-auth admin guard.

The reproducible command is:

```sh
node benchmarks/claim-extraction/run.mjs --preflight
```

The live form additionally requires an authorized admin session, but the runner
always preflights authorization reference, separate financial cap, model
permission, explicit paid-call opt-in, held-out dataset hash and gold
annotations, and provider attempt/usage observability before calling the API.
The checked-in config and request-sequence manifest intentionally contain no
dataset content or fabricated hash. The installed AI helper returns parsed
content only and hides provider request attempts, retries, and usage, so the
runner hard-stops with `framework_ai_client_hides_provider_attempts_and_usage`
and makes zero paid calls in this revision. Cost is therefore `unknown`, never
zero. The five-document pilot uses one cold request per variant; the remaining
five-case, two-variant workload has an arithmetic maximum of eight independent
documents after the pilot, below the requested 30. A missing held-out gold set
leaves quality `unknown`/blocked.

The local AI fixture remains a regression fixture only and is not benchmark
evidence. No benchmark command uses auto-top-up or prints credentials.

## CW-SUP-03 frozen acceptance gate

`node benchmarks/claim-extraction/run.mjs --offline` is the provider-free
regression command. It verifies the checked-in synthetic source, independent
annotation, corroboration, source-sequence scenarios, and both manifest hashes;
it must report `offlineProviderCallsMade: 0`. Its output is fixture evidence,
not a measured live token, cost, latency, or savings result.

The protected canonical API is
`/api/admin/claim-extraction-benchmark`. `GET` returns the validated frozen
spec identity, gate classifications, persisted runs, and redacted per-request
traces. `POST` accepts `mode=preflight` or `mode=run`; both remain fail-closed
until CW-SUP-01 and CW-SUP-02 are inspectable and correct, one current
consolidated owner request and cost cap exists, the external supervising
release record exists, held-out documents/hashes/annotations exist, and a
metadata-bearing framework AI seam is available. A blocked `mode=run` returns
HTTP 412, creates no benchmark row, and makes zero provider calls.

The gate reports `PASS`, `FAIL`, `BLOCKED`, or `INCONCLUSIVE` per gate with one
next action. It keeps extraction-stage quality separate from whole-pipeline
quality. Independent annotation dimensions are coverage, numbers, negation,
qualifiers, citations, and source spans. Token reduction is reported separately
from request count, cost, and latency; missing provider metadata remains
unknown, and 25% is an optimization target rather than an automatic pass.

The durable audit is `benchmarks/claim-extraction/evidence/acceptance-gate-v2.json`.
No live provider command belongs in the default unit, integration, or E2E path.

The checked-in offline evidence pack is under
`benchmarks/claim-extraction/fixtures/v1/`. It contains synthetic source
variants, independently authored reference annotations, separate corroboration
records, deterministic SHA-256 hashes, and six ordered reuse scenarios. Run it
with:

```sh
node benchmarks/claim-extraction/run.mjs --offline
```

The command reads only checked-in fixture files, never calls the app, database,
AI proxy, or a provider, and reports `offlineProviderCallsMade: 0`. It asserts
cold-start miss, exact-repeat hit, localized/content invalidation,
numeric/negation/date invalidation, expiry invalidation, and separate
permission/model/prompt rejection reasons. The report keeps provider attempts
observed as unknown because the installed framework AI client exposes no
metadata-bearing result. Usage normalization tests live in
`tests/unit/claim-extraction-usage.test.ts` and preserve omitted token/cost
dimensions as null rather than zero.

## Protected processing history

The owner-only `GET /api/projects/:id/history` endpoint returns every persisted
`ClaimweaveProcessingRun` in ascending version order, including immutable
snapshots, evidence state, processing route, claim count, and the nullable
`documentId`/`documentKind` identity of the primary source. Newly processed
runs always store the saved source id and `primary`; legacy rows render the
explicit `legacy document identity unavailable` fallback. The latest run is
compared with the immediately previous run. Snapshots match by the deterministic
source-offset key `sourceStart:sourceEnd`; therefore a moved source range is
reported as one removed claim plus one added claim. Text, source quote, source
URL, and citation links are the displayed values that make a matched claim
`changed`. Evidence state is a run-level transition independent of per-claim
verification classifications.
The response also returns deterministically ordered `revisions`. Each revision
has project ownership, a monotonic per-project version, an `ingestion` or
`verification` event kind, and ISO timestamps. Document snapshots identify
primary/imported source documents; claim snapshots retain source ranges and
previous/current claim ids; evidence snapshots retain verification result,
document, passage, source URL/date, classification, freshness, error state, and
displayed excerpt values. The route validates every JSON snapshot and returns a
safe 500 for malformed persisted data; it queries revisions by the authenticated
owner and never exposes another user's history.

The maintained browser fixture creates an owner, a second user, and two runs
with unchanged, changed, added, and removed spans. It also inserts owner-scoped
ingestion, verification, and document-only revisions. Claim snapshots retain
distinct previous/current text, source passages, ranges, source URLs, and
citations; evidence snapshots retain both classifications, freshness/error
states, excerpts, document metadata, dates, and source links. The fixture reads
the disposable PostgreSQL database back before visiting `/projects/:id/history`,
then checks API ordering, ISO timestamps, version-to-source identity, affected document identifiers, event
kinds, exact immutable values, and empty claim/evidence arrays for the
document-only revision.

The rendered journey selects each revision from an accessible chronological
list. It checks the focused added/removed/changed claim labels, stacked
previous/current values, source-passage ranges, safe source and citation links,
both evidence sides, and the explicit `No claim changes in this document-only revision.` state.
It retains the current-claim anchor back to
`/projects/:id#claim-...`, owner/anonymous denial, loading/error coverage, and
mobile/desktop `scrollWidth <= window.innerWidth + 1` assertions.

The same route surface has explicit empty, loading, and failure states: zero
runs show the dedicated no-history message, versions without revisions show the
no-revision message, delayed responses show the loading indicator, 401 shows a
sign-in link with a return URL, 404 shows the private/not-found state, and a
forced 500 shows the retry and back actions. One-run and zero-run responses
expose an explicit no-comparison state.

Run the focused history unit and route contracts with:

```sh
npm run test -- --run tests/unit/contracts/project-history.test.ts tests/unit/project-history.test.ts tests/unit/project-history-route.test.ts
npm run test -- --run tests/unit/claimweave-revisions.test.ts tests/unit/claim-extraction.test.ts tests/unit/url-import-process-route.test.ts tests/unit/evidence-verification.test.ts tests/unit/evidence-verification-route.test.ts
npx playwright install chromium && npm run test:e2e -- tests/e2e/projects-workspace.spec.ts
```

The focused persistence tests cover the version identity invariant,
transaction-coupled snapshots, malformed non-null identity, and nullable legacy
rows. The E2E fixture requires the disposable PostgreSQL schema to be updated
with `npx prisma db push` before the journey runs; the normal test commands do
not create a second history harness or migration.

Run the real authenticated rendering journey with:

```sh
npx playwright install chromium
npm run test:e2e
```
