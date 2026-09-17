# Actual-model A/B comparison on the same project and task

**The archived API attempt contains no actual model results.** Its `attempt-01/report.json` records a `blocked` state because credentials and a model selection were missing in the original environment. Usage is absent; tokenizer counts are not presented as actual invocation usage.

Both arms share the same frozen snapshot of 6 backend files, previously counted at 9,640 o200k_base tokens. The task is to update the numeric-extraction regex to preserve positive and negative signs. Both use the same model, output limit, reasoning settings, and six acceptance cases. Arm A receives the complete source; arm B receives context selected by local lexical search. Each arm makes one independent Responses API call, with no shared session.

This measures one small code-editing task, not a complete multi-turn Codex workflow or subscription usage. Arm B still needs a model to produce the change. Local file retrieval requires no network traffic, so retrieval traffic is recorded as 0; API request and response JSON bytes are measured separately. The experiment does not repeatedly download data to manufacture bandwidth usage or treat loopback traffic as user WiFi traffic.

## Run

Requires Python 3.11 or later. Configure `OPENAI_API_KEY` on the execution device; do not paste it into chat or store it in the repository. Preparing inputs requires no key:

```bash
python3 experiments/model_ab/run.py --output experiments/model_ab/prepared
```

To make two actual billable calls, replace the model name with one available to your account:

```bash
python3 experiments/model_ab/run.py --run --model YOUR_MODEL \
  --output experiments/model_ab/my-run
```

Use `--effort` to select a reasoning level supported by that model, or `--order BA` to reverse arm order. Missing credentials, permissions, network access, or response usage leave the report blocked / incomplete. Failed requests are not automatically retried. The runner does not read or copy login credentials from other applications. Use a new output directory for each experiment.

Outputs include raw `usage` (input, output, total, and provider-supplied details), model answers, six test results, API elapsed time, and request/response JSON byte counts. Cached tokens are included in input tokens; reasoning tokens are included in output tokens. Do not add those subsets twice. A comparable total-token reduction is calculated only when both arms finish, provide actual usage, report the same model, and pass task acceptance. One comparison cannot establish a stable average benefit.

API billing differs from ChatGPT subscription usage. This script records API response usage and does not read or change subscription billing. HTTP headers, TLS, TCP retransmissions, and total network-interface traffic are not measured.

Frozen prompts and source snapshots retain their original contents, including multilingual sample text, to preserve hashes and recorded token counts. All explanatory documentation is in English.

Implementation references: [text generation and Responses requests](https://developers.openai.com/api/docs/guides/text) and [prompt caching and usage measurement](https://developers.openai.com/api/docs/guides/prompt-caching).
