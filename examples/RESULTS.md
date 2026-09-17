# Recorded measurements

Date: 2026-09-16. Python 3.12.14; Linux-6.18.44-x86_64-with-glibc2.39.

These historical measurements used the original sample before the English translation, with 128 fingerprint dimensions and 7 repetitions per scenario. Values are medians. Network transfers used real HTTP loopback with source and client in the same process. The current English sample is a different workload, so new runs will not reproduce these exact timings or hashes.

| Scenario | Same-process CPU / ms | Elapsed / ms | Downloaded body / bytes | Computed nodes | CPU reduction vs. baseline |
| --- | ---: | ---: | ---: | ---: | ---: |
| Uncached baseline | 38.443 | 38.270 | 0 | 7 | 0.00% |
| Cold local fill | 40.115 | 39.899 | 0 | 7 | -4.35% |
| Local cache reuse | 0.737 | 0.642 | 0 | 0 | 98.08% |
| HTTP remote reuse | 3.602 | 3.504 | 16,581 | 0 | 90.63% |
| Last paragraph edited (different input) | 9.666 | 9.548 | 0 | 2 | Not compared |

Source priming required an additional **41.001 ms of CPU time**. Based on the measured warm-cache medians, approximately 2 subsequent reuses would amortize that initial CPU cost.

These observations apply only to this reference implementation and sample. They do not establish LLM, GPU, ChatGPT quota, or real WiFi savings. A cold fill can cost more than an uncached run; negative savings are preserved.

All identical-input result hashes matched. Reuse after editing also matched a full recomputation of the edited input. Per-run result hashes, raw measurements, and node traces are in [benchmark.local.json](benchmark.local.json).

Measurements exclude HTTP/TCP/TLS headers, SSH overhead, process startup, storage lifecycle costs, electricity, and hardware costs. Cross-machine use must account for source-side resources separately.
