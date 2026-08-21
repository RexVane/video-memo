"""Dependency-free HTTP(S) downloader with validated parallel byte ranges."""

from __future__ import annotations

import concurrent.futures
import datetime as _datetime
import email.utils
import hashlib
import http.client
import io
import ipaddress
import os
import re
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Mapping, TypeVar

from cancellation import CancellationRequested, CancellationSignal, check_cancelled

ProgressCallback = Callable[[int, int | None], None]

MAX_CONNECTIONS = 4
MAX_ATTEMPTS = 3
REQUEST_TIMEOUT = 10.0
RETRY_BACKOFF = 0.05
MAX_RETRY_AFTER = 30.0
WAIT_INTERVAL = 0.05
CHUNK_SIZE = 64 * 1024
MIN_PART_SIZE = 64 * 1024
# A staging file older than this is assumed to be crash debris, not a live run.
STALE_PART_SECONDS = 6 * 60 * 60
# Abort a transfer that has made no forward progress for this long. The socket
# timeout alone cannot catch a server that dribbles one byte per timeout window.
IDLE_TIMEOUT = 120.0

_RETRYABLE_STATUS = {408, 429, 500, 502, 503, 504}
_SENSITIVE_HEADERS = {"authorization", "cookie", "proxy-authorization"}
_RESERVED_HEADERS = {
    "accept-encoding",
    "connection",
    "content-length",
    "host",
    "range",
    "transfer-encoding",
}
_CROSS_HOST_HEADERS = {"accept", "accept-encoding", "range", "user-agent"}
_CONTENT_RANGE_RE = re.compile(r"bytes ([0-9]+)-([0-9]+)/([0-9]+)\Z")
_DECIMAL_RE = re.compile(r"[0-9]+\Z")


@dataclass(frozen=True)
class FastDownloadResult:
    """Result of a successfully and atomically committed download."""

    destination: Path
    bytes_written: int
    sha256: str
    used_ranges: bool
    connections: int
    final_url: str


class FastDownloadError(RuntimeError):
    """Base class for downloader-specific failures."""


class DownloadValidationError(FastDownloadError):
    """Raised when an HTTP response does not match its declared byte range."""


class _RangeIgnored(FastDownloadError):
    def __init__(
        self,
        message: str,
        *,
        total: int | None = None,
        final_url: str | None = None,
    ) -> None:
        super().__init__(message)
        self.total = total
        self.final_url = final_url


class _RetryableNetworkError(FastDownloadError):
    pass


class _RetryableTransferError(FastDownloadError):
    pass


class _WorkerStopped(FastDownloadError):
    pass


class _SocketReadInterrupted(OSError):
    pass


@dataclass(frozen=True)
class _ProbeResult:
    total: int | None
    supports_ranges: bool
    final_url: str


@dataclass(frozen=True)
class _Segment:
    index: int
    start: int
    end: int
    path: Path

    @property
    def length(self) -> int:
        return self.end - self.start + 1


class _Progress:
    def __init__(self, callback: ProgressCallback | None, total: int | None) -> None:
        self._callback = callback
        self._total = total
        self._positions: dict[object, int] = {}
        self._lock = threading.Lock()

    def update(self, key: object, position: int) -> None:
        if self._callback is None:
            return
        with self._lock:
            self._positions[key] = position
            current = sum(self._positions.values())
        self._callback(current, self._total)


class _SafeRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Keep redirects on HTTP(S) and minimize cross-host forwarded headers."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        absolute_url = urllib.parse.urljoin(req.full_url, newurl)
        _validate_http_url(absolute_url)
        redirected = super().redirect_request(req, fp, code, msg, headers, absolute_url)
        if redirected is None:
            return None

        cross_host = _origin(req.full_url) != _origin(absolute_url)
        for attribute in ("headers", "unredirected_hdrs"):
            header_map = getattr(redirected, attribute, {})
            for name in list(header_map):
                lowered = name.casefold()
                if lowered in _SENSITIVE_HEADERS or (
                    cross_host and lowered not in _CROSS_HOST_HEADERS
                ):
                    del header_map[name]
        return redirected


_T = TypeVar("_T")


def _is_blocked_address(host: str) -> bool:
    """Return True when a hostname resolves only into non-public address space.

    Media URLs come from third-party pages, so an attacker-controlled page could
    otherwise point this transport at a router admin panel, a LAN service, or a
    cloud metadata endpoint (169.254.169.254). Set ``VIDEOMEMO_ALLOW_PRIVATE_URLS=1``
    to allow it deliberately (self-hosted media, localhost testing).
    """
    if os.environ.get("VIDEOMEMO_ALLOW_PRIVATE_URLS", "").strip() in {"1", "true", "TRUE"}:
        return False
    candidates: list[ipaddress.IPv4Address | ipaddress.IPv6Address] = []
    try:
        candidates.append(ipaddress.ip_address(host))
    except ValueError:
        try:
            infos = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
        except OSError:
            # Let the actual request surface the resolution failure instead.
            return False
        for info in infos:
            try:
                candidates.append(ipaddress.ip_address(info[4][0]))
            except ValueError:
                continue
    if not candidates:
        return False
    return all(
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_reserved
        or address.is_multicast
        or address.is_unspecified
        for address in candidates
    )


def _validate_http_url(url: str) -> None:
    try:
        parsed = urllib.parse.urlsplit(url)
        port = parsed.port
    except ValueError as exc:
        raise ValueError(f"Invalid HTTP URL: {url!r}") from exc
    if parsed.scheme.casefold() not in {"http", "https"} or not parsed.hostname:
        raise ValueError("Only http:// and https:// URLs are supported")
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("Credentials embedded in URLs are not supported")
    if _is_blocked_address(parsed.hostname):
        raise ValueError(
            "Refusing to fetch a private, loopback, or link-local address; "
            "set VIDEOMEMO_ALLOW_PRIVATE_URLS=1 to override"
        )
    del port  # Accessing it above validates malformed port values.


def _sanitize_headers(headers: Mapping[str, str] | None) -> dict[str, str]:
    sanitized: dict[str, str] = {}
    for name, value in (headers or {}).items():
        normalized = str(name).strip()
        lowered = normalized.casefold()
        if not normalized or lowered in _SENSITIVE_HEADERS or lowered in _RESERVED_HEADERS:
            continue
        sanitized[normalized] = str(value)
    sanitized["Accept-Encoding"] = "identity"
    return sanitized


def _origin(url: str) -> tuple[str, str, int | None]:
    parsed = urllib.parse.urlsplit(url)
    default_port = 443 if parsed.scheme.casefold() == "https" else 80
    return (
        parsed.scheme.casefold(),
        (parsed.hostname or "").casefold(),
        parsed.port if parsed.port is not None else default_port,
    )


def _headers_after_redirect(
    original_url: str,
    final_url: str,
    headers: Mapping[str, str],
) -> dict[str, str]:
    if _origin(original_url) == _origin(final_url):
        return dict(headers)
    return {
        name: value
        for name, value in headers.items()
        if name.casefold() in _CROSS_HOST_HEADERS
    }


def _make_request(
    url: str,
    *,
    method: str,
    headers: Mapping[str, str],
    byte_range: tuple[int, int] | None = None,
) -> urllib.request.Request:
    request_headers = dict(headers)
    if byte_range is not None:
        request_headers["Range"] = f"bytes={byte_range[0]}-{byte_range[1]}"
    return urllib.request.Request(url, headers=request_headers, method=method)


def _close_quietly(value: object) -> None:
    close = getattr(value, "close", None)
    if close is None:
        return
    try:
        close()
    except Exception:
        pass


def _interrupt_response(response) -> None:  # noqa: ANN001
    """Wake blocking socket I/O without contending on buffered-reader locks."""
    fp = getattr(response, "fp", None)
    raw = getattr(fp, "raw", None)
    interruptor = getattr(response, "_videomemo_interruptor", None) or getattr(
        raw,
        "_interruptor",
        None,
    )
    if interruptor is not None:
        interruptor.interrupt()
    sock = getattr(response, "sock", None) or getattr(raw, "_sock", None)
    if sock is None:
        # Test doubles and unusual response wrappers may not expose their
        # socket. Their close implementation is the only available wake-up.
        _close_quietly(response)
        return
    try:
        sock.shutdown(socket.SHUT_RDWR)
    except (OSError, ValueError):
        pass


class _ConnectionInterruptor:
    """Track the connection currently blocked inside ``urllib.open``."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._connection: object | None = None
        self._stopped = threading.Event()

    def attach(self, connection: object) -> None:
        with self._lock:
            self._connection = connection
            stopped = self._stopped.is_set()
        if stopped:
            _interrupt_response(connection)

    def clear(self, connection: object) -> None:
        with self._lock:
            if self._connection is connection:
                self._connection = None

    def interrupt(self) -> None:
        self._stopped.set()
        with self._lock:
            connection = self._connection
        if connection is not None:
            _interrupt_response(connection)

    def interrupt_if_stopped(self, connection: object) -> None:
        if self._stopped.is_set():
            _interrupt_response(connection)

    def is_stopped(self) -> bool:
        return self._stopped.is_set()


class _InterruptibleSocketIO(socket.SocketIO):
    """Socket reader that polls cancellation without poisoning timed-out I/O."""

    def __init__(
        self,
        sock: socket.socket,
        interruptor: _ConnectionInterruptor,
    ) -> None:
        super().__init__(sock, "r")
        self._interruptor = interruptor

    def readinto(self, buffer) -> int | None:  # noqa: ANN001
        self._checkClosed()
        self._checkReadable()
        sock = self._sock
        original_timeout = sock.gettimeout()
        if original_timeout == 0:
            try:
                return sock.recv_into(buffer)
            except BlockingIOError:
                return None

        deadline = (
            None
            if original_timeout is None
            else time.monotonic() + original_timeout
        )
        while True:
            if self._interruptor.is_stopped():
                raise _SocketReadInterrupted("HTTP response read interrupted")

            poll_timeout = WAIT_INTERVAL
            if deadline is not None:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise socket.timeout("timed out")
                poll_timeout = min(poll_timeout, remaining)
            try:
                # Closing or shutting down a socket from another thread does
                # not reliably wake socket.makefile() reads on Windows. A
                # bounded recv timeout lets this reader observe cancellation
                # directly without leaving a background request worker alive.
                sock.settimeout(poll_timeout)
                try:
                    return sock.recv_into(buffer)
                except socket.timeout:
                    if deadline is not None and time.monotonic() >= deadline:
                        raise
                    continue
                except BlockingIOError:
                    continue
                except OSError as exc:
                    if self._interruptor.is_stopped():
                        raise _SocketReadInterrupted(
                            "HTTP response read interrupted"
                        ) from exc
                    raise
            finally:
                try:
                    sock.settimeout(original_timeout)
                except (OSError, ValueError):
                    pass


class _InterruptibleResponseSocket:
    """Provide HTTPResponse with an interruptible equivalent of makefile()."""

    def __init__(
        self,
        sock: socket.socket,
        interruptor: _ConnectionInterruptor,
    ) -> None:
        self._sock = sock
        self._interruptor = interruptor

    def makefile(self, mode: str):  # noqa: ANN201
        if mode != "rb":
            raise ValueError(f"unsupported HTTP response socket mode: {mode!r}")
        raw = _InterruptibleSocketIO(self._sock, self._interruptor)
        self._sock._io_refs += 1  # noqa: SLF001
        try:
            return io.BufferedReader(raw)
        except BaseException:
            raw.close()
            raise


class _InterruptibleHTTPResponse(http.client.HTTPResponse):
    def __init__(
        self,
        sock: socket.socket,
        interruptor: _ConnectionInterruptor,
        debuglevel: int = 0,
        method: str | None = None,
        url: str | None = None,
    ) -> None:
        self._videomemo_interruptor = interruptor
        super().__init__(
            _InterruptibleResponseSocket(sock, interruptor),
            debuglevel=debuglevel,
            method=method,
            url=url,
        )


class _TrackedHTTPConnection(http.client.HTTPConnection):
    def __init__(
        self,
        host: str,
        interruptor: _ConnectionInterruptor,
        **kwargs,
    ) -> None:  # noqa: ANN003
        self._interruptor = interruptor
        super().__init__(host, **kwargs)
        self.response_class = (
            lambda sock, *args, **response_kwargs: _InterruptibleHTTPResponse(
                sock,
                interruptor,
                *args,
                **response_kwargs,
            )
        )
        interruptor.attach(self)

    def connect(self) -> None:
        super().connect()
        # Cancellation may arrive while DNS resolution or connect is inside the
        # platform socket layer, before ``self.sock`` can be interrupted.
        self._interruptor.interrupt_if_stopped(self)


class _TrackedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(
        self,
        host: str,
        interruptor: _ConnectionInterruptor,
        **kwargs,
    ) -> None:  # noqa: ANN003
        self._interruptor = interruptor
        super().__init__(host, **kwargs)
        self.response_class = (
            lambda sock, *args, **response_kwargs: _InterruptibleHTTPResponse(
                sock,
                interruptor,
                *args,
                **response_kwargs,
            )
        )
        interruptor.attach(self)

    def connect(self) -> None:
        super().connect()
        self._interruptor.interrupt_if_stopped(self)


class _InterruptibleHTTPHandler(urllib.request.HTTPHandler):
    def __init__(self, interruptor: _ConnectionInterruptor) -> None:
        super().__init__()
        self._interruptor = interruptor

    def http_open(self, request):  # noqa: ANN001, ANN201
        connection: http.client.HTTPConnection | None = None

        def create(host: str, **kwargs) -> http.client.HTTPConnection:
            nonlocal connection
            connection = _TrackedHTTPConnection(
                host,
                self._interruptor,
                **kwargs,
            )
            return connection

        try:
            return self.do_open(create, request)
        finally:
            if connection is not None:
                self._interruptor.clear(connection)


class _InterruptibleHTTPSHandler(urllib.request.HTTPSHandler):
    def __init__(self, interruptor: _ConnectionInterruptor) -> None:
        super().__init__()
        self._interruptor = interruptor

    def https_open(self, request):  # noqa: ANN001, ANN201
        connection: http.client.HTTPSConnection | None = None

        def create(host: str, **kwargs) -> http.client.HTTPSConnection:
            nonlocal connection
            connection = _TrackedHTTPSConnection(
                host,
                self._interruptor,
                **kwargs,
            )
            return connection

        try:
            return self.do_open(
                create,
                request,
                context=self._context,
                check_hostname=self._check_hostname,
            )
        finally:
            if connection is not None:
                self._interruptor.clear(connection)


def _interruptible_opener(interruptor: _ConnectionInterruptor):  # noqa: ANN202
    return urllib.request.build_opener(
        urllib.request.ProxyHandler({}),
        _SafeRedirectHandler(),
        _InterruptibleHTTPHandler(interruptor),
        _InterruptibleHTTPSHandler(interruptor),
    )


def _raise_open_error(error: BaseException) -> None:
    if isinstance(error, urllib.error.HTTPError):
        raise error
    if isinstance(error, (urllib.error.URLError, http.client.HTTPException, OSError)):
        raise _RetryableNetworkError(f"HTTP request failed: {error}") from error
    raise error


class _InterruptMonitor:
    """Interrupt one blocking I/O call and always reclaim its supervisor."""

    def __init__(
        self,
        interrupt: Callable[[], None],
        cancel_event: CancellationSignal | None,
        stop_event: threading.Event | None,
    ) -> None:
        self._interrupt = interrupt
        self._cancel_event = cancel_event
        self._stop_event = stop_event
        self._done = threading.Event()
        self._thread: threading.Thread | None = None

    def __enter__(self) -> _InterruptMonitor:
        if self._cancel_event is not None or self._stop_event is not None:
            self._thread = threading.Thread(
                target=self._run,
                name="http-cancel",
                daemon=True,
            )
            self._thread.start()
        return self

    def _run(self) -> None:
        while not self._done.wait(WAIT_INTERVAL):
            cancelled = (
                self._cancel_event is not None and self._cancel_event.is_set()
            )
            stopped = self._stop_event is not None and self._stop_event.is_set()
            if cancelled or stopped:
                self._interrupt()
                return

    def __exit__(self, exc_type, exc, traceback) -> None:  # noqa: ANN001
        self._done.set()
        if self._thread is not None:
            # The worker only waits on ``_done`` or performs socket.shutdown(),
            # both bounded operations. Joining prevents cancelled calls from
            # accumulating dormant request/read workers.
            self._thread.join()


def _open(
    request: urllib.request.Request,
    *,
    cancel_event: CancellationSignal | None = None,
    stop_event: threading.Event | None = None,
):  # noqa: ANN202
    """Open a request without making cancellation wait for socket timeouts.

    ``urllib`` performs DNS, connect, TLS, and response-header reads in one
    blocking call. The request remains in the caller thread while a short-lived
    supervisor shuts down the registered socket on cancellation. This wakes
    delayed response-header reads without leaving one blocked worker per cancel.
    """
    if cancel_event is None and stop_event is None:
        opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({}),
            _SafeRedirectHandler(),
        )
        try:
            return opener.open(request, timeout=REQUEST_TIMEOUT)
        except BaseException as exc:
            _raise_open_error(exc)

    _check_transfer_stop(cancel_event, stop_event)
    interruptor = _ConnectionInterruptor()
    opener = _interruptible_opener(interruptor)
    with _InterruptMonitor(interruptor.interrupt, cancel_event, stop_event):
        try:
            response = opener.open(request, timeout=REQUEST_TIMEOUT)
        except BaseException as exc:
            _check_transfer_stop(cancel_event, stop_event)
            _raise_open_error(exc)
        try:
            _check_transfer_stop(cancel_event, stop_event)
        except BaseException:
            _interrupt_response(response)
            _close_quietly(response)
            raise
        return response


def _retry_delay(attempt: int, retry_after: str | None) -> float:
    if retry_after:
        value = retry_after.strip()
        if _DECIMAL_RE.fullmatch(value):
            return min(float(value), MAX_RETRY_AFTER)
        try:
            parsed = email.utils.parsedate_to_datetime(value)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=_datetime.timezone.utc)
            seconds = (parsed - _datetime.datetime.now(_datetime.timezone.utc)).total_seconds()
            if seconds > 0:
                return min(seconds, MAX_RETRY_AFTER)
        except (TypeError, ValueError, OverflowError):
            pass
    return RETRY_BACKOFF * (2**attempt)


def _interruptible_sleep(
    seconds: float,
    cancel_event: CancellationSignal | None,
    stop_event: threading.Event | None,
) -> None:
    deadline = time.monotonic() + max(0.0, seconds)
    while True:
        check_cancelled(cancel_event)
        if stop_event is not None and stop_event.is_set():
            raise _WorkerStopped("parallel download stopped")
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return
        time.sleep(min(WAIT_INTERVAL, remaining))


def _with_retries(
    operation: Callable[[], _T],
    *,
    cancel_event: CancellationSignal | None,
    stop_event: threading.Event | None = None,
) -> _T:
    for attempt in range(MAX_ATTEMPTS):
        check_cancelled(cancel_event)
        if stop_event is not None and stop_event.is_set():
            raise _WorkerStopped("parallel download stopped")
        retry_after: str | None = None
        try:
            return operation()
        except CancellationRequested:
            raise
        except _WorkerStopped:
            raise
        except urllib.error.HTTPError as exc:
            try:
                retry_after = exc.headers.get("Retry-After") if exc.headers else None
            finally:
                exc.close()
            if exc.code not in _RETRYABLE_STATUS or attempt + 1 >= MAX_ATTEMPTS:
                raise
        except (_RetryableNetworkError, _RetryableTransferError):
            if attempt + 1 >= MAX_ATTEMPTS:
                raise
        _interruptible_sleep(
            _retry_delay(attempt, retry_after),
            cancel_event,
            stop_event,
        )
    raise AssertionError("unreachable")


def _header_values(headers, name: str) -> list[str]:  # noqa: ANN001
    values = headers.get_all(name)
    return [] if values is None else [value.strip() for value in values]


def _parse_content_length(headers, *, required: bool = False) -> int | None:  # noqa: ANN001
    values = _header_values(headers, "Content-Length")
    if not values:
        if required:
            raise DownloadValidationError("Content-Length is required")
        return None
    if len(values) != 1 or not _DECIMAL_RE.fullmatch(values[0]):
        raise DownloadValidationError("Invalid Content-Length")
    return int(values[0])


def _parse_content_range(headers) -> tuple[int, int, int]:  # noqa: ANN001
    values = _header_values(headers, "Content-Range")
    if len(values) != 1:
        raise DownloadValidationError("Missing or duplicate Content-Range")
    match = _CONTENT_RANGE_RE.fullmatch(values[0])
    if not match:
        raise DownloadValidationError("Invalid Content-Range")
    start, end, total = (int(value) for value in match.groups())
    if start > end or end >= total:
        raise DownloadValidationError("Impossible Content-Range")
    return start, end, total


def _accepts_byte_ranges(headers) -> bool:  # noqa: ANN001
    values = _header_values(headers, "Accept-Ranges")
    return any(
        token.strip().casefold() == "bytes"
        for value in values
        for token in value.split(",")
    )


def _final_url(response) -> str:  # noqa: ANN001
    url = response.geturl()
    _validate_http_url(url)
    return url


def _check_transfer_stop(
    cancel_event: CancellationSignal | None,
    stop_event: threading.Event | None,
) -> None:
    check_cancelled(cancel_event)
    if stop_event is not None and stop_event.is_set():
        raise _WorkerStopped("parallel download stopped")


def _stream_response(
    response,
    output,
    *,
    expected: int | None,
    cancel_event: CancellationSignal | None,
    stop_event: threading.Event | None,
    progress: _Progress | None,
    progress_key: object | None,
    digest: hashlib._Hash | None = None,
) -> int:
    actual = 0
    read_chunk = getattr(response, "read1", response.read)
    window_started = time.monotonic()
    window_bytes = 0
    with _InterruptMonitor(
        lambda: _interrupt_response(response),
        cancel_event,
        stop_event,
    ):
        while True:
            _check_transfer_stop(cancel_event, stop_event)
            try:
                chunk = read_chunk(CHUNK_SIZE)
            except (http.client.HTTPException, OSError) as exc:
                _check_transfer_stop(cancel_event, stop_event)
                raise _RetryableNetworkError(f"HTTP response interrupted: {exc}") from exc
            _check_transfer_stop(cancel_event, stop_event)
            if not chunk:
                break
            actual += len(chunk)
            window_bytes += len(chunk)
            elapsed = time.monotonic() - window_started
            if elapsed >= IDLE_TIMEOUT:
                if window_bytes < CHUNK_SIZE:
                    raise _RetryableNetworkError(
                        "Transfer stalled below the minimum sustained progress rate"
                    )
                window_started = time.monotonic()
                window_bytes = 0
            if expected is not None and actual > expected:
                raise DownloadValidationError(
                    f"Response exceeded expected length {expected}"
                )
            written = output.write(chunk)
            if written != len(chunk):
                raise OSError("Short write while saving download")
            if digest is not None:
                digest.update(chunk)
            if progress is not None and progress_key is not None:
                progress.update(progress_key, actual)
    if expected is not None and actual != expected:
        raise _RetryableTransferError(
            f"Truncated response: expected {expected} bytes, received {actual}"
        )
    return actual


def _probe_head(
    url: str,
    headers: Mapping[str, str],
    cancel_event: CancellationSignal | None,
) -> tuple[int | None, bool, str]:
    def attempt() -> tuple[int | None, bool, str]:
        request = _make_request(url, method="HEAD", headers=headers)
        with _open(request, cancel_event=cancel_event) as response:
            total: int | None
            try:
                total = _parse_content_length(response.headers)
            except DownloadValidationError:
                total = None
            return total, _accepts_byte_ranges(response.headers), _final_url(response)

    return _with_retries(attempt, cancel_event=cancel_event)


def _probe_range(
    url: str,
    headers: Mapping[str, str],
    cancel_event: CancellationSignal | None,
    head_total: int | None,
) -> _ProbeResult:
    def attempt() -> _ProbeResult:
        request = _make_request(
            url,
            method="GET",
            headers=headers,
            byte_range=(0, 0),
        )
        with _open(request, cancel_event=cancel_event) as response:
            status = response.getcode()
            final_url = _final_url(response)
            if status == 200:
                content_length = _parse_content_length(response.headers)
                total = head_total if head_total is not None else content_length
                raise _RangeIgnored(
                    "Server ignored the range probe",
                    total=total,
                    final_url=final_url,
                )
            if status != 206:
                raise DownloadValidationError(
                    f"Range probe returned unexpected HTTP status {status}"
                )
            start, end, total = _parse_content_range(response.headers)
            if (start, end) != (0, 0):
                raise DownloadValidationError("Range probe did not return bytes 0-0")
            if head_total is not None and total != head_total:
                raise DownloadValidationError(
                    "HEAD Content-Length disagrees with range total"
                )
            content_length = _parse_content_length(response.headers)
            if content_length is not None and content_length != 1:
                raise DownloadValidationError(
                    "Range probe Content-Length must equal one"
                )
            sink = _DiscardWriter()
            _stream_response(
                response,
                sink,
                expected=1,
                cancel_event=cancel_event,
                stop_event=None,
                progress=None,
                progress_key=None,
            )
            return _ProbeResult(total, True, final_url)

    return _with_retries(attempt, cancel_event=cancel_event)


class _DiscardWriter:
    def write(self, data: bytes) -> int:
        return len(data)


def _probe(
    url: str,
    headers: Mapping[str, str],
    cancel_event: CancellationSignal | None,
) -> _ProbeResult:
    head_total: int | None = None
    head_final_url = url
    try:
        head_total, _head_accepts_ranges, head_final_url = _probe_head(
            url, headers, cancel_event
        )
        headers = _headers_after_redirect(url, head_final_url, headers)
    except CancellationRequested:
        raise
    except (urllib.error.HTTPError, FastDownloadError):
        # Many ordinary file servers reject HEAD or implement it incorrectly.
        pass

    try:
        return _probe_range(head_final_url, headers, cancel_event, head_total)
    except _RangeIgnored as exc:
        return _ProbeResult(
            exc.total,
            False,
            exc.final_url or head_final_url,
        )


def _partition(total: int, count: int, parent: Path, destination_name: str) -> list[_Segment]:
    token = uuid.uuid4().hex
    segments: list[_Segment] = []
    for index in range(count):
        start = (index * total) // count
        end = ((index + 1) * total) // count - 1
        path = parent / f".{destination_name}.{token}.segment-{index}.part"
        segments.append(_Segment(index, start, end, path))
    return segments


def _segment_attempt(
    url: str,
    headers: Mapping[str, str],
    segment: _Segment,
    total: int,
    cancel_event: CancellationSignal | None,
    stop_event: threading.Event,
    progress: _Progress,
) -> str:
    _check_transfer_stop(cancel_event, stop_event)
    progress.update(segment.index, 0)
    request = _make_request(
        url,
        method="GET",
        headers=headers,
        byte_range=(segment.start, segment.end),
    )
    with _open(
        request,
        cancel_event=cancel_event,
        stop_event=stop_event,
    ) as response:
        status = response.getcode()
        if status == 200:
            raise _RangeIgnored("Server ignored a byte-range request")
        if status != 206:
            raise DownloadValidationError(
                f"Byte-range request returned HTTP status {status}"
            )
        actual_range = _parse_content_range(response.headers)
        expected_range = (segment.start, segment.end, total)
        if actual_range != expected_range:
            raise DownloadValidationError(
                f"Content-Range {actual_range!r} does not match {expected_range!r}"
            )
        content_length = _parse_content_length(response.headers)
        if content_length is not None and content_length != segment.length:
            raise DownloadValidationError(
                "Range Content-Length disagrees with Content-Range"
            )
        final_url = _final_url(response)
        if _origin(url) != _origin(final_url):
            raise DownloadValidationError(
                "Byte-range request redirected across origins"
            )
        with segment.path.open("wb") as output:
            _stream_response(
                response,
                output,
                expected=segment.length,
                cancel_event=cancel_event,
                stop_event=stop_event,
                progress=progress,
                progress_key=segment.index,
            )
        return final_url


def _download_segments(
    url: str,
    headers: Mapping[str, str],
    segments: list[_Segment],
    total: int,
    cancel_event: CancellationSignal | None,
    progress: _Progress,
) -> str:
    stop_event = threading.Event()
    executor = concurrent.futures.ThreadPoolExecutor(
        max_workers=len(segments),
        thread_name_prefix="http-range",
    )
    future_map = {
        executor.submit(
            _with_retries,
            lambda segment=segment: _segment_attempt(
                url,
                headers,
                segment,
                total,
                cancel_event,
                stop_event,
                progress,
            ),
            cancel_event=cancel_event,
            stop_event=stop_event,
        ): segment
        for segment in segments
    }
    pending = set(future_map)
    errors: list[BaseException] = []
    final_urls: list[str] = []
    try:
        while pending and not errors:
            check_cancelled(cancel_event)
            done, pending = concurrent.futures.wait(
                pending,
                timeout=WAIT_INTERVAL,
                return_when=concurrent.futures.FIRST_EXCEPTION,
            )
            for future in done:
                try:
                    final_urls.append(future.result())
                except BaseException as exc:  # Preserve cancellation exactly.
                    errors.append(exc)
            if errors:
                stop_event.set()
                for future in pending:
                    future.cancel()

        while pending:
            check_cancelled(cancel_event)
            done, pending = concurrent.futures.wait(
                pending,
                timeout=WAIT_INTERVAL,
                return_when=concurrent.futures.FIRST_COMPLETED,
            )
            for future in done:
                if future.cancelled():
                    continue
                try:
                    final_urls.append(future.result())
                except (_WorkerStopped, concurrent.futures.CancelledError):
                    pass
                except BaseException as exc:
                    errors.append(exc)
    except BaseException as exc:
        errors.insert(0, exc)
        stop_event.set()
        for future in pending:
            future.cancel()
    finally:
        if errors:
            stop_event.set()
        executor.shutdown(wait=True, cancel_futures=True)

    check_cancelled(cancel_event)
    meaningful = [error for error in errors if not isinstance(error, _WorkerStopped)]
    strict_errors = [error for error in meaningful if not isinstance(error, _RangeIgnored)]
    if strict_errors:
        raise strict_errors[0]
    if meaningful:
        raise meaningful[0]
    if not final_urls:
        raise FastDownloadError("No byte-range worker completed")
    return final_urls[0]


def _single_attempt(
    url: str,
    headers: Mapping[str, str],
    part_path: Path,
    expected: int | None,
    cancel_event: CancellationSignal | None,
    progress: _Progress,
) -> tuple[int, str, str]:
    progress.update("single", 0)
    request = _make_request(url, method="GET", headers=headers)
    with _open(request, cancel_event=cancel_event) as response:
        status = response.getcode()
        if status != 200:
            raise DownloadValidationError(
                f"Single-stream request returned HTTP status {status}"
            )
        if _header_values(response.headers, "Content-Range"):
            raise DownloadValidationError(
                "Single-stream response unexpectedly included Content-Range"
            )
        declared = _parse_content_length(response.headers)
        if expected is not None and declared is not None and declared != expected:
            raise DownloadValidationError(
                "GET Content-Length disagrees with probed total"
            )
        target = expected if expected is not None else declared
        if target is None:
            # With no Content-Length and no probed total, a dropped connection is
            # indistinguishable from a clean EOF, so a truncated file would be
            # committed with a valid checksum. Refuse and let the caller fall
            # back to yt-dlp, which handles close-delimited bodies.
            raise DownloadValidationError(
                "Server provided no transfer size; cannot verify completeness"
            )
        digest = hashlib.sha256()
        final_url = _final_url(response)
        if _origin(url) != _origin(final_url):
            raise DownloadValidationError(
                "Single-stream request redirected across origins"
            )
        with part_path.open("wb") as output:
            actual = _stream_response(
                response,
                output,
                expected=target,
                cancel_event=cancel_event,
                stop_event=None,
                progress=progress,
                progress_key="single",
                digest=digest,
            )
        return actual, digest.hexdigest(), final_url


def _download_single(
    url: str,
    headers: Mapping[str, str],
    part_path: Path,
    expected: int | None,
    cancel_event: CancellationSignal | None,
    progress: _Progress,
) -> tuple[int, str, str]:
    return _with_retries(
        lambda: _single_attempt(
            url,
            headers,
            part_path,
            expected,
            cancel_event,
            progress,
        ),
        cancel_event=cancel_event,
    )


def _merge_segments(
    segments: list[_Segment],
    part_path: Path,
    expected: int,
    cancel_event: CancellationSignal | None,
) -> tuple[int, str]:
    digest = hashlib.sha256()
    actual = 0
    with part_path.open("wb") as output:
        for segment in sorted(segments, key=lambda item: item.index):
            check_cancelled(cancel_event)
            with segment.path.open("rb") as source:
                while True:
                    check_cancelled(cancel_event)
                    chunk = source.read(CHUNK_SIZE)
                    if not chunk:
                        break
                    written = output.write(chunk)
                    if written != len(chunk):
                        raise OSError("Short write while merging byte ranges")
                    digest.update(chunk)
                    actual += len(chunk)
                    if actual > expected:
                        raise DownloadValidationError(
                            "Merged byte ranges exceed expected total"
                        )
    if actual != expected:
        raise DownloadValidationError(
            f"Merged size mismatch: expected {expected}, received {actual}"
        )
    return actual, digest.hexdigest()


def _reserve_file(path: Path) -> None:
    try:
        with path.open("xb"):
            pass
    except FileExistsError:
        # A hard crash (power loss, kill -9) leaves staging files behind. Without
        # this recovery the exclusive create fails forever and the caller
        # silently falls back to the slow transport for good.
        try:
            age = time.time() - path.stat().st_mtime
        except OSError:
            raise
        if age < STALE_PART_SECONDS:
            raise
        path.unlink(missing_ok=True)
        with path.open("xb"):
            pass


def _remove_files(paths: list[Path]) -> None:
    for path in paths:
        try:
            path.unlink()
        except FileNotFoundError:
            pass


def _connection_count(total: int, requested: int) -> int:
    useful = max(1, total // MIN_PART_SIZE)
    return min(requested, useful, total)


def download_http(
    url: str,
    destination: Path | str,
    *,
    headers: Mapping[str, str] | None = None,
    connections: int = 4,
    cancel_event: CancellationSignal | None = None,
    on_progress: ProgressCallback | None = None,
) -> FastDownloadResult:
    """Download one ordinary HTTP(S) resource and atomically commit it.

    ``on_progress`` receives ``(downloaded_bytes, total_bytes_or_none)``. Caller
    supplied Cookie, Authorization, and Proxy-Authorization headers are always
    discarded. Parallel range transfers use at most four worker connections.
    """
    _validate_http_url(url)
    if isinstance(connections, bool) or not isinstance(connections, int) or connections < 1:
        raise ValueError("connections must be a positive integer")
    requested_connections = min(connections, MAX_CONNECTIONS)
    destination_path = Path(destination)
    destination_path.parent.mkdir(parents=True, exist_ok=True)
    part_path = Path(f"{destination_path}.part")
    safe_headers = _sanitize_headers(headers)
    check_cancelled(cancel_event)

    # Reserving the exact staging name avoids overwriting another active run.
    _reserve_file(part_path)
    segments: list[_Segment] = []
    created_segments: list[_Segment] = []
    committed = False
    try:
        probe = _probe(url, safe_headers, cancel_event)
        safe_headers = _headers_after_redirect(url, probe.final_url, safe_headers)
        progress = _Progress(on_progress, probe.total)
        actual_connections = 1
        used_ranges = False
        final_url = probe.final_url

        count = (
            _connection_count(probe.total, requested_connections)
            if probe.supports_ranges
            and probe.total is not None
            and probe.total > 0
            and requested_connections > 1
            else 1
        )
        if count > 1:
            segments = _partition(
                probe.total,
                count,
                destination_path.parent,
                destination_path.name,
            )
            for segment in segments:
                _reserve_file(segment.path)
                created_segments.append(segment)
            try:
                final_url = _download_segments(
                    probe.final_url,
                    safe_headers,
                    segments,
                    probe.total,
                    cancel_event,
                    progress,
                )
            except _RangeIgnored:
                _remove_files([segment.path for segment in segments])
                segments = []
                progress = _Progress(on_progress, probe.total)
                bytes_written, sha256, final_url = _download_single(
                    probe.final_url,
                    safe_headers,
                    part_path,
                    probe.total,
                    cancel_event,
                    progress,
                )
            else:
                bytes_written, sha256 = _merge_segments(
                    segments,
                    part_path,
                    probe.total,
                    cancel_event,
                )
                used_ranges = True
                actual_connections = count
        else:
            bytes_written, sha256, final_url = _download_single(
                probe.final_url,
                safe_headers,
                part_path,
                probe.total,
                cancel_event,
                progress,
            )

        check_cancelled(cancel_event)
        staged_size = part_path.stat().st_size
        if staged_size != bytes_written or (
            probe.total is not None and staged_size != probe.total
        ):
            raise DownloadValidationError(
                "Staged file size does not match the validated download size"
            )
        os.replace(part_path, destination_path)
        committed = True
        return FastDownloadResult(
            destination=destination_path,
            bytes_written=bytes_written,
            sha256=sha256,
            used_ranges=used_ranges,
            connections=actual_connections,
            final_url=final_url,
        )
    finally:
        _remove_files([segment.path for segment in created_segments])
        if not committed:
            _remove_files([part_path])
