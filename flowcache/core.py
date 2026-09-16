"""Deterministic document DAG, exact cache and scoped resource measurements.

No LLM calls, semantic cache, sleeps or simulated compute savings.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import sqlite3
import threading
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Protocol

EXECUTOR_VERSION = "char-minhash-v1"
MAX_TEXT_BYTES = 100_000
MAX_CHUNKS = 64
MAX_ARTIFACT_BYTES = 1_048_576


def canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def digest(value: Any) -> str:
    return hashlib.sha256(canonical(value)).hexdigest()


def node_identity(kind: str, inputs: Any, *, workspace: str, version: str,
                  acl_revision: str, permutations: int) -> dict:
    # Source content hashes act as snapshots. Order is preserved by the root.
    return {"kind": kind, "inputs": inputs, "workspace": workspace,
            "pipeline_version": version, "executor_version": EXECUTOR_VERSION,
            "acl_revision": acl_revision, "permutations": permutations}


def valid_payload(kind: str, value: Any, permutations: int) -> bool:
    if not isinstance(value, dict):
        return False
    if kind == "chunk":
        return (set(value) == {"sha256", "characters", "numbers", "negations", "minhash"}
                and isinstance(value["sha256"], str)
                and bool(re.fullmatch(r"[a-f0-9]{64}", value["sha256"]))
                and type(value["characters"]) is int and value["characters"] >= 0
                and isinstance(value["numbers"], list)
                and all(isinstance(x, str) for x in value["numbers"])
                and isinstance(value["negations"], list)
                and all(isinstance(x, str) for x in value["negations"])
                and isinstance(value["minhash"], list)
                and len(value["minhash"]) == permutations
                and all(isinstance(x, str) and re.fullmatch(r"[a-f0-9]{16}", x)
                        for x in value["minhash"]))
    if kind == "document":
        chunks = value.get("chunks")
        return (set(value) == {"chunks", "chunk_count", "characters", "numbers", "negations"}
                and isinstance(chunks, list) and len(chunks) <= MAX_CHUNKS
                and all(valid_payload("chunk", x, permutations) for x in chunks)
                and type(value["chunk_count"]) is int
                and value["chunk_count"] == len(chunks)
                and value["characters"] == sum(x["characters"] for x in chunks)
                and value["numbers"] == [n for x in chunks for n in x["numbers"]]
                and value["negations"] == [n for x in chunks for n in x["negations"]])
    return False


def validate_artifact(artifact: Any, identity: dict, now: float | None = None) -> bool:
    now = time.time() if now is None else now
    try:
        if not isinstance(artifact, dict) or set(artifact) != {
            "key", "identity", "created_at", "expires_at", "payload", "checksum"
        }:
            return False
        created, expires = artifact["created_at"], artifact["expires_at"]
        if (type(created) not in (float, int) or type(expires) not in (float, int)
                or not math.isfinite(created) or not math.isfinite(expires)
                or created > now + 5 or not created < expires or expires <= now):
            return False
        payload = artifact["payload"]
        if not valid_payload(identity["kind"], payload, identity["permutations"]):
            return False
        if identity["kind"] == "chunk":
            bound = payload["sha256"] == identity["inputs"]
        else:
            bound = identity["inputs"] == [digest({**identity, "kind": "chunk", "inputs": c["sha256"]})
                                            for c in payload["chunks"]]
        return (bound and artifact["identity"] == identity
                and artifact["key"] == digest(identity)
                and artifact["checksum"] == digest(payload))
    except (KeyError, TypeError, ValueError, OverflowError):
        return False


class Cache:
    """Bounded persistent cache; corrupt or stale entries become misses."""

    def __init__(self, path: str | Path = ":memory:", max_entries: int = 4096):
        if max_entries < 1:
            raise ValueError("max_entries must be positive")
        if str(path) != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(str(path), check_same_thread=False)
        self.lock = threading.RLock()
        self.max_entries = max_entries
        with self.connection:
            self.connection.execute("CREATE TABLE IF NOT EXISTS artifacts "
                                    "(key TEXT PRIMARY KEY, body BLOB NOT NULL, touched REAL NOT NULL)")

    def get(self, key: str, identity: dict | None = None) -> dict | None:
        with self.lock:
            row = self.connection.execute("SELECT body FROM artifacts WHERE key=?", (key,)).fetchone()
            if not row:
                return None
            try:
                artifact = json.loads(row[0])
                expected = identity if identity is not None else artifact["identity"]
                valid = artifact.get("key") == key and validate_artifact(artifact, expected)
            except (ValueError, TypeError, KeyError, AttributeError):
                valid = False
            if not valid:
                with self.connection:
                    self.connection.execute("DELETE FROM artifacts WHERE key=?", (key,))
                return None
            with self.connection:
                self.connection.execute("UPDATE artifacts SET touched=? WHERE key=?", (time.time(), key))
            return artifact

    def put(self, artifact: dict) -> None:
        if not validate_artifact(artifact, artifact["identity"]):
            raise ValueError("Invalid artifact")
        body = canonical(artifact)
        if len(body) > MAX_ARTIFACT_BYTES:
            return
        with self.lock, self.connection:
            self.connection.execute("INSERT OR REPLACE INTO artifacts VALUES (?,?,?)",
                                    (artifact["key"], body, time.time()))
            self.connection.execute("DELETE FROM artifacts WHERE key IN "
                                    "(SELECT key FROM artifacts ORDER BY touched DESC LIMIT -1 OFFSET ?)",
                                    (self.max_entries,))

    def clear(self) -> None:
        with self.lock, self.connection:
            self.connection.execute("DELETE FROM artifacts")

    def close(self) -> None:
        with self.lock:
            self.connection.close()


@dataclass
class Meter:
    local_hits: int = 0
    peer_hits: int = 0
    computed_nodes: int = 0
    compute_cpu_ms: float = 0
    client_cpu_ms: float = 0
    wall_ms: float = 0
    download_body_bytes: int = 0
    peer_requests: int = 0
    peer_errors: int = 0
    peer_rejected: int = 0
    events: list[dict] = field(default_factory=list)


class Peer(Protocol):
    def fetch(self, identity: dict, meter: Meter) -> dict | None: ...


def analyze_chunk(text: str, permutations: int) -> dict:
    """Character 5-gram MinHash. CPU work useful for lexical similarity only.

    Each independently salted BLAKE2b function selects the lowest shingle hash.
    This is a simple reference implementation, deliberately not a SIMD library.
    It does not assess meaning, truth, or equivalence of different prompts.
    """
    shingles = sorted({text[i:i + 5].encode("utf-8") for i in range(max(1, len(text) - 4))})
    signature = []
    for index in range(permutations):
        salt = index.to_bytes(8, "big")
        signature.append(min(hashlib.blake2b(s, digest_size=8, person=salt).hexdigest()
                             for s in shingles))
    return {"sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
            "characters": len(text), "numbers": re.findall(r"\d+(?:\.\d+)?%?", text),
            "negations": re.findall(r"不|未|无|没有|\b(?:not|never|no)\b", text, re.I),
            "minhash": signature}


class Harness:
    def __init__(self, cache: Cache, *, peer: Peer | None = None, workspace: str = "demo",
                 version: str = "v1", acl_revision: str = "1", ttl: float = 3600,
                 permutations: int = 128):
        if type(permutations) is not int or not 8 <= permutations <= 256:
            raise ValueError("permutations must be an integer from 8 to 256")
        if not math.isfinite(ttl) or not 0 < ttl <= 86400:
            raise ValueError("ttl must be between 0 and 86400 seconds")
        if any(not isinstance(x, str) or not 1 <= len(x) <= 100
               for x in (workspace, version, acl_revision)):
            raise ValueError("workspace, version and acl_revision must be 1–100 characters")
        self.cache, self.peer = cache, peer
        self.workspace, self.version, self.acl_revision = workspace, version, acl_revision
        self.ttl, self.permutations = ttl, permutations

    def identity(self, kind: str, inputs: Any) -> dict:
        return node_identity(kind, inputs, workspace=self.workspace, version=self.version,
                             acl_revision=self.acl_revision, permutations=self.permutations)

    def _get(self, identity: dict, meter: Meter, label: str, mode: str) -> dict | None:
        if mode == "baseline":
            return None
        artifact = self.cache.get(digest(identity), identity)
        if artifact is not None and time.time() - artifact["created_at"] >= self.ttl:
            artifact = None
        source = "local"
        if artifact is None and self.peer is not None:
            artifact = self.peer.fetch(identity, meter)
            source = "peer"
            if artifact is not None and time.time() - artifact["created_at"] >= self.ttl:
                meter.peer_rejected += 1
                artifact = None
            if artifact is not None:
                # Preserve original expiry; a download never extends freshness.
                self.cache.put(artifact)
        if artifact is not None:
            if source == "local":
                meter.local_hits += 1
            else:
                meter.peer_hits += 1
            meter.events.append({"node": label, "source": source, "key": artifact["key"][:12]})
            return artifact
        return None

    def _save(self, identity: dict, payload: dict, meter: Meter, label: str, mode: str,
              elapsed: float, expires_at: float | None = None) -> dict:
        now = time.time()
        artifact = {"key": digest(identity), "identity": identity, "created_at": now,
                    "expires_at": min(now + self.ttl, expires_at) if expires_at else now + self.ttl,
                    "payload": payload, "checksum": digest(payload)}
        if mode != "baseline" and artifact["expires_at"] > now:
            self.cache.put(artifact)
        meter.computed_nodes += 1
        meter.compute_cpu_ms += elapsed
        meter.events.append({"node": label, "source": "compute", "key": artifact["key"][:12],
                             "cpu_ms": round(elapsed, 3)})
        return artifact

    def run(self, text: str, mode: str = "cached") -> dict:
        if mode not in ("cached", "baseline"):
            raise ValueError("mode must be cached or baseline")
        if not isinstance(text, str) or not text.strip():
            raise ValueError("text cannot be empty")
        if len(text.encode("utf-8")) > MAX_TEXT_BYTES:
            raise ValueError(f"text exceeds {MAX_TEXT_BYTES} UTF-8 bytes")
        # Only normalize line endings. No case-folding, number removal or paraphrase reuse.
        chunks = [c for c in text.replace("\r\n", "\n").split("\n\n") if c]
        if len(chunks) > MAX_CHUNKS:
            raise ValueError(f"at most {MAX_CHUNKS} paragraphs are supported")
        start_wall, start_cpu = time.perf_counter(), time.thread_time()
        meter = Meter()
        chunk_ids = [self.identity("chunk", hashlib.sha256(c.encode("utf-8")).hexdigest()) for c in chunks]
        root_id = self.identity("document", [digest(i) for i in chunk_ids])
        artifact = self._get(root_id, meter, "document", mode)
        if artifact is None:
            children = []
            for index, (chunk, identity) in enumerate(zip(chunks, chunk_ids)):
                label = f"chunk:{index + 1}"
                child = self._get(identity, meter, label, mode)
                if child is None:
                    start = time.thread_time()
                    payload = analyze_chunk(chunk, self.permutations)
                    child = self._save(identity, payload, meter, label, mode,
                                       (time.thread_time() - start) * 1000)
                children.append(child)
            start = time.thread_time()
            payloads = [c["payload"] for c in children]
            result = {"chunks": payloads, "chunk_count": len(children),
                      "characters": sum(c["characters"] for c in payloads),
                      "numbers": [n for c in payloads for n in c["numbers"]],
                      "negations": [n for c in payloads for n in c["negations"]]}
            artifact = self._save(root_id, result, meter, "document", mode,
                                  (time.thread_time() - start) * 1000,
                                  min(c["expires_at"] for c in children))
        meter.client_cpu_ms = (time.thread_time() - start_cpu) * 1000
        meter.wall_ms = (time.perf_counter() - start_wall) * 1000
        return {"result": artifact["payload"], "result_hash": digest(artifact["payload"]),
                "metrics": asdict(meter), "mode": mode, "workspace": self.workspace,
                "version": self.version, "workload": EXECUTOR_VERSION}
