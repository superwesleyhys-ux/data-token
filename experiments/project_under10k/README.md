# Reusing computation for a code project under 10,000 tokens

Input: all 6 backend Python source files from FlowCache, including filenames and JSON wrappers, totaling 9,640 o200k_base tokens. The edited version adds one valid comment at the end of web.py and contains 9,655 tokens. Frontend code, documentation, and tests are excluded.

This experiment computes character fingerprints over a real code project. It is not a large-model code-generation or reasoning request. All processing uses CPU computation, with no ChatGPT, OpenAI API, or local LLM calls. Token counts describe input size only.

## Reproduce

Run from the repository root:

```bash
python3 -m unittest discover -s tests -v
python3 experiments/project_under10k/run.py
```

Frozen input is included in this directory, so a tokenizer is not required to rerun the experiment. To independently verify token counts, install tiktoken and use `get_encoding("o200k_base").encode(text)`. The original environment used tiktoken 0.14.0.

Each scenario runs 15 times in an order shuffled with a fixed random seed. The input contains 6 file nodes and 1 aggregate node. Reports include every measurement, result hash, node trace, and median. The edited scenario is compared separately against full recomputation of the edited input.

The frozen inputs and historical JSON reports retain their original bytes, including multilingual source text. Translating them would invalidate their recorded hashes and token counts. The current English documentation describes those original measurements.

## Measurement boundaries

- Real HTTP requests run on 127.0.0.1 in the execution environment. The original run did not use the user's iPad, Mac, home WiFi, or cellular data.
- CPU fields cover every thread in the process during measurement, including the colocated HTTP server thread. They do not measure energy, money, or GPU capacity.
- Network counters measure response-body bytes actually read, excluding request and response headers, TCP/TLS, retransmissions, and interface-level totals.
- This comparison uses in-memory SQLite. Cache clearing, warm-cache preparation, and server startup are excluded from individual request measurements. Source priming is reported separately.
- Cumulative savings tables are estimates based on measured medians, not an additional 100 executed tasks. Initial computation is still required, and unique inputs cannot receive the same cache benefit.
- No iPad execution endpoint was connected during the original run. Permission to use data in a chat does not route server traffic through an iPad. Real iPad networking must be initiated by a browser or application on that device and measured separately.
