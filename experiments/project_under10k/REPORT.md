# Computation reuse for a 9,640-token backend project

**This measurement covers code fingerprinting, not large-model inference. It did not use the user's iPad network connection.** This historical report describes the original frozen input, not the later English demo sample.

## Input and execution

Six backend Python source files form 6 file nodes and 1 aggregate node. The original input contains 9,640 tokens; the edited input contains 9,655. Both were counted using o200k_base, including path and JSON wrappers but excluding frontend code, the README, and tests.

Each scenario ran 15 times in shuffled order, for 105 measurements. Every output matched full recomputation of the corresponding input. Two additional CLI runs computed 7 nodes on the first run and 0 on the second, with identical outputs. All 22 unit and integration tests passed.

## Measured medians

| Scenario | CPU / ms | Elapsed / ms | Downloaded body | CPU reduction |
| --- | ---: | ---: | ---: | ---: |
| Full recomputation | 770.362 | 768.067 | 0 bytes | 0.00% |
| Cold local cache fill | 781.173 | 779.232 | 0 bytes | -1.40% |
| Repeated input, local cache | 0.949 | 0.730 | 0 bytes | 99.88% |
| Repeated input, HTTP retrieval | 3.745 | 3.553 | 19,663 bytes | 99.51% |
| Remote miss, local recomputation | 781.842 | 779.175 | 0 bytes | -1.49% |
| Full recomputation after editing | 783.123 | 781.044 | 0 bytes | 0.00% |
| Partial recomputation after editing 1 file | 125.129 | 124.372 | 0 bytes | 84.02% |

Edited scenarios use full recomputation of the edited input as their baseline; all others use the original-input baseline. CPU includes the client and colocated HTTP node. Negative reduction means increased CPU consumption.

Source priming required another **808.201 ms of CPU time**, which is excluded from the warm-hit measurements.

## Including initial computation

The following table estimates total cost for N remote reuses of the same input using measured medians, including source priming. It does not represent an additional 100 experimental runs.

| Reuses | Recompute each time: total CPU / ms | Priming + network reuse: total CPU / ms | Net reduction |
| ---: | ---: | ---: | ---: |
| 1 | 770.36 | 811.95 | -5.40% |
| 2 | 1540.72 | 815.69 | 47.06% |
| 5 | 3851.81 | 826.93 | 78.53% |
| 10 | 7703.62 | 845.65 | 89.02% |
| 100 | 77036.19 | 1182.71 | 98.46% |

For this task, when the source result is reusable, transferring approximately 19.2 KiB avoids about 0.77 seconds of repeated CPU work. There is no fixed conversion from GB to computing power. These results do not measure GPU performance, ChatGPT tokens, or subscription-quota savings.

## iPad and experimental limitations

During the original run, the visible remote Mac execution device was offline and no iPad execution endpoint was available. Chat permissions could not establish an iPad network route. Transfers used real HTTP loopback in the execution environment; they do not represent iPad Safari, home WiFi, cellular data, or real wide-area latency.

An iPad test must originate in a browser or application on that device, or on an online computing device connected through the iPad's network, with separately collected results. No such test is claimed here.

The experiment uses in-memory SQLite and excludes process startup, table creation, warm-cache preparation, idle storage, electricity, GPU use, HTTP headers, TCP/TLS, and retransmissions. Fingerprinting is relatively expensive in this Python reference implementation; optimizing the computation kernel could reduce the savings percentage.

Reproduce with `python3 experiments/project_under10k/run.py`. This directory contains frozen input, file hashes, all raw samples, the execution script, and CLI validation results.
