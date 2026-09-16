"""Reproducible scenarios. All values are measured on the executing machine."""
from __future__ import annotations

import math
import platform
import secrets
import statistics
import time

from .core import Cache, Harness
from .peer import PeerClient, serving_peer

SAMPLE_TEXT = """2026年9月，示范项目开始验证文档计算复用。小组整理了120份材料，并把每段文本保存为独立输入。数字、否定词和段落顺序都影响结果；系统没有把相似的问题直接当作同一个问题。本段负责说明输入边界、数据来源与任务版本，每次修改都必须通过内容哈希触发验证。

网络连接负责传输已经生成的计算结果，不能凭空提供GPU算力。工作站先对文本生成字符片段，再计算可用于文字相似度比较的MinHash指纹。相同内容再次出现时，可以取得已有指纹。本演示测量CPU时间和下载字节数，不把网络流量标记为模型推理能力，也不承诺减少任何订阅产品的额度。

缓存保留期设为3600秒。结果只有在输入、工作区、计算代码、任务参数和权限修订号全部一致时才能复用。过期记录与校验失败的记录需要重新计算。远端节点使用共享密钥认证，HTTP服务默认仅绑定本机地址。若有多人共同使用，应进一步增加独立身份管理和分租户访问控制。

当第4段里的预算从300元改为360元时，前三段的计算结果仍可复用。第四段与汇总节点需要更新，剩余段落保持独立。本实验使用空行划分段落，没有对文字做摘要或改写。因此改变否定表述、价格、日期或来源版本，不会误中原来的精确缓存；新增段落也不会使全部任务强制重算。

项目验收同时检查正确性和资源消耗。先在没有缓存的情况下运行任务，再分别测量首次填充、本地重复命中、通过HTTP下载和单段编辑的行为。下载测试必须把远端首次生成结果的成本单独列出。所有统计都来自本机执行；环回网络的时延不能代表真实家庭WiFi，更不能代表跨地区网络。

最终目标是让已经完成的工作可以安全重复使用。系统面板展示每个节点是重新计算、本地命中还是远端命中，并保留结果摘要供用户核对。以后可以接入本地模型或经过授权的API，但必须重新测试正确性、延迟和总成本。本阶段没有ChatGPT登录、代理额度、免费算力交换或后台外部模型调用。"""


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
                        edited = text + " 追加：这一段已经修改，预算不增加。"
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
