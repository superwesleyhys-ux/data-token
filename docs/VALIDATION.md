# Validation record

Date: 2026-09-16. Environment: Python 3.12.14 / Linux x86_64. This is a historical record from before the English translation.

## Checks performed

- `python -m unittest discover -s tests -v`: 22 tests passed.
- `python -m flowcache benchmark --repetitions 7 --output examples/benchmark.local.json`: completed; output consistency checks passed.
- `node --check flowcache/static/app.js`: JavaScript syntax check passed.
- `python -m flowcache demo --port 8080`: local service started successfully.
- HTTP integration tests verified the home page, computation endpoints, and rejection of invalid Origin / Host values or missing request headers.

Coverage included cold and repeated runs; a baseline that does not populate the cache; changes to numbers, negations, paragraph order, or a single paragraph; workspace, task version, permission revision, and fingerprint parameter changes; TTL and tighter replacement TTLs; cache corruption; incorrect input binding; persistence and capacity; real HTTP transfers; a second local hit; incorrect tokens; download budgets; invalid signatures; unreachable peers; remote workspace isolation; and preservation of expiry times.

## Scope

No browser executable was available in that environment, and Playwright could not start a browser. Visual and click-through end-to-end checks were therefore not performed. Frontend code passed syntax checks, and the backend passed actual HTTP tests. CI was configured for Python 3.11 / 3.12 / 3.13, but remote CI had not been executed; this record reports only the Python 3.12 checks actually run.

Two-device WiFi, macOS / Windows launchers, SSH tunnels, and HTTPS deployment were not tested in that run. The README provides instructions for those environments, not a claim that they have been validated.

## Repeatable manual checks

1. Run `python3 -m flowcache demo`, then open `http://127.0.0.1:8080` in a browser.
2. Select **First run**, then **Run again**: computed nodes should drop from 7 to 0, with the same result hash.
3. Select **Edit last paragraph**: 2 nodes should be recomputed and 5 paragraphs reused locally.
4. Select **Reuse over network**: 1 document node should be a remote hit, downloaded bytes should exceed 0, and computed nodes should be 0. Preparation costs are shown separately.
5. Run the full comparison: the table should show 5 scenarios, and downloaded JSON should match the measurements.

## English translation validation (2026-09-17)

Validated on macOS with Python 3.14.5 after translating the documentation, dashboard, and default six-paragraph sample:

- All 36 existing unit and integration tests passed.
- JavaScript syntax and Git whitespace checks passed.
- Browser checks verified first computation (7 nodes), repeat reuse (0 computed nodes), last-paragraph edits (2 computed nodes / 5 local hits), remote reuse (1 peer hit / 0 computed nodes), and the complete comparison with consistency checks. No browser console warnings or errors were observed during those checks.
- The English layout was inspected at the default desktop viewport and at 390 pixels wide. Mobile line breaks were adjusted to prevent English phrases from running together.
- User-facing documentation, interface text, and the default sample contain no Chinese text. Multilingual test fixtures and supported negation patterns remain intentionally unchanged.
- Every tracked historical JSON record, prepared API prompt, and frozen project input was checked byte-for-byte against the pre-translation commit. The frozen source SHA-256 remains `6c0e43fba5860a4d08063b4a7289333f2e950f311c0cdd2064c2edfcd401d8e7`.

No model calls were needed for this translation validation. Historical performance figures above and in other reports still describe their original inputs.
