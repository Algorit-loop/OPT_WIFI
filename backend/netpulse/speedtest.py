"""Internet speed test against Cloudflare's speed endpoints (speed.cloudflare.com).

latency : 10 sequential tiny HTTPS requests on a warm connection (median, jitter)
download: N parallel streams of GET /__down for a fixed duration
upload  : N parallel streams of POST /__up for a fixed duration
The first seconds of each transfer phase (TCP slow start) are excluded from the result.
"""
from __future__ import annotations

import http.client
import json
import os
import socket
import ssl
import statistics
import threading
import time
from typing import Callable

HOST = "speed.cloudflare.com"
STREAMS = 6
DURATION = 10.0
WARMUP = 2.0
CHUNK = 64 * 1024
_UPLOAD_BLOCK = os.urandom(CHUNK)

_ctx = ssl.create_default_context()
_HEADERS = {"User-Agent": "NetPulse", "Referer": "https://speed.cloudflare.com/"}


def _conn(timeout: float = 10) -> http.client.HTTPSConnection:
    return http.client.HTTPSConnection(HOST, timeout=timeout, context=_ctx)


def meta() -> dict:
    c = _conn()
    try:
        c.request("GET", "/meta", headers=_HEADERS)
        return json.loads(c.getresponse().read().decode())
    finally:
        c.close()


def latency(samples: int = 10, on_sample: Callable[[float, int], None] | None = None) -> tuple[float, float]:
    """Unloaded latency = TCP handshake time (SYN → SYN-ACK) to the speed-test edge.

    Pure network round trip, unlike an HTTP request which also includes TLS and server time.
    """
    ip = socket.getaddrinfo(HOST, 443, socket.AF_INET, socket.SOCK_STREAM)[0][4][0]
    times = []
    for i in range(samples):
        t0 = time.perf_counter()
        try:
            with socket.create_connection((ip, 443), timeout=3):
                rtt = (time.perf_counter() - t0) * 1000
        except OSError:
            continue
        times.append(rtt)
        if on_sample:
            on_sample(rtt, i)
        time.sleep(0.05)
    if not times:
        raise RuntimeError("Không kết nối được tới máy chủ speed test")
    jitter = statistics.fmean(abs(a - b) for a, b in zip(times, times[1:])) if len(times) > 1 else 0.0
    return statistics.median(times), jitter


class _Transfer:
    """Runs STREAMS worker threads moving bytes until the deadline; tracks a shared byte counter."""

    def __init__(self, upload: bool) -> None:
        self.upload = upload
        self.bytes = 0
        self.lock = threading.Lock()
        self.stop = False
        self.errors = 0

    def _add(self, n: int) -> None:
        with self.lock:
            self.bytes += n

    def _worker(self) -> None:
        while not self.stop:
            c = None
            try:
                c = _conn(timeout=15)
                if self.upload:
                    size = 50_000_000
                    # small send buffer so "bytes handed to the socket" ≈ bytes on the wire
                    c.connect()
                    c.sock.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 128 * 1024)
                    c.putrequest("POST", "/__up")
                    c.putheader("Content-Type", "application/octet-stream")
                    c.putheader("Referer", _HEADERS["Referer"])
                    c.putheader("Content-Length", str(size))
                    c.endheaders()
                    sent = 0
                    while sent < size and not self.stop:
                        c.send(_UPLOAD_BLOCK)
                        sent += CHUNK
                        self._add(CHUNK)
                    if not self.stop:
                        c.getresponse().read()
                else:
                    c.request("GET", "/__down?bytes=100000000", headers=_HEADERS)
                    r = c.getresponse()
                    while not self.stop:
                        b = r.read(CHUNK)
                        if not b:
                            break
                        self._add(len(b))
            except Exception:  # noqa: BLE001 — a dropped stream is retried until the deadline
                self.errors += 1
                time.sleep(0.2)
            finally:
                if c:
                    c.close()

    def run(self, on_progress: Callable[[float, float], None]) -> float:
        threads = [threading.Thread(target=self._worker, daemon=True) for _ in range(STREAMS)]
        t0 = time.perf_counter()
        for t in threads:
            t.start()
        window: list[tuple[float, int]] = [(t0, 0)]
        warm_bytes = None
        warm_t = None
        while True:
            time.sleep(0.25)
            now = time.perf_counter()
            el = now - t0
            with self.lock:
                b = self.bytes
            window.append((now, b))
            window = [w for w in window if now - w[0] <= 1.0] or window[-1:]
            inst = (b - window[0][1]) * 8 / max(1e-3, now - window[0][0])
            if warm_bytes is None and el >= WARMUP:
                warm_bytes, warm_t = b, now
            on_progress(inst, min(1.0, el / DURATION))
            if el >= DURATION:
                break
        self.stop = True
        if self.errors >= STREAMS * 4 and self.bytes == 0:
            raise RuntimeError("Không kết nối được tới máy chủ speed test")
        with self.lock:
            b = self.bytes
        end = time.perf_counter()
        if warm_bytes is None or end - warm_t < 1:
            return b * 8 / (end - t0)
        return (b - warm_bytes) * 8 / (end - warm_t)


def run(on_progress: Callable[[dict], None]) -> dict:
    """Blocking speed test. Calls on_progress({phase, progress, value?, ping?})."""
    server = HOST
    try:
        m = meta()
        colo = m.get("colo") if isinstance(m.get("colo"), dict) else {}
        server = f"Cloudflare {colo.get('city', '')} ({colo.get('iata', '?')})" if colo else "Cloudflare"
    except Exception:  # noqa: BLE001
        m = {}
    on_progress({"phase": "ping", "progress": 0, "server": server})
    ping, jitter = latency(10, lambda rtt, i: on_progress({"phase": "ping", "progress": (i + 1) / 10, "ping": round(rtt)}))
    on_progress({"phase": "ping", "progress": 1, "ping": round(ping)})
    down = _Transfer(upload=False).run(lambda v, p: on_progress({"phase": "download", "progress": p, "value": v}))
    up = _Transfer(upload=True).run(lambda v, p: on_progress({"phase": "upload", "progress": p, "value": v}))
    on_progress({"phase": "done", "progress": 1})
    return {"ping": round(ping, 1), "jitter": round(jitter, 1), "down": down, "up": up,
            "server": server, "isp": m.get("asOrganization"), "ip": m.get("clientIp")}
