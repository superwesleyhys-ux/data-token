import copy
import json
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch

from flowcache.core import Cache, Harness, Meter, canonical, digest, validate_artifact
from flowcache.demo import benchmark
from flowcache.peer import PeerClient, serving_peer, signature
from flowcache.web import make_dashboard

TEXT = "预算是300元，项目没有停止。\n\nThe release is not ready. Date: 2026-09-16.\n\n第三段记录测试结果，准确率为98%。"
TOKEN = "test-token-for-local-peer-12345678"


class HarnessTests(unittest.TestCase):
    def setUp(self):
        self.cache = Cache()
        self.addCleanup(self.cache.close)
        self.h = Harness(self.cache, permutations=8)

    def test_cold_warm_and_baseline_match(self):
        cold = self.h.run(TEXT)
        warm = self.h.run(TEXT)
        base = self.h.run(TEXT, "baseline")
        self.assertEqual(cold["result_hash"], warm["result_hash"])
        self.assertEqual(cold["result_hash"], base["result_hash"])
        self.assertEqual(cold["metrics"]["computed_nodes"], 4)
        self.assertEqual(warm["metrics"]["computed_nodes"], 0)
        self.assertEqual(warm["metrics"]["local_hits"], 1)
        self.assertEqual(base["metrics"]["local_hits"], 0)

    def test_edit_number_recomputes_only_changed_chunk_and_root(self):
        self.h.run(TEXT)
        edited = TEXT.replace("300", "360")
        run = self.h.run(edited)
        self.assertEqual(run["metrics"]["computed_nodes"], 2)
        self.assertEqual(run["metrics"]["local_hits"], 2)
        self.assertIn("360", run["result"]["numbers"])
        self.assertNotIn("300", run["result"]["numbers"])
        self.assertEqual(run["result_hash"], self.h.run(edited, "baseline")["result_hash"])

    def test_negation_changes_do_not_reuse_answer(self):
        before = self.h.run(TEXT)
        after = self.h.run(TEXT.replace("not ready", "ready"))
        self.assertNotEqual(before["result_hash"], after["result_hash"])
        self.assertEqual(after["metrics"]["computed_nodes"], 2)
        self.assertNotIn("not", after["result"]["negations"])

    def test_workspace_version_acl_and_parameters_separate_cache(self):
        self.h.run(TEXT)
        for kwargs in ({"workspace": "other"}, {"version": "v2"}, {"acl_revision": "2"}, {"permutations": 16}):
            with self.subTest(kwargs=kwargs):
                h = Harness(self.cache, **{"permutations": 8, **kwargs})
                self.assertEqual(h.run(TEXT)["metrics"]["computed_nodes"], 4)

    def test_order_change_reuses_chunks_not_root(self):
        self.h.run(TEXT)
        run = self.h.run("\n\n".join(reversed(TEXT.split("\n\n"))))
        self.assertEqual(run["metrics"]["computed_nodes"], 1)
        self.assertEqual(run["metrics"]["local_hits"], 3)
        self.assertTrue(run["result"]["chunks"][0]["numbers"] == ["98%"])

    def test_baseline_does_not_fill_cache(self):
        self.h.run(TEXT, "baseline")
        self.assertEqual(self.h.run(TEXT)["metrics"]["computed_nodes"], 4)

    def test_expired_artifacts_recompute(self):
        self.h.run(TEXT)
        with patch("flowcache.core.time.time", return_value=time.time() + 7200):
            self.assertEqual(self.h.run(TEXT)["metrics"]["computed_nodes"], 4)

    def test_tightening_ttl_does_not_accept_older_entries(self):
        self.h.run(TEXT)
        with patch("flowcache.core.time.time", return_value=time.time() + 10):
            strict = Harness(self.cache, permutations=8, ttl=1)
            self.assertEqual(strict.run(TEXT)["metrics"]["computed_nodes"], 4)

    def test_corrupt_cache_is_a_miss(self):
        expected = self.h.run(TEXT)["result_hash"]
        self.cache.connection.execute("UPDATE artifacts SET body=?", (b"not json",))
        run = self.h.run(TEXT)
        self.assertEqual(run["result_hash"], expected)
        self.assertEqual(run["metrics"]["computed_nodes"], 4)

    def test_rebound_payload_is_rejected(self):
        self.h.run(TEXT)
        a = json.loads(self.cache.connection.execute("SELECT body FROM artifacts LIMIT 1").fetchone()[0])
        identity = copy.deepcopy(a["identity"])
        a["payload"]["sha256"] = "0" * 64
        a["checksum"] = digest(a["payload"])
        self.assertFalse(validate_artifact(a, identity))

    def test_persistent_cache_and_capacity(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "test.sqlite3"
            cache = Cache(path)
            h = Harness(cache, permutations=8)
            h.run(TEXT)
            cache.close()
            cache = Cache(path, max_entries=2)
            try:
                self.assertEqual(Harness(cache, permutations=8).run(TEXT)["metrics"]["computed_nodes"], 0)
                Harness(cache, permutations=8).run("new input")
                self.assertLessEqual(cache.connection.execute("SELECT count(*) FROM artifacts").fetchone()[0], 2)
            finally:
                cache.close()

    def test_input_limits(self):
        for text in ("", "  ", "a" * 100001, "\n\n".join(["p"] * 65)):
            with self.subTest(text=text[:10]), self.assertRaises(ValueError):
                self.h.run(text)
        with self.assertRaises(ValueError):
            Harness(self.cache, permutations=True)


class PeerTests(unittest.TestCase):
    def setUp(self):
        self.source, self.dest = Cache(), Cache()
        self.addCleanup(self.source.close)
        self.addCleanup(self.dest.close)
        self.expected = Harness(self.source, permutations=8).run(TEXT)

    def test_http_transfer_and_second_local_hit(self):
        with serving_peer(self.source, TOKEN) as url:
            h = Harness(self.dest, peer=PeerClient(url, TOKEN), permutations=8)
            remote = h.run(TEXT)
            self.assertEqual(remote["result_hash"], self.expected["result_hash"])
            self.assertEqual(remote["metrics"]["peer_hits"], 1)
            self.assertGreater(remote["metrics"]["download_body_bytes"], 100)
            self.assertEqual(remote["metrics"]["computed_nodes"], 0)
            again = h.run(TEXT)
            self.assertEqual(again["metrics"]["peer_requests"], 0)
            self.assertEqual(again["metrics"]["download_body_bytes"], 0)

    def test_wrong_token_falls_back(self):
        with serving_peer(self.source, TOKEN) as url:
            h = Harness(self.dest, peer=PeerClient(url, TOKEN + "wrong"), permutations=8)
            run = h.run(TEXT)
            self.assertEqual(run["result_hash"], self.expected["result_hash"])
            self.assertEqual(run["metrics"]["computed_nodes"], 4)
            self.assertGreater(run["metrics"]["peer_errors"], 0)
            self.assertEqual(run["metrics"]["peer_requests"], 1)

    def test_budget_zero_disables_network_and_small_budget_rejects(self):
        with serving_peer(self.source, TOKEN) as url:
            for budget in (0, 10):
                self.dest.clear()
                run = Harness(self.dest, peer=PeerClient(url, TOKEN, max_download_bytes=budget), permutations=8).run(TEXT)
                self.assertEqual(run["metrics"]["computed_nodes"], 4)
                self.assertLessEqual(run["metrics"]["download_body_bytes"], budget)
                if budget == 0:
                    self.assertEqual(run["metrics"]["peer_requests"], 0)

    def test_failed_signature_falls_back(self):
        with serving_peer(self.source, TOKEN) as url:
            original = signature
            def altered(artifact, token):
                if threading.current_thread() is threading.main_thread():
                    return original(artifact, token)
                return "0" * 64
            with patch("flowcache.peer.signature", side_effect=altered):
                run = Harness(self.dest, peer=PeerClient(url, TOKEN), permutations=8).run(TEXT)
            self.assertEqual(run["metrics"]["computed_nodes"], 4)
            self.assertEqual(run["metrics"]["peer_hits"], 0)
            self.assertGreater(run["metrics"]["peer_rejected"], 0)

    def test_remote_workspace_isolation(self):
        with serving_peer(self.source, TOKEN) as url:
            run = Harness(self.dest, peer=PeerClient(url, TOKEN), workspace="other", permutations=8).run(TEXT)
            self.assertEqual(run["metrics"]["peer_hits"], 0)
            self.assertEqual(run["metrics"]["computed_nodes"], 4)

    def test_unreachable_peer_falls_back(self):
        with serving_peer(self.source, TOKEN) as url:
            pass
        run = Harness(self.dest, peer=PeerClient(url, TOKEN, timeout=0.1), permutations=8).run(TEXT)
        self.assertEqual(run["metrics"]["computed_nodes"], 4)
        self.assertGreater(run["metrics"]["peer_errors"], 0)

    def test_non_loopback_http_rejected(self):
        for url in ("http://192.168.1.20:8090", "ftp://localhost", "http://user:pass@localhost", "http://localhost/path"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                PeerClient(url, TOKEN)

    def test_download_does_not_refresh_expiry(self):
        with serving_peer(self.source, TOKEN) as url:
            Harness(self.dest, peer=PeerClient(url, TOKEN), permutations=8).run(TEXT)
            remote = self.dest.connection.execute("SELECT body FROM artifacts").fetchone()[0]
            artifact = json.loads(remote)
            self.assertEqual(artifact["expires_at"], self.source.get(artifact["key"])["expires_at"])


class DashboardAndBenchmarkTests(unittest.TestCase):
    def test_benchmark_verifies_correctness_and_reports_priming(self):
        report = benchmark(TEXT, repetitions=2, permutations=8)
        self.assertEqual(report["summary"]["warm_peer"]["computed_nodes"], 0)
        self.assertEqual(report["summary"]["warm_local"]["computed_nodes"], 0)
        self.assertGreater(report["peer_priming"]["cohost_process_cpu_ms"], 0)
        self.assertIsNone(report["summary"]["edited"]["cpu_reduction_vs_baseline_pct"])

    def test_dashboard_route_and_origin_validation(self):
        with tempfile.TemporaryDirectory() as tmp:
            server = make_dashboard(Path(tmp), port=0)
            thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
            thread.start()
            url = f"http://127.0.0.1:{server.server_port}"
            try:
                with urllib.request.urlopen(url) as r:
                    self.assertIn(b"FlowCache", r.read())
                data = canonical({"text": TEXT, "permutations": 8, "scenario": "cold"})
                request = urllib.request.Request(url + "/api/run", data=data, headers={"X-Flowcache": "1"})
                with urllib.request.urlopen(request) as r:
                    self.assertEqual(json.loads(r.read())["metrics"]["computed_nodes"], 4)
                for headers in ({}, {"X-Flowcache": "1", "Origin": "https://untrusted.example"},
                                {"X-Flowcache": "1", "Host": "untrusted.example"}):
                    with self.subTest(headers=headers), self.assertRaises(urllib.error.HTTPError) as raised:
                        urllib.request.urlopen(urllib.request.Request(url + "/api/run", data=data, headers=headers))
                    self.assertEqual(raised.exception.code, 403)
            finally:
                server.shutdown()
                server.server_close()
                thread.join()
                server.cache.close()


if __name__ == "__main__":
    unittest.main()
