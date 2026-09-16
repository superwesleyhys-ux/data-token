"""Authenticated artifact transport. HTTP is permitted only on loopback."""
from __future__ import annotations

import hashlib
import hmac
import http.client
import ipaddress
import json
import re
import threading
import urllib.error
import urllib.parse
import urllib.request
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .core import Cache, MAX_ARTIFACT_BYTES, Meter, canonical, digest, validate_artifact


def signature(artifact: dict, token: str) -> str:
    return hmac.new(token.encode(), canonical(artifact), hashlib.sha256).hexdigest()


def is_loopback(host: str) -> bool:
    if host.lower() == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def check_token(token: str) -> None:
    if not isinstance(token, str) or not 24 <= len(token) <= 256 or not token.isascii() or any(c.isspace() for c in token):
        raise ValueError("peer token must be 24–256 ASCII characters without whitespace")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class PeerClient:
    def __init__(self, url: str, token: str, *, timeout: float = 1.0,
                 max_download_bytes: int = 262_144):
        check_token(token)
        parts = urllib.parse.urlsplit(url)
        if (parts.scheme not in ("http", "https") or not parts.hostname
                or parts.username or parts.password or parts.query or parts.fragment
                or parts.path not in ("", "/")):
            raise ValueError("peer URL must be an http(s) origin without credentials")
        if parts.scheme == "http" and not is_loopback(parts.hostname):
            raise ValueError("remote peers require HTTPS; use an SSH tunnel for this demo")
        if not 0.01 <= timeout <= 10:
            raise ValueError("timeout must be 0.01–10 seconds")
        if type(max_download_bytes) is not int or not 0 <= max_download_bytes <= 10_485_760:
            raise ValueError("download budget must be 0–10 MiB")
        self.url, self.token = url.rstrip("/"), token
        self.timeout, self.max_download_bytes = timeout, max_download_bytes
        # Ignore environment proxy settings; never forward credentials on redirects.
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def fetch(self, identity: dict, meter: Meter) -> dict | None:
        remaining = self.max_download_bytes - meter.download_body_bytes
        # One transport error opens the circuit for the rest of this run.
        # Limit misses too: a long document must not issue unbounded lookups.
        if remaining <= 0 or meter.peer_errors > 0 or meter.peer_requests >= 8:
            return None
        key = digest(identity)
        request = urllib.request.Request(self.url + "/v1/artifacts/" + key,
                                         headers={"Authorization": "Bearer " + self.token})
        meter.peer_requests += 1
        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                length = int(response.headers.get("Content-Length", "-1"))
                if not 0 < length <= min(remaining, MAX_ARTIFACT_BYTES + 1024):
                    meter.peer_rejected += 1
                    return None
                parts = []
                received = 0
                while received < length:
                    part = response.read1(min(8192, length - received))
                    if not part:
                        break
                    received += len(part)
                    meter.download_body_bytes += len(part)
                    parts.append(part)
                body = b"".join(parts)
                if len(body) != length:
                    meter.peer_rejected += 1
                    return None
                envelope = json.loads(body)
                artifact, supplied = envelope["artifact"], envelope["signature"]
                if (not isinstance(supplied, str)
                        or not hmac.compare_digest(signature(artifact, self.token), supplied)
                        or not validate_artifact(artifact, identity)):
                    meter.peer_rejected += 1
                    return None
                return artifact
        except urllib.error.HTTPError as error:
            # Error bodies are empty on our peer; other peers are not downloaded.
            error.close()
            if error.code != 404:
                meter.peer_errors += 1
        except http.client.IncompleteRead as error:
            meter.download_body_bytes += len(error.partial)
            meter.peer_errors += 1
        except (OSError, ValueError, TypeError, KeyError, urllib.error.URLError, http.client.HTTPException):
            meter.peer_errors += 1
        return None


def make_peer_server(cache: Cache, token: str, host: str = "127.0.0.1", port: int = 0) -> ThreadingHTTPServer:
    check_token(token)
    if host not in ("127.0.0.1", "localhost"):
        raise ValueError("demo peer binds to loopback only; expose it through an SSH tunnel")

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_GET(self):
            if not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + token):
                self.send_response(401)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            match = re.fullmatch(r"/v1/artifacts/([a-f0-9]{64})", self.path)
            artifact = cache.get(match[1]) if match else None
            if artifact is None:
                self.send_response(404)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            body = canonical({"artifact": artifact, "signature": signature(artifact, token)})
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    return server


@contextmanager
def serving_peer(cache: Cache, token: str):
    server = make_peer_server(cache, token)
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
