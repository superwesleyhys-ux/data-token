"""Hand-labeled smoke evaluation, not a held-out semantic search benchmark.

Run from repo root: python experiments/search_quality/run.py
Requires tiktoken only for evaluation, not the search implementation.
"""
import hashlib
import json
import statistics
import sys
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
import tiktoken
from flowcache.search import local_documents, search

CASES = [
    ('identifier', 'validate_artifact', 'core.py', 'def validate_artifact'),
    ('identifier', 'PeerClient', 'peer.py', 'class PeerClient'),
    ('identifier', 'make_dashboard', 'web.py', 'def make_dashboard'),
    ('identifier', 'fetch_document', 'search.py', 'def fetch_document'),
    ('identifier', 'analyze_chunk', 'core.py', 'def analyze_chunk'),
    ('english', 'expired artifact timestamp validation', 'core.py', 'expires <= now'),
    ('english', 'HMAC signature verification', 'peer.py', 'hmac.compare_digest'),
    ('english', 'per run network download budget remaining', 'peer.py', 'remaining ='),
    ('english', 'dashboard host origin request validation', 'web.py', 'def allowed'),
    ('english', 'benchmark median CPU priming', 'demo.py', 'statistics.median'),
    ('chinese', '缓存过期时间检查', 'core.py', 'expires <= now'),
    ('chinese', '远端结果签名校验', 'peer.py', 'hmac.compare_digest'),
    ('chinese', '网页正文提取过滤脚本', 'search.py', 'class VisibleText'),
    ('chinese', '命令行参数解析', '__main__.py', 'ArgumentParser'),
    ('chinese', '修改单段后局部重算', 'core.py', 'for index, (chunk, identity)'),
]


def main():
    enc = tiktoken.get_encoding('o200k_base')
    corpus = list(local_documents(ROOT / 'flowcache'))
    full_text = '\n\n'.join(json.dumps({'source':s, 'text':t}, ensure_ascii=False) for s,t in corpus)
    baseline = len(enc.encode(full_text))
    output = []
    # Refuse any networking during code search; a network attempt fails the run.
    with patch('flowcache.search.urllib.request.build_opener', side_effect=AssertionError('network forbidden')):
        for group, query, expected_file, marker in CASES:
            repetitions = [search(ROOT / 'flowcache', query, top_k=4, max_chars=2400) for _ in range(5)]
            r = repetitions[-1]
            assert all(item['results'] == r['results'] for item in repetitions)
            tokens = len(enc.encode(json.dumps(r, ensure_ascii=False, indent=2)))
            hits = r['results']
            output.append({'group':group, 'query':query, 'expected_file':expected_file,
                           'expected_marker':marker,
                           'target_file_found':any(h['source']==expected_file for h in hits),
                           'target_marker_returned':any(h['source']==expected_file and marker in h['text'] for h in hits),
                           'output_tokens':tokens, 'context_reduction_pct':100*(1-tokens/baseline),
                           'cpu_median_ms':statistics.median(item['metrics']['cpu_ms'] for item in repetitions),
                           'result_sources':[h['source'] for h in hits], 'results':hits})
    groups = {name:{'queries':len(items), 'target_file_hits':sum(i['target_file_found'] for i in items),
                   'target_marker_hits':sum(i['target_marker_returned'] for i in items),
                   'output_tokens_median':statistics.median(i['output_tokens'] for i in items)}
              for name in ('identifier','english','chinese')
              for items in [[i for i in output if i['group']==name]]}
    report = {'scope':'15 hand-labeled queries on this project, 5 executions each, top 4 chunks, 2400 body characters; not a general accuracy estimate',
              'tokenizer':'o200k_base', 'tokenizer_version':tiktoken.__version__,
              'corpus_tokens':baseline,'corpus_characters':len(full_text),
              'files':[{'source':s,'sha256':hashlib.sha256(t.encode()).hexdigest()} for s,t in corpus],
              'network_attempts':0,'model_calls':0,'groups':groups,
              'median_output_tokens':statistics.median(i['output_tokens'] for i in output),
              'median_cpu_ms':statistics.median(i['cpu_median_ms'] for i in output),
              'cases':output}
    (Path(__file__).parent/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print(json.dumps({k:v for k,v in report.items() if k not in ('files','cases')},ensure_ascii=False,indent=2))


if __name__ == '__main__':
    main()
