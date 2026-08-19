from __future__ import annotations

import collections
import hashlib
import http.server
import os
import re
import sys
import tempfile
import threading
import time
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

SRC_DIR = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC_DIR))

import fast_download  # noqa: E402
from cancellation import CancellationRequested  # noqa: E402

DATA = bytes(range(256)) * 2048
_RANGE_RE = re.compile(r"bytes=([0-9]+)-([0-9]+)\Z")


class _Scenario:
    def __init__(self, mode: str = "normal") -> None:
        self.mode = mode
        self.lock = threading.Lock()
        self.counts: collections.Counter[tuple[str, str]] = collections.Counter()
        self.requests: list[tuple[str, str, dict[str, str]]] = []
        self.range_headers: list[str] = []
        self.base_url = ""

    def record(self, method: str, path: str, headers) -> int:  # noqa: ANN001
        with self.lock:
            self.counts[(method, path)] += 1
            self.requests.append(
                (
                    method,
                    path,
                    {name.casefold(): value for name, value in headers.items()},
                )
            )
            range_header = headers.get("Range")
            if range_header:
                self.range_headers.append(range_header)
            return self.counts[(method, path)]


class _QuietThreadingHTTPServer(http.server.ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request, client_address) -> None:  # noqa: ANN001
        # Tests intentionally close responses early for ignored/broken ranges.
        pass


@contextmanager
def _serve(mode: str = "normal"):
    scenario = _Scenario(mode)

    class Handler(http.server.BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.0"

        def log_message(self, format, *args) -> None:  # noqa: A002, ANN001
            pass

        def _empty(self, status: int, **headers: str) -> None:
            self.send_response(status)
            for name, value in headers.items():
                self.send_header(name.replace("_", "-"), value)
            self.send_header("Content-Length", "0")
            self.end_headers()

        def _redirect(self) -> None:
            self._empty(
                302,
                Location=f"http://127.0.0.1:{self.server.server_port}/file",
            )

        def _file_headers(self) -> None:
            self.send_header("Content-Length", str(len(DATA)))
            self.send_header("Accept-Ranges", "bytes")

        def do_HEAD(self) -> None:  # noqa: N802
            scenario.record("HEAD", self.path, self.headers)
            if self.path == "/redirect":
                self._redirect()
                return
            if scenario.mode == "head405":
                self._empty(405)
                return
            self.send_response(200)
            self._file_headers()
            self.end_headers()

        def do_GET(self) -> None:  # noqa: N802
            call_number = scenario.record("GET", self.path, self.headers)
            if self.path == "/redirect":
                self._redirect()
                return

            range_header = self.headers.get("Range")
            if range_header:
                if scenario.mode == "ignore-all":
                    self._full_response()
                else:
                    self._range_response(range_header)
                return

            if scenario.mode == "retry503" and call_number == 2:
                self._empty(503, Retry_After="0")
                return
            if scenario.mode == "forbidden":
                self._empty(403)
                return
            if scenario.mode == "slow":
                self._slow_response()
                return
            self._full_response()

        def _full_response(self) -> None:
            self.send_response(200)
            self.send_header("Content-Length", str(len(DATA)))
            self.end_headers()
            try:
                self.wfile.write(DATA)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def _range_response(self, value: str) -> None:
            match = _RANGE_RE.fullmatch(value)
            if not match:
                self._empty(416)
                return
            start, end = (int(part) for part in match.groups())
            if start > end or end >= len(DATA):
                self._empty(416)
                return

            with scenario.lock:
                range_number = len(scenario.range_headers)
            is_probe = start == 0 and end == 0 and range_number == 1
            if scenario.mode == "ignore" and not is_probe:
                self._full_response()
                return

            body = DATA[start : end + 1]
            response_start = start
            if scenario.mode == "bad-range" and not is_probe:
                response_start = start + 1

            self.send_response(206)
            self.send_header(
                "Content-Range",
                f"bytes {response_start}-{end}/{len(DATA)}",
            )
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if scenario.mode == "truncated" and not is_probe:
                body = body[: max(1, len(body) // 2)]
                self.close_connection = True
            try:
                self.wfile.write(body)
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass

        def _slow_response(self) -> None:
            self.send_response(200)
            self.send_header("Content-Length", str(len(DATA)))
            self.end_headers()
            try:
                for offset in range(0, len(DATA), 1024):
                    self.wfile.write(DATA[offset : offset + 1024])
                    self.wfile.flush()
                    time.sleep(0.005)
            except (BrokenPipeError, ConnectionResetError):
                pass

    server = _QuietThreadingHTTPServer(("127.0.0.1", 0), Handler)
    scenario.base_url = f"http://127.0.0.1:{server.server_port}"
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield scenario
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


class FastDownloadTests(unittest.TestCase):
    def setUp(self) -> None:
        # The scenario server listens on 127.0.0.1, which the SSRF guard blocks
        # by default. These tests target loopback deliberately, so they opt in
        # through the documented escape hatch.
        patcher = patch.dict(
            os.environ,
            {"VIDEOMEMO_ALLOW_PRIVATE_URLS": "1"},
        )
        patcher.start()
        self.addCleanup(patcher.stop)

    def assert_no_staging_files(self, directory: Path, destination: Path) -> None:
        self.assertEqual(
            [path.name for path in directory.iterdir() if path != destination],
            [],
        )

    def test_parallel_success_has_exact_bytes_hash_and_contiguous_ranges(self) -> None:
        with _serve() as server, tempfile.TemporaryDirectory() as tmp:
            destination = Path(tmp) / "video.bin"

            result = fast_download.download_http(
                f"{server.base_url}/file",
                destination,
                connections=4,
            )

            self.assertEqual(destination.read_bytes(), DATA)
            self.assertEqual(result.bytes_written, len(DATA))
            self.assertEqual(result.sha256, hashlib.sha256(DATA).hexdigest())
            self.assertTrue(result.used_ranges)
            self.assertEqual(result.connections, 4)
            segment_ranges = [
                tuple(int(value) for value in _RANGE_RE.fullmatch(header).groups())
                for header in server.range_headers
                if header != "bytes=0-0"
            ]
            segment_ranges.sort()
            self.assertEqual(len(segment_ranges), 4)
            self.assertEqual(segment_ranges[0][0], 0)
            self.assertEqual(segment_ranges[-1][1], len(DATA) - 1)
            self.assertTrue(
                all(
                    previous[1] + 1 == current[0]
                    for previous, current in zip(
                        segment_ranges, segment_ranges[1:]
                    )
                )
            )

    def test_head_not_supported_uses_range_probe(self) -> None:
        with _serve("head405") as server, tempfile.TemporaryDirectory() as tmp:
            destination = Path(tmp) / "headless.bin"

            result = fast_download.download_http(
                f"{server.base_url}/file", destination, connections=4
            )

            self.assertEqual(destination.read_bytes(), DATA)
            self.assertTrue(result.used_ranges)
            self.assertEqual(server.counts[("HEAD", "/file")], 1)
            self.assertIn("bytes=0-0", server.range_headers)

    def test_small_file_uses_one_connection(self) -> None:
        with _serve() as server, tempfile.TemporaryDirectory() as tmp:
            destination = Path(tmp) / "small.bin"
            original_minimum = fast_download.MIN_PART_SIZE
            fast_download.MIN_PART_SIZE = len(DATA) + 1
            try:
                result = fast_download.download_http(
                    f"{server.base_url}/file", destination, connections=4
                )
            finally:
                fast_download.MIN_PART_SIZE = original_minimum

            self.assertEqual(destination.read_bytes(), DATA)
            self.assertFalse(result.used_ranges)
            self.assertEqual(result.connections, 1)

    def test_range_ignored_falls_back_to_one_stream(self) -> None:
        for mode in ("ignore-all", "ignore"):
            with self.subTest(mode=mode), _serve(mode) as server:
                with tempfile.TemporaryDirectory() as tmp:
                    destination = Path(tmp) / "fallback.bin"

                    result = fast_download.download_http(
                        f"{server.base_url}/file", destination, connections=4
                    )

                    self.assertEqual(destination.read_bytes(), DATA)
                    self.assertFalse(result.used_ranges)
                    self.assertEqual(result.connections, 1)
                    full_gets = [
                        headers
                        for method, path, headers in server.requests
                        if method == "GET"
                        and path == "/file"
                        and "range" not in headers
                    ]
                    self.assertEqual(len(full_gets), 1)
                    if mode == "ignore":
                        self.assertGreater(len(server.range_headers), 1)

    def test_bad_content_range_and_truncation_do_not_commit(self) -> None:
        for mode in ("bad-range", "truncated"):
            with self.subTest(mode=mode), _serve(mode) as server:
                with tempfile.TemporaryDirectory() as tmp:
                    root = Path(tmp)
                    destination = root / "existing.bin"
                    destination.write_bytes(b"keep me")

                    with self.assertRaises(Exception) as raised:
                        fast_download.download_http(
                            f"{server.base_url}/file",
                            destination,
                            connections=4,
                        )

                    self.assertNotIsInstance(
                        raised.exception,
                        CancellationRequested,
                    )
                    self.assertEqual(destination.read_bytes(), b"keep me")
                    self.assert_no_staging_files(root, destination)

    def test_503_is_retried(self) -> None:
        with _serve("retry503") as server, tempfile.TemporaryDirectory() as tmp:
            destination = Path(tmp) / "retried.bin"

            result = fast_download.download_http(
                f"{server.base_url}/file", destination, connections=1
            )

            self.assertEqual(result.bytes_written, len(DATA))
            full_gets = [
                headers
                for method, _path, headers in server.requests
                if method == "GET" and "range" not in headers
            ]
            self.assertEqual(len(full_gets), 2)

    def test_403_is_not_retried(self) -> None:
        with _serve("forbidden") as server, tempfile.TemporaryDirectory() as tmp:
            destination = Path(tmp) / "forbidden.bin"

            with self.assertRaises(Exception) as raised:
                fast_download.download_http(
                    f"{server.base_url}/file", destination, connections=1
                )

            self.assertEqual(getattr(raised.exception, "code", None), 403)
            full_gets = [
                headers
                for method, _path, headers in server.requests
                if method == "GET" and "range" not in headers
            ]
            self.assertEqual(len(full_gets), 1)
            self.assertFalse(destination.exists())
            self.assert_no_staging_files(Path(tmp), destination)

    def test_cancellation_is_preserved_and_cleans_staging_files(self) -> None:
        with _serve("slow") as server, tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            destination = root / "existing.bin"
            destination.write_bytes(b"old file")
            cancel_event = threading.Event()

            def cancel_after_first_chunk(downloaded: int, total: int | None) -> None:
                self.assertEqual(total, len(DATA))
                if downloaded:
                    cancel_event.set()

            with self.assertRaises(CancellationRequested):
                fast_download.download_http(
                    f"{server.base_url}/file",
                    destination,
                    connections=1,
                    cancel_event=cancel_event,
                    on_progress=cancel_after_first_chunk,
                )

            self.assertEqual(destination.read_bytes(), b"old file")
            self.assert_no_staging_files(root, destination)

    def test_sensitive_headers_are_filtered_and_cross_host_headers_are_dropped(self) -> None:
        with _serve() as server, tempfile.TemporaryDirectory() as tmp:
            destination = Path(tmp) / "headers.bin"
            initial_url = (
                f"http://localhost:{server.base_url.rsplit(':', 1)[1]}/redirect"
            )

            result = fast_download.download_http(
                initial_url,
                destination,
                connections=1,
                headers={
                    "Authorization": "Bearer secret",
                    "Cookie": "session=secret",
                    "Proxy-Authorization": "Basic secret",
                    "Referer": "https://private.example/account",
                    "X-Private-Token": "another secret",
                    "User-Agent": "fast-download-test",
                },
            )

            self.assertEqual(destination.read_bytes(), DATA)
            self.assertTrue(result.final_url.startswith(server.base_url))
            for _method, _path, headers in server.requests:
                self.assertNotIn("authorization", headers)
                self.assertNotIn("cookie", headers)
                self.assertNotIn("proxy-authorization", headers)
            target_requests = [
                headers for _method, path, headers in server.requests if path == "/file"
            ]
            self.assertTrue(target_requests)
            for headers in target_requests:
                self.assertNotIn("referer", headers)
                self.assertNotIn("x-private-token", headers)
                self.assertEqual(headers.get("user-agent"), "fast-download-test")

    def test_rejects_non_http_urls_before_creating_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            destination = Path(tmp) / "invalid.bin"
            with self.assertRaises(ValueError):
                fast_download.download_http("file:///etc/passwd", destination)
            self.assertFalse(destination.exists())

    def test_private_addresses_require_explicit_opt_in(self) -> None:
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("VIDEOMEMO_ALLOW_PRIVATE_URLS", None)
            with self.assertRaisesRegex(ValueError, "private, loopback"):
                fast_download._validate_http_url("http://127.0.0.1/media.mp4")

    def test_stale_part_file_is_reclaimed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            part = Path(tmp) / "video.part"
            part.write_bytes(b"stale")
            stale_time = time.time() - fast_download.STALE_PART_SECONDS - 1
            os.utime(part, (stale_time, stale_time))

            fast_download._reserve_file(part)

            self.assertTrue(part.exists())
            self.assertEqual(part.stat().st_size, 0)


if __name__ == "__main__":
    unittest.main()
