# Continue testing in local Codex

The archived API A/B experiment is incomplete. The recorded validation covers local CPU computation, retrieval, and HTTP loopback transfers. Earlier 93%–99% figures describe context reduction or particular computation-reuse scenarios; they are not measured reductions in total Codex token consumption.

## Validate the project first

Run from the repository root. No model API is required:

```bash
python3 -m unittest discover -s tests -v
python3 -m flowcache search "analyze_chunk re.findall numbers" --root flowcache --max-chars 4000
python3 -m flowcache demo
```

The dashboard is available at http://127.0.0.1:8080.

## Task to give Codex

> Read CODEX_LOCAL_TEST.md and experiments/model_ab/README.md. In two independent working directories and sessions, use the same model to complete the same task: update numeric extraction in analyze_chunk in the frozen project's core.py to preserve leading positive and negative signs. Arm A may read only the task and complete project in experiments/model_ab/attempt-01/A_input.txt. Arm B must first perform local retrieval, then read only the task and retrieved context in the corresponding B_input.txt. Keep the model, reasoning settings, and output limits identical. Evaluate both arms with the acceptance logic in experiments/model_ab/run.py. Do not share A's answer with B. Record actual input, output, cached, and reasoning token usage reported by the execution provider, along with bytes, elapsed time, and test results. Mark unreported fields as unavailable; do not substitute tokenizer estimates. Compare savings only when both arms pass quality checks. Include every additional call and added context needed for further reading or corrections. Preserve failed samples.

If local Codex reports actual session usage, it can perform these two independent runs. This repository does not automatically intercept or replace Codex's built-in search, and it does not read login tokens from other applications. Signing in to local Codex with a subscription does not automatically provide this Python script with an API key.

## Prepared API comparison runner

For a controlled small-task comparison using actual API calls:

```bash
python3 experiments/model_ab/run.py --run --model YOUR_MODEL \
  --output experiments/model_ab/my-local-run
```

Configure `OPENAI_API_KEY` in the execution environment; do not store it in the repository. This entry point uses API metering, which differs from Codex subscription usage. Missing credentials or unavailable networking are recorded as blocked / incomplete. Each arm makes one call without automatic retries. Overwriting an output directory that already contains a report is rejected.

The default input is a frozen backend source snapshot previously counted at 9,640 tokens. See the manifest for preflight counts including task instructions. Preflight estimates and actual API usage are stored separately. Local search can truncate essential context, and Chinese-only retrieval has not passed quality acceptance; see experiments/search_quality/REPORT.md.

Frozen input and historical evidence preserve their original language and bytes. See [language and evidence preservation](docs/LANGUAGE.md).
