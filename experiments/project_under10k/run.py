"""Run from repo root: python experiments/project_under10k/run.py.

Uses the frozen source snapshots, never needs a model API or tokenizer to run.
"""
import json
import platform
import random
import secrets
import statistics
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from flowcache.core import Cache, Harness
from flowcache.demo import measured
from flowcache.peer import PeerClient, serving_peer

HERE = Path(__file__).resolve().parent
REPEATS = 15


def main():
    text = (HERE / 'input.txt').read_text()
    edited = (HERE / 'edited_input.txt').read_text()
    local, source, empty_source = Cache(), Cache(), Cache()
    token = secrets.token_urlsafe(32)
    rows = {k: [] for k in ('baseline', 'cold_local', 'warm_local', 'warm_peer',
                            'cold_peer', 'edited_baseline', 'edited_local')}
    h = Harness(local)
    expected = h.run(text, 'baseline')['result_hash']
    expected_edit = h.run(edited, 'baseline')['result_hash']
    prime = measured(Harness(source), text)
    rng = random.Random(20260916)
    try:
        with serving_peer(source, token) as url, serving_peer(empty_source, token) as empty_url:
            remote = Harness(local, peer=PeerClient(url, token))
            cold_remote = Harness(local, peer=PeerClient(empty_url, token))
            for trial in range(REPEATS):
                order = list(rows)
                rng.shuffle(order)
                for case in order:
                    local.clear()
                    if case in ('warm_local', 'edited_local'):
                        h.run(text)
                    if case == 'baseline':
                        run = measured(h, text, 'baseline')
                    elif case == 'cold_local' or case == 'warm_local':
                        run = measured(h, text)
                    elif case == 'warm_peer':
                        run = measured(remote, text)
                    elif case == 'cold_peer':
                        run = measured(cold_remote, text)
                    elif case == 'edited_baseline':
                        run = measured(h, edited, 'baseline')
                    else:
                        run = measured(h, edited)
                    assert run['result_hash'] == (expected_edit if case.startswith('edited') else expected)
                    rows[case].append({'trial': trial, 'result_hash': run['result_hash'], 'metrics': run['metrics']})
                if (trial + 1) % 5 == 0:
                    print(f'{trial + 1}/{REPEATS} repetitions completed', flush=True)
        summary = {}
        for case, runs in rows.items():
            metrics = [r['metrics'] for r in runs]
            summary[case] = {k: statistics.median(m[k] for m in metrics) for k in (
                'cohost_process_cpu_ms', 'client_cpu_ms', 'wall_ms', 'download_body_bytes',
                'computed_nodes', 'local_hits', 'peer_hits', 'peer_requests')}
            cpus = sorted(m['cohost_process_cpu_ms'] for m in metrics)
            summary[case]['cpu_min_ms'] = cpus[0]
            summary[case]['cpu_max_ms'] = cpus[-1]
        for case, m in summary.items():
            base = summary['edited_baseline' if case.startswith('edited') else 'baseline']
            m['cpu_saved_pct'] = (1 - m['cohost_process_cpu_ms'] / base['cohost_process_cpu_ms']) * 100
            m['wall_saved_pct'] = (1 - m['wall_ms'] / base['wall_ms']) * 100
        cpu_base = summary['baseline']['cohost_process_cpu_ms']
        cpu_peer = summary['warm_peer']['cohost_process_cpu_ms']
        prime_cpu = prime['metrics']['cohost_process_cpu_ms']
        cumulative = [{'receiver_reuses': n, 'baseline_cpu_ms': n * cpu_base,
                       'priming_plus_reuse_cpu_ms': prime_cpu + n * cpu_peer,
                       'net_saved_pct': (1 - (prime_cpu + n * cpu_peer) / (n * cpu_base)) * 100}
                      for n in (1, 2, 5, 10, 100)]
        report = {'date': '2026-09-16', 'python': platform.python_version(),
                  'platform': platform.platform(), 'repetitions': REPEATS,
                  'input': json.loads((HERE / 'input_manifest.json').read_text()),
                  'correctness': f'{REPEATS * len(rows)} measured outputs matched fresh reference hashes',
                  'measurement_scope': 'CPU of this process including cohosted peer threads; downloaded HTTP body bytes only; no GPU/model inference',
                  'preparation_scope': 'client cache clear, warm preparation and peer startup excluded from timed requests; source priming reported separately; memory-backed SQLite',
                  'priming': prime['metrics'], 'summary': summary,
                  'cumulative_estimates': cumulative, 'runs': rows}
        (HERE / 'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
        print(json.dumps({'summary': summary, 'priming_cpu_ms': prime_cpu,
                          'cumulative_estimates': cumulative}, indent=2))
    finally:
        local.close()
        source.close()
        empty_source.close()


if __name__ == '__main__':
    main()
