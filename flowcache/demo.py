"""Reproducible scenarios. All values are measured on the executing machine."""
from __future__ import annotations

import math
import platform
import secrets
import statistics
import time

from .core import Cache, Harness
from .peer import PeerClient, serving_peer

SAMPLE_TEXT = """In September 2026, a demonstration project began validating document computation reuse. The team organized 120 source documents and stored each paragraph as a separate input. Numbers, negations, and paragraph order affect the result; similar questions are not treated as identical. This paragraph describes input boundaries, data sources, and task versions. Every edit must trigger content-hash validation.

A network connection transfers results that have already been computed; it cannot create GPU capacity. The workstation breaks text into character fragments and computes MinHash fingerprints for lexical similarity comparisons. Identical content can reuse an existing fingerprint. This demo measures CPU time and downloaded bytes. It does not equate bandwidth with model inference or promise to reduce subscription usage.

The cache lifetime is 3600 seconds. Results can be reused only when the input, workspace, computation code, task parameters, and permission revision all match. Expired or invalid records require recomputation. Remote nodes use a shared authentication token, and the HTTP service binds only to loopback by default. Multiple users would require additional identity management and tenant-level access controls.

When the budget in paragraph 4 changes from 300 to 360, results for the first three paragraphs can still be reused. The fourth paragraph and aggregate must be updated; the remaining paragraphs stay independent. This experiment uses blank lines to separate paragraphs, without summarizing or rewriting their text. Changes to negations, prices, dates, or source versions will not reuse the old exact result. Adding a paragraph does not force every task to run again.

Acceptance checks cover both correctness and resource consumption. Run the task without caching first, then measure the initial cache fill, repeated local hits, HTTP downloads, and a single-paragraph edit. Download tests report the remote source's initial computation cost separately. All measurements come from the execution device. Loopback latency does not represent real home WiFi or a network between regions.

The goal is to reuse completed work safely. The dashboard shows whether each node was computed, found locally, or fetched from a peer, and preserves a result summary for comparison. Future integrations with local models or authorized APIs must revalidate correctness, latency, and total cost. This stage provides no ChatGPT login, subscription-quota proxy, free-compute exchange, or background external model calls."""


def measured(harness: Harness, text: str, mode: str = "cached") -> dict:
    # Includes every thread of this demo process, including its local HTTP peer.
    start = time.process_time()
    result = harness.run(text, mode)
    result["metrics"]["cohost_process_cpu_ms"] = (time.process_time() - start) * 1000
    return result


def benchmark(text: str = SAMPLE_TEXT, repetitions: int = 5, permutations: int = 128) -> dict:
    if type(repetitions) is not int or not 1 <= repetitions <= 20:
        raise ValueError("repetitions must be 1–20")
    cache, peer_cache = Cache(), Cache()
    runs: dict[str, list] = {k: [] for k in ("baseline", "cold_local", "warm_local", "warm_peer", "edited")}
    token = secrets.token_urlsafe(32)
    try:
        source = Harness(peer_cache, permutations=permutations)
        prime = measured(source, text)
        with serving_peer(peer_cache, token) as url:
            peer = PeerClient(url, token)
            local = Harness(cache, permutations=permutations)
            network = Harness(cache, peer=peer, permutations=permutations)
            expected = None
            for _ in range(repetitions):
                # Rotate order by trial to reduce simple order bias.
                order = ["baseline", "cold_local", "warm_local", "warm_peer", "edited"]
                order = order[_ % len(order):] + order[:_ % len(order)]
                for case in order:
                    cache.clear()
                    if case == "baseline":
                        run = measured(local, text, "baseline")
                    elif case == "cold_local":
                        run = measured(local, text)
                    elif case == "warm_local":
                        local.run(text)  # preparation excluded and cold_local is reported separately
                        run = measured(local, text)
                    elif case == "warm_peer":
                        run = measured(network, text)
                    else:
                        local.run(text)
                        edited = text + " Update: this paragraph has changed; the budget will not increase."
                        run = measured(local, edited)
                        reference = local.run(edited, "baseline")
                        if run["result_hash"] != reference["result_hash"]:
                            raise RuntimeError("edited output mismatch")
                    if case != "edited":
                        expected = expected or run["result_hash"]
                        if run["result_hash"] != expected:
                            raise RuntimeError("cached output mismatch")
                    # Preserve every measurement and result hash without duplicating
                    # the same large fingerprint payload for each repetition.
                    runs[case].append({k: v for k, v in run.items() if k != "result"})
        summary = {}
        for case, values in runs.items():
            metrics = [v["metrics"] for v in values]
            summary[case] = {k: statistics.median(m[k] for m in metrics) for k in (
                "cohost_process_cpu_ms", "client_cpu_ms", "compute_cpu_ms", "wall_ms",
                "download_body_bytes", "computed_nodes", "local_hits", "peer_hits")}
        base = summary["baseline"]["cohost_process_cpu_ms"]
        for case, value in summary.items():
            value["cpu_reduction_vs_baseline_pct"] = (1 - value["cohost_process_cpu_ms"] / base) * 100 if base else None
            # Edited input requires a different baseline; never compare different workloads.
            if case == "edited":
                value["cpu_reduction_vs_baseline_pct"] = None
        saved = base - summary["warm_peer"]["cohost_process_cpu_ms"]
        return {"schema_version": 1, "workload": "character-5gram-minhash",
                "network": "real HTTP over loopback; not a WiFi benchmark",
                "python": platform.python_version(), "platform": platform.platform(),
                "repetitions": repetitions, "permutations": permutations,
                "metrics_scope": "process CPU includes client and cohosted peer during each request; "
                                 "bytes are downloaded HTTP response bodies, excluding headers/TLS/TCP",
                "peer_priming": prime["metrics"], "summary": summary,
                "peer_priming_break_even_reuses": math.ceil(prime["metrics"]["cohost_process_cpu_ms"] / saved) if saved > 0 else None,
                "break_even_scope": "steady-state process CPU estimate, not money/energy; excludes setup and storage",
                "correctness": "all identical-input result hashes matched; edited result matched fresh computation",
                "runs": runs}
    finally:
        cache.close()
        peer_cache.close()
