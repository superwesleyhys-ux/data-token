from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from .core import Cache, Harness
from .demo import SAMPLE_TEXT, benchmark
from .peer import PeerClient, make_peer_server
from .web import make_dashboard
from .search import search


def emit(value: dict, output: str | None = None):
    text = json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    if output:
        Path(output).write_text(text, encoding="utf-8")
        print(f"Saved {output}")
    else:
        print(text)


def main():
    parser = argparse.ArgumentParser(description="FlowCache: measurable compute reuse, no model API required")
    sub = parser.add_subparsers(dest="command", required=True)
    find = sub.add_parser("search", help="search source files and explicit document URLs without a model")
    find.add_argument("query")
    find.add_argument("--root", type=Path, default=Path("."))
    find.add_argument("--url", action="append", default=[], help="explicit document URL; may repeat up to 8 times")
    find.add_argument("--top-k", type=int, default=5)
    find.add_argument("--max-chars", type=int, default=4000)
    find.add_argument("--output")
    ui = sub.add_parser("demo", help="start the local interactive dashboard")
    ui.add_argument("--port", type=int, default=8080)
    ui.add_argument("--data-dir", type=Path, default=Path(".flowcache"))
    bench = sub.add_parser("benchmark", help="compare baseline, local and HTTP reuse")
    bench.add_argument("--repetitions", type=int, default=5)
    bench.add_argument("--output")
    bench.add_argument("--input", type=Path)
    bench.add_argument("--permutations", type=int, default=128)
    run = sub.add_parser("run", help="analyze a document with an optional trusted peer")
    run.add_argument("--input", type=Path)
    run.add_argument("--cache", type=Path, default=Path(".flowcache/local.sqlite3"))
    run.add_argument("--workspace", default="demo")
    run.add_argument("--version", default="v1")
    run.add_argument("--acl-revision", default="1")
    run.add_argument("--ttl", type=float, default=3600)
    run.add_argument("--permutations", type=int, default=128)
    run.add_argument("--baseline", action="store_true")
    run.add_argument("--peer", help="peer URL; token read only from FLOWCACHE_PEER_TOKEN")
    run.add_argument("--download-budget", type=int, default=262144)
    run.add_argument("--timeout", type=float, default=1.0)
    run.add_argument("--output")
    peer = sub.add_parser("peer", help="serve a precomputed cache on loopback")
    peer.add_argument("--cache", type=Path, default=Path(".flowcache/source.sqlite3"))
    peer.add_argument("--port", type=int, default=8090)
    args = parser.parse_args()
    try:
        if args.command == "search":
            emit(search(args.root, args.query, urls=args.url, top_k=args.top_k,
                        max_chars=args.max_chars), args.output)
        elif args.command == "demo":
            server = make_dashboard(args.data_dir, args.port)
            print(f"FlowCache demo: http://127.0.0.1:{server.server_port}", flush=True)
            print("Local CPU demo. No ChatGPT or model API calls. Ctrl+C to stop.", flush=True)
            try:
                server.serve_forever()
            except KeyboardInterrupt:
                pass
            finally:
                server.server_close()
                server.cache.close()
        elif args.command == "benchmark":
            text = args.input.read_text(encoding="utf-8") if args.input else SAMPLE_TEXT
            emit(benchmark(text, args.repetitions, args.permutations), args.output)
        elif args.command == "run":
            text = args.input.read_text(encoding="utf-8") if args.input else SAMPLE_TEXT
            client = PeerClient(args.peer, os.environ.get("FLOWCACHE_PEER_TOKEN", ""),
                                timeout=args.timeout, max_download_bytes=args.download_budget) if args.peer else None
            cache = Cache(args.cache)
            try:
                harness = Harness(cache, peer=client, workspace=args.workspace, version=args.version,
                                  acl_revision=args.acl_revision, ttl=args.ttl, permutations=args.permutations)
                emit(harness.run(text, "baseline" if args.baseline else "cached"), args.output)
            finally:
                cache.close()
        elif args.command == "peer":
            cache = Cache(args.cache)
            try:
                server = make_peer_server(cache, os.environ.get("FLOWCACHE_PEER_TOKEN", ""), port=args.port)
                print(f"Peer listening on http://127.0.0.1:{server.server_port}", flush=True)
                try:
                    server.serve_forever()
                except KeyboardInterrupt:
                    pass
                finally:
                    server.server_close()
            finally:
                cache.close()
    except (OSError, ValueError) as error:
        parser.exit(2, f"Error: {error}\n")


if __name__ == "__main__":
    main()
