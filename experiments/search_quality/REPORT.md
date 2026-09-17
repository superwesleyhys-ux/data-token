# Local search test results

The program runs and reduces returned context, but this quality check did not pass acceptance as a complete replacement for search. These are historical measurements from before the English translation.

## Regression tests and exceptions

All 32 tests passed. Before fixes, a corrupted cached-text field caused an AttributeError, and an unsupported page encoding caused a LookupError that interrupted search. Both were fixed, with an additional malformed-HTTP fallback test. Original exceptions are recorded in reproduced_errors.json; the complete regression log is in tests.txt.

## Retrieval quality

Fifteen manually specified queries were each repeated 5 times, for 75 runs. Each returned at most 4 snippets with a combined 2,400-character text budget. This small sample is not a general accuracy measurement on an independent corpus.

| Query type | Samples | Target file found | Required code returned |
| --- | ---: | ---: | ---: |
| Function or class name | 5 | 5/5 | 3/5 |
| English feature description | 5 | 5/5 | 3/5 |
| Chinese feature description | 5 | 0/5 | 0/5 |

The required-code check tests whether a preselected code string appears in a snippet from the expected file. It is stricter than finding the file but does not replace human evaluation of answer correctness. Query labels, returned snippets, and judgments are stored in results.json.

Two limitations were found: fixed-length snippets can omit required code from the same function, and Chinese-only lexical queries cannot reliably map to English identifiers and can be distracted by Chinese sample text. The current implementation should not be the sole retrieval source.

## Context size and timing

The complete text with path wrappers contained 17,299 tokens. The median complete JSON response across 15 queries contained 1,052 tokens, approximately 93.92% less than the full text. Counts use o200k_base and include returned metadata.

Median CPU time per query was approximately 5.87 ms. All 75 local queries completed with networking prohibited, without triggering network, model, or embedding calls.

This ratio describes context size, not actual Codex billing, task quality, or end-to-end development savings. Failed queries can still return substantial irrelevant context; lower token counts alone do not establish success.

## Network tests

Actual HTTP tests passed for loopback downloads, removal of scripts from HTML, and subsequent cache hits. A second network connection would have failed the test, confirming that the cached path made no additional request.

Fetching public Python documentation failed with `<urlopen error [Errno -3] Temporary failure in name resolution>`. Environment network restrictions were not bypassed.

The test did not use the user's iPad or Mac and did not replace Codex's built-in search.

## Reproduce

`python3 -m unittest discover -s tests -v`

`python3 experiments/search_quality/run.py` (the quality evaluation script requires tiktoken; the search implementation itself does not).

Semantic or bilingual retrieval and context expansion along function boundaries are needed before further acceptance testing on independent projects and real coding tasks.

Raw queries and result snippets preserve their original language as experimental evidence. Translating the current source changes the search corpus, so a fresh run may differ from these historical results.
