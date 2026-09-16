"""Single-user loopback dashboard. Not a public production web server."""
from __future__ import annotations

import json
import secrets
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .core import Cache, Harness, canonical
from .demo import SAMPLE_TEXT, benchmark, measured
from .peer import PeerClient, serving_peer

STATIC = Path(__file__).parent / "static"


def make_dashboard(data_dir: Path, port: int = 8080) -> ThreadingHTTPServer:
    cache = Cache(data_dir / "local.sqlite3")
    lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def allowed(self) -> bool:
            hosts = {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}
            if self.headers.get("Host") not in hosts:
                return False
            origin = self.headers.get("Origin")
            return not origin or origin in {"http://" + h for h in hosts}

        def send_body(self, status: int, body: bytes, content_type: str = "application/json; charset=utf-8"):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; "
                             "object-src 'none'; base-uri 'none'; frame-ancestors 'none'; connect-src 'self'")
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def do_GET(self):
            if not self.allowed():
                self.send_body(403, b'{"error":"invalid host or origin"}')
                return
            if self.path == "/api/sample":
                self.send_body(200, canonical({"text": SAMPLE_TEXT}))
                return
            assets = {"/": ("index.html", "text/html; charset=utf-8"),
                      "/app.js": ("app.js", "text/javascript; charset=utf-8"),
                      "/style.css": ("style.css", "text/css; charset=utf-8")}
            if self.path not in assets:
                self.send_body(404, b'{"error":"not found"}')
                return
            name, content_type = assets[self.path]
            self.send_body(200, (STATIC / name).read_bytes(), content_type)

        def do_POST(self):
            if not self.allowed() or self.headers.get("X-Flowcache") != "1":
                self.send_body(403, b'{"error":"invalid host, origin or request header"}')
                return
            if self.path not in ("/api/run", "/api/benchmark", "/api/clear"):
                self.send_body(404, b'{"error":"not found"}')
                return
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 700_000:
                    raise ValueError("invalid request size")
                body = json.loads(self.rfile.read(size))
                if not isinstance(body, dict):
                    raise ValueError("request must be a JSON object")
            except (ValueError, TypeError):
                self.send_body(400, b'{"error":"invalid JSON or request size"}')
                return
            if not lock.acquire(blocking=False):
                self.send_body(409, b'{"error":"another job is running"}')
                return
            try:
                text = body.get("text", SAMPLE_TEXT)
                permutations = body.get("permutations", 128)
                if self.path == "/api/clear":
                    cache.clear()
                    output = {"cleared": True}
                elif self.path == "/api/benchmark":
                    output = benchmark(text, repetitions=3, permutations=permutations)
                else:
                    scenario = body.get("scenario", "cached")
                    harness = Harness(cache, permutations=permutations)
                    prime = None
                    if scenario == "baseline":
                        output = measured(harness, text, "baseline")
                    elif scenario == "cold":
                        cache.clear()
                        output = measured(harness, text)
                    elif scenario == "cached":
                        output = measured(harness, text)
                    elif scenario in ("edited", "version"):
                        prime = measured(harness, text)
                        if scenario == "edited":
                            text += " 追加：本段已修改，预算不增加。"
                        else:
                            harness = Harness(cache, permutations=permutations, version="v2")
                        output = measured(harness, text)
                    elif scenario == "peer":
                        source_cache = Cache()
                        receiver_cache = Cache()
                        try:
                            prime = measured(Harness(source_cache, permutations=permutations), text)
                            token = secrets.token_urlsafe(32)
                            with serving_peer(source_cache, token) as url:
                                peer = PeerClient(url, token)
                                output = measured(Harness(receiver_cache, peer=peer,
                                                           permutations=permutations), text)
                        finally:
                            source_cache.close()
                            receiver_cache.close()
                    else:
                        raise ValueError("unknown scenario")
                    output["scenario"] = scenario
                    output["preparation_metrics"] = prime["metrics"] if prime else None
                    output["effective_text"] = text
                self.send_body(200, canonical(output))
            except (ValueError, TypeError) as error:
                self.send_body(400, canonical({"error": str(error)}))
            except Exception:
                self.send_body(500, b'{"error":"internal error; see terminal"}')
                import traceback
                traceback.print_exc()
            finally:
                lock.release()

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.daemon_threads = True
    server.cache = cache
    return server
