import tempfile
import hashlib
import http.client
import json
import time
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from flowcache.search import fetch_document, local_documents, retrieve, search


class LocalSearchTests(unittest.TestCase):
    def test_lexical_ranking_and_budget(self):
        docs = [('a.py', 'def cache_lookup():\n    return artifact\n' * 50),
                ('b.py', 'def unrelated(): return 1')]
        result = retrieve('cache lookup', docs, max_chars=200, top_k=1)
        self.assertEqual(result['results'][0]['source'], 'a.py')
        self.assertLessEqual(result['returned_text_characters'], 200)
        self.assertEqual(result['model_calls'], 0)

    def test_chinese_search_and_late_match(self):
        result = retrieve('缓存校验', [('doc.md', '背景材料 ' * 180 + '缓存校验拒绝过期结果')],
                          max_chars=200, top_k=1)
        self.assertIn('缓存校验', result['results'][0]['text'])

    def test_files_are_fresh_and_local_search_never_fetches(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'a.py').write_text('def cache(): pass')
            (root / '.env').write_text('PRIVATE_VALUE=secret')
            (root / 'link.py').symlink_to(root / '.env')
            with patch('flowcache.search.urllib.request.build_opener', side_effect=AssertionError('network access')):
                first = search(root, 'cache')
                self.assertEqual(len(first['results']), 1)
                self.assertEqual(first['metrics']['successful_download_body_bytes'], 0)
                (root / 'a.py').unlink()
                self.assertEqual(search(root, 'cache')['results'], [])
                self.assertEqual(list(local_documents(root)), [])

    def test_query_and_limits_are_validated(self):
        for query in ('', '!?', 'a' * 1001):
            with self.assertRaises(ValueError):
                retrieve(query, [])
        with self.assertRaises(ValueError):
            retrieve('cache', [], max_chars=0)

    def test_actual_http_fetch_then_offline_cache(self):
        page = b'<html><script>hidden-secret</script><h1>Cache guide</h1><p>Validate cache expiry.</p></html>'
        calls = []
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass
            def do_GET(self):
                calls.append(self.path)
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(page)))
                self.end_headers()
                self.wfile.write(page)
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, kwargs={'poll_interval': .01}, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                url = f'http://127.0.0.1:{server.server_port}/guide'
                first = search(root, 'cache expiry', urls=[url])
                self.assertEqual(first['metrics']['successful_download_body_bytes'], len(page))
                self.assertNotIn('hidden-secret', first['results'][0]['text'])
                with patch('flowcache.search.urllib.request.build_opener', side_effect=AssertionError('not cached')):
                    second = search(root, 'cache expiry', urls=[url])
                self.assertTrue(second['network'][0]['cache_hit'])
                self.assertEqual(len(calls), 1)
                self.assertEqual(first['results'], second['results'])
                with self.assertRaises(ValueError):
                    fetch_document(url, root / 'tiny', max_bytes=10)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_failed_fetch_keeps_local_results(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'a.py').write_text('def cache(): pass')
            with patch('flowcache.search.fetch_document', side_effect=OSError('offline')):
                result = search(root, 'cache', urls=['https://example.test/doc'])
            self.assertEqual(len(result['results']), 1)
            self.assertEqual(len(result['fetch_errors']), 1)

    def test_file_url_is_not_read(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError):
                fetch_document('file:///etc/passwd', Path(tmp))

    def test_malformed_cached_text_becomes_a_miss(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            url = 'https://example.test/doc'
            dest = root / (hashlib.sha256(url.encode()).hexdigest() + '.json')
            dest.write_text(json.dumps({'url': url, 'fetched_at': time.time(),
                                        'text': 123, 'checksum': 'broken'}))
            with patch('flowcache.search.urllib.request.build_opener', side_effect=OSError('offline')):
                with self.assertRaisesRegex(OSError, 'offline'):
                    fetch_document(url, root)

    def test_unknown_charset_keeps_local_results(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'a.py').write_text('def cache(): pass')
            with patch('flowcache.search.fetch_document', side_effect=LookupError('unknown encoding')):
                result = search(root, 'cache', urls=['https://example.test/doc'])
            self.assertEqual(len(result['results']), 1)
            self.assertIn('unknown encoding', result['fetch_errors'][0]['error'])

    def test_malformed_http_keeps_local_results(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'a.py').write_text('def cache(): pass')
            with patch('flowcache.search.fetch_document', side_effect=http.client.BadStatusLine('invalid status')):
                result = search(root, 'cache', urls=['https://example.test/doc'])
            self.assertEqual(len(result['results']), 1)
            self.assertEqual(len(result['fetch_errors']), 1)


if __name__ == '__main__':
    unittest.main()
