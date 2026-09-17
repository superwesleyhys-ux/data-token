# Local search without cloud model calls

This module performs code scanning, explicit document downloads, text extraction, keyword matching, ranking, and caching on the device running the program. It uses the Python standard library, with no LLM, embedding, or cloud search API. If a model invokes the tool and reads its results, the tool description and returned snippets still consume model tokens.

## Usage

Run from the repository root:

```bash
python3 -m flowcache search "cache expiry validation" --root ./flowcache --top-k 4 --max-chars 2400
```

Local code search does not access the network. Chinese queries can directly match Chinese documents. Results include file paths, source line ranges, matched terms, original text snippets, and measurements. Line ranges describe the candidate source section and may be wider than the truncated text displayed.

To fetch an explicitly specified page and search it alongside the code:

```bash
python3 -m flowcache search "argument parser" --root ./flowcache \
  --url https://docs.python.org/3/library/argparse.html \
  --top-k 4 --max-chars 2400
```

Network requests originate from the device running Python and do not invoke OpenAI search or a model. Pages are cached for one hour by default under `.flowcache/web-search` inside the selected root. Valid cached pages are not downloaded again. If a fetch fails, local results are still returned and the error is recorded; there is no automatic switch to a paid service. HTTP redirects are not followed automatically: provide the final page URL directly.

## Using it in a coding workflow

A coding assistant with terminal access can run the command above, read only the returned snippets, and open relevant parts of specific files if more context is needed. It does not need to read the entire repository or every full document. The current version provides a CLI; it **does not automatically change global Codex configuration or replace its built-in search tools**.

Use `--max-chars` to limit the total snippet text, excluding JSON metadata, so large results are not inadvertently sent back to the model. The default is 4,000 characters. Characters are not tokens: ratios differ across languages, code, and paths. The CLI does not depend on a tokenizer, so its character budget alone cannot establish actual billing savings.

## Limits

- Searches local code and explicitly supplied document URLs. It does not discover pages across the web or provide cloud semantic reasoning. Web-wide discovery requires a separate search service or a self-hosted index.
- Ranking uses BM25-style lexical scoring, with adjacent two-character units for Chinese. It can miss synonyms. No matches produce an empty list, not a fabricated answer.
- Hidden files, symbolic links, dependencies, and generated directories are skipped by default. Limits are 512 KB per file and 2,000 files / 32 MB of local text. Run only against trusted directories you select; these filters are not a comprehensive secret scanner.
- At most 8 explicit document URLs are accepted per search, with a 1 MB download limit per document. Network counters cover successfully returned bodies only; failed transfers may also consume bandwidth.
- Returned text is marked as untrusted source data, not new assistant instructions. Keyword extraction is not a complete defense against prompt injection.
- Running on your computer uses your computer's network. A chat execution environment's network is not the same as an iPad's network. Native iPad browser integration is not implemented.

Tests cover network-free local search, character budgets, Chinese matching, deleted-file invalidation, symbolic-link exclusion, actual HTTP downloads followed by cache hits, fetch-error fallback, and rejection of non-HTTP URLs.

## Recorded validation

On 2026-09-16, the original 22 tests plus 7 new tests passed, for a total of 29. Actual loopback HTTP verified downloading and caching. Fetching public Python documentation failed because DNS resolution was unavailable in that execution environment. Public-network downloading and iPad networking were therefore not considered validated.

For the query `cache expiry validation` against `flowcache/`, the complete contents of 10 text files, including path wrappers, contained 17,269 o200k_base tokens. The returned complete JSON, including snippets, sources, and measurement metadata, contained 970 tokens: a context-size reduction of approximately 94.38% relative to sending everything. This was not an actual Codex session bill. Real model input, output, reasoning tokens, and final coding quality were not measured. Different queries, budgets, or corpora can produce very different results.

Measurements are in `examples/local-search-validation.json`, including the failed public-network test. The earlier 9,640-token experiment used frozen input and does not describe the full project after the search module was added.

Follow-up quality testing repeated 15 manually specified queries 5 times each. Identifier queries and English feature descriptions each found their target file in 5/5 cases, but returned snippets preserved the specified key code in only 3/5 cases. Chinese feature descriptions found the target implementation in 0/5 cases. Exceptions exposed by testing were fixed, bringing regression coverage to 32 passing tests, but retrieval quality did not pass full-replacement acceptance. See `experiments/search_quality/REPORT.md` and its raw records. Incomplete snippets or misses still require reading the original file or using another retrieval path.

These measurements predate the English translation. Historical data remains unchanged; rerunning against the translated source may produce different rankings and token counts.
