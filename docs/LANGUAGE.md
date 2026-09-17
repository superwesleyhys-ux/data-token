# Language and historical evidence

The README, guides, experiment reports, dashboard, and default sample use English.

Some source data intentionally remains multilingual:

- `tests/test_search.py` tests matching Chinese text. Translating its input would remove that coverage.
- `tests/test_harness.py` tests mixed-language numbers and negations.
- `flowcache/core.py` recognizes Chinese as well as English negations. These are supported input patterns, not interface messages.
- `experiments/search_quality/run.py` retains Chinese queries as a distinct evaluation category.
- Historical source snapshots, prepared model prompts, and raw experimental JSON preserve their original bytes and text. Their hashes, token counts, retrieval results, and measured timings depend on that content. They are experimental evidence, not untranslated product documentation.

In particular, `experiments/project_under10k/input.txt` and `edited_input.txt`, `experiments/model_ab/attempt-01/`, and existing raw JSON measurement files have not been rewritten. The frozen-project runner and model experiment continue to consume their original inputs.

The current default sample and interactive edit text have been translated into English. Existing benchmark reports describe the earlier sample; rerun measurements into a new output file to evaluate the English workload. Source translation can also change search rankings and corpus token counts. Historical measurements have not been relabeled as results for the translated version.
