"""Background sampling: traffic, latency, Wi-Fi, network config — plus event detection.

Threads
  traffic  every refreshMs: byte counters of the primary interface → rates, live buffer,
           per-minute aggregation flushed to SQLite
  ping     every 1 s: ICMP echo to the configured target → latency, jitter, loss
  wifi     every 2 s: Native WiFi API → SSID/BSSID/signal/rates, connect/roam events
  slow     every 5 s: network config (30 s), public IP (30 min), pruning, auto speed test,
           data-cap alerts
"""
from __future__ import annotations

import json
import logging
import statistics
import threading
import time
import urllib.request
from collections import deque
from datetime import datetime

import psutil

from . import netconfig
from .config import VERSION, settings
from .db import DB
from .winapi import icmp

log = logging.getLogger("netpulse.collector")

ACTIVE_BPS = 200_000          # a second counts as "active" above 0.2 Mbps
BUFFER_LEN = 900              # live samples kept in memory (15 min at 1 s)


def _local_midnight(now: datetime | None = None) -> int:
    n = now or datetime.now()
    return int(n.replace(hour=0, minute=0, second=0, microsecond=0).timestamp())


def _month_start(now: datetime | None = None) -> int:
    n = now or datetime.now()
    return int(n.replace(day=1, hour=0, minute=0, second=0, microsecond=0).timestamp())


def _fmt_dur(sec: float) -> str:
    sec = int(sec)
    if sec < 60:
        return f"{sec} giây"
    if sec < 3600:
        return f"{sec // 60} phút {sec % 60} giây"
    return f"{sec // 3600} giờ {sec % 3600 // 60} phút"


class Collector:
    def __init__(self, db: DB) -> None:
        self.db = db
        self.started_at = time.time()
        self.lock = threading.RLock()
        self.running = False
        self.threads: list[threading.Thread] = []
        self.buffer: deque = deque(maxlen=BUFFER_LEN)

        # network state
        self.net: dict = {"adapters": [], "primary": None, "host": None, "configs": {}}
        self.net_at = 0.0
        self.net_force = threading.Event()
        self.public: dict = {}
        self.public_at = 0.0

        # Wi-Fi
        self.wlan = None
        self.wlan_guid = None
        self.wlan_desc = None
        self.wlan_error: str | None = None
        self.wifi: dict = {"connected": False, "available": False}
        self.bss_cache: dict = {}
        self.bss_at = 0.0

        # traffic
        self._base = None
        self.session = [0, 0]
        self.today = [0, 0]
        self.month = [0, 0]
        self._day_key = None
        self._month_key = None
        self._min = None           # current minute aggregator
        self._qmin = self._new_qmin(0)

        # latency
        self.last_rtt: float | None = None
        self.jitter: float | None = None
        self.last_loss = 0
        self._rtts: deque = deque(maxlen=10)
        self._ping_ip = None
        self._ping_host = None
        self._ping_resolved_at = 0.0
        self._fails = 0
        self._down_since: float | None = None
        self._latency_alert = False
        self._last_lat_event = 0.0
        self._last_loss_event = 0.0
        self._signal_low_since: float | None = None
        self._last_signal_event = 0.0

    # ================================================================ lifecycle
    def start(self) -> None:
        self.running = True
        self._init_counters()
        self._init_wlan()
        self._refresh_net(initial=True)
        prev = self.db.kv_get("last_seen")
        detail = f"NetPulse agent v{VERSION} bắt đầu thu thập dữ liệu."
        if prev:
            gap = time.time() - float(prev)
            if gap > 120:
                last = datetime.fromtimestamp(float(prev)).strftime("%d/%m %H:%M")
                detail += f" Không thu thập dữ liệu từ {last} đến lúc khởi động lại (khoảng {_fmt_dur(gap)})."
        self.db.add_event("agent", "info", "Agent khởi động", detail)
        for name, fn in (("traffic", self._traffic_loop), ("ping", self._ping_loop),
                         ("wifi", self._wifi_loop), ("slow", self._slow_loop)):
            t = threading.Thread(target=self._guard(fn), name=f"np-{name}", daemon=True)
            t.start()
            self.threads.append(t)

    def stop(self) -> None:
        self.running = False
        for t in self.threads:
            t.join(timeout=3)
        with self.lock:
            self._flush_minute()
        self.db.kv_set("last_seen", time.time())
        if self.wlan:
            self.wlan.close()

    def _guard(self, fn):
        def run():
            while self.running:
                try:
                    fn()
                except Exception:  # noqa: BLE001 — keep sampling even if one iteration fails
                    log.exception("%s loop crashed; restarting in 2 s", fn.__name__)
                    time.sleep(2)
        return run

    def _sleep_until(self, t: float) -> None:
        while self.running:
            d = t - time.monotonic()
            if d <= 0:
                return
            time.sleep(min(d, 0.25))

    # ================================================================ init
    def _init_counters(self) -> None:
        now = datetime.now()
        self._day_key, self._month_key = now.date(), (now.year, now.month)
        self.today = list(self.db.totals_since(_local_midnight(now)))
        self.month = list(self.db.totals_since(_month_start(now)))

    def _init_wlan(self) -> None:
        try:
            from .winapi.wlan import Wlan
            self.wlan = Wlan()
            ifs = self.wlan.interfaces()
            if ifs:
                self.wlan_guid = ifs[0]["_guid"]
                self.wlan_desc = ifs[0]["description"]
            else:
                self.wlan_error = "Không tìm thấy card Wi-Fi"
        except Exception as e:  # noqa: BLE001
            self.wlan_error = str(e)
            log.warning("WLAN API unavailable: %s", e)

    # ================================================================ network config
    def _refresh_net(self, initial: bool = False) -> None:
        snap = netconfig.snapshot()
        if not snap["adapters"] and self.net.get("adapters"):
            return  # transient PowerShell failure — keep last good snapshot
        old = self.net.get("primary") or {}
        with self.lock:
            self.net = snap
            self.net_at = time.time()
        new = snap.get("primary") or {}
        if initial:
            return
        if old.get("name") != new.get("name"):
            if new.get("name"):
                self.db.add_event("ip_change", "info", "Đổi giao diện mạng chính",
                                  f"{old.get('name') or 'Không có'} → {new.get('name')}")
            self.public_at = 0  # re-lookup public IP
            return
        if old.get("ipv4") != new.get("ipv4") and new.get("ipv4"):
            self.db.add_event("ip_change", "info", "Thay đổi IP", f"IPv4: {old.get('ipv4') or '—'} → {new.get('ipv4')}")
        if old.get("gateway") != new.get("gateway") and new.get("gateway"):
            self.db.add_event("ip_change", "info", "Thay đổi gateway", f"{old.get('gateway') or '—'} → {new.get('gateway')}")
            self.public_at = 0
        if (old.get("dns") or []) != (new.get("dns") or []) and new.get("dns"):
            self.db.add_event("dns_change", "info", "Thay đổi DNS", "DNS: " + ", ".join(new["dns"]))

    def primary_adapter(self) -> dict | None:
        p = self.net.get("primary")
        if not p:
            return None
        return next((a for a in self.net["adapters"] if a["ifIndex"] == p.get("ifIndex")), None)

    def primary_type(self) -> str:
        a = self.primary_adapter()
        if not a:
            return "none"
        if self.wlan_guid and a["guid"] == str(self.wlan_guid):
            return "wifi"
        media = (a.get("physMedia") or a.get("media") or "").lower()
        if "802.11" in media or "wireless" in media:
            return "wifi"
        if "802.3" in media:
            return "ethernet"
        return "other"

    def _lookup_public(self) -> None:
        try:
            req = urllib.request.Request("https://speed.cloudflare.com/meta", headers={
                "User-Agent": f"NetPulse/{VERSION}", "Referer": "https://speed.cloudflare.com/"})
            with urllib.request.urlopen(req, timeout=6) as r:
                m = json.loads(r.read().decode())
            self.public = {"ip": m.get("clientIp"), "isp": m.get("asOrganization"), "asn": m.get("asn"),
                           "city": m.get("city"), "country": m.get("country"), "region": m.get("region")}
        except Exception as e:  # noqa: BLE001
            log.info("public IP lookup failed: %s", e)
        self.public_at = time.time()

    # ================================================================ traffic
    def _nic_name(self) -> str | None:
        p = self.net.get("primary")
        if p and p.get("name"):
            return p["name"]
        # offline: fall back to the Wi-Fi adapter so local traffic is still visible
        a = next((a for a in self.net.get("adapters", []) if self.wlan_guid and a["guid"] == str(self.wlan_guid)), None)
        return a["name"] if a else None

    def _traffic_loop(self) -> None:
        nxt = time.monotonic()
        while self.running:
            interval = settings["refreshMs"] / 1000
            nxt += interval
            self._sleep_until(nxt)
            if time.monotonic() - nxt > 2 * interval:  # fell behind (sleep/hibernate) — resync
                nxt = time.monotonic()
            self._sample_traffic(interval)

    def _sample_traffic(self, interval: float) -> None:
        nic = self._nic_name()
        counters = psutil.net_io_counters(pernic=True)
        c = counters.get(nic) if nic else None
        mono, now = time.monotonic(), time.time()
        down = up = 0.0
        drx = dtx = 0
        dt = interval
        valid = False
        if c is not None:
            if self._base and self._base[0] == nic:
                _, rx0, tx0, t0 = self._base
                dt = mono - t0
                if dt < interval * 0.5:
                    return  # too close to the previous read: Windows updates counters in batches
                drx, dtx = c.bytes_recv - rx0, c.bytes_sent - tx0
                cap = self._rate_cap()
                if (drx >= 0 and dtx >= 0 and 0 < dt <= max(10.0, interval * 5)
                        and (rx0 or tx0)                      # a zeroed counter is not a real baseline
                        and drx * 8 / dt <= cap and dtx * 8 / dt <= cap):
                    down, up = drx * 8 / dt, dtx * 8 / dt
                    valid = True
                elif drx * 8 / max(dt, 1e-3) > cap or dtx * 8 / max(dt, 1e-3) > cap:
                    log.info("discarded implausible counter jump on %s: rx +%d tx +%d in %.2fs", nic, drx, dtx, dt)
            self._base = (nic, c.bytes_recv, c.bytes_sent, mono)
        else:
            self._base = None
        if not valid:
            drx = dtx = 0

        with self.lock:
            self._rollover(now)
            if valid:
                self.session[0] += drx; self.session[1] += dtx
                self.today[0] += drx; self.today[1] += dtx
                self.month[0] += drx; self.month[1] += dtx
                m = self._min
                m["rx"] += drx; m["tx"] += dtx; m["samples"] += 1
                m["peak_down"] = max(m["peak_down"], down); m["peak_up"] = max(m["peak_up"], up)
                if down >= ACTIVE_BPS:
                    m["active_s"] += dt; m["active_rx"] += drx
                m["iface"] = nic
            wifi_ok = self.wifi.get("connected")
            self.buffer.append({
                "ts": int(now * 1000), "down": round(down), "up": round(up),
                "ping": self.last_rtt, "jitter": self.jitter, "loss": self.last_loss,
                "signal": self.wifi.get("signal") if wifi_ok else None,
                "sessionDown": self.session[0], "sessionUp": self.session[1],
                "todayDown": self.today[0], "todayUp": self.today[1],
                "monthDown": self.month[0], "monthUp": self.month[1],
                "gap": not valid,
            })

    def _rate_cap(self) -> float:
        """Physically possible maximum for the primary link (bps) — anything above is a counter glitch."""
        link = 0.0
        a = self.primary_adapter()
        if a:
            link = a.get("speed") or 0
        if self.wifi.get("connected"):
            link = max(link, (self.wifi.get("rxRate") or 0) * 1e6, (self.wifi.get("txRate") or 0) * 1e6)
        return max(2 * link, 1e9) if link else 25e9

    def _rollover(self, now: float) -> None:
        minute = int(now) - int(now) % 60
        if self._min is None:
            self._min = self._new_min(minute)
            self._qmin = self._new_qmin(minute)
        elif self._min["ts"] != minute:
            self._flush_minute()
            self._min = self._new_min(minute)
            self._qmin = self._new_qmin(minute)
        d = datetime.fromtimestamp(now)
        if d.date() != self._day_key:
            self._day_key = d.date()
            self.today = [0, 0]
        if (d.year, d.month) != self._month_key:
            self._month_key = (d.year, d.month)
            self.month = [0, 0]

    @staticmethod
    def _new_min(ts: int) -> dict:
        return {"ts": ts, "rx": 0, "tx": 0, "peak_down": 0.0, "peak_up": 0.0, "active_s": 0.0, "active_rx": 0, "samples": 0, "iface": None}

    @staticmethod
    def _new_qmin(ts: int) -> dict:
        return {"ts": ts, "sent": 0, "lost": 0, "rtts": [], "signals": [], "rssis": []}

    def _flush_minute(self) -> None:
        m, q = self._min, self._qmin
        if not m or (m["samples"] == 0 and q["sent"] == 0):
            return
        rtts = q["rtts"]
        qual = None
        if q["sent"]:
            jit = statistics.fmean(abs(a - b) for a, b in zip(rtts, rtts[1:])) if len(rtts) > 1 else None
            qual = {
                "ts": m["ts"], "sent": q["sent"], "lost": q["lost"],
                "ping_avg": statistics.fmean(rtts) if rtts else None,
                "ping_min": min(rtts) if rtts else None, "ping_max": max(rtts) if rtts else None,
                "jitter": jit,
                "signal": statistics.fmean(q["signals"]) if q["signals"] else None,
                "rssi": statistics.fmean(q["rssis"]) if q["rssis"] else None,
            }
        try:
            self.db.write_minute(m, qual)
            self.db.kv_set("last_seen", time.time())
        except Exception:  # noqa: BLE001
            log.exception("failed to write minute %s", m["ts"])
        if qual and qual["sent"] >= 30:
            self._check_loss(qual)

    def pending(self) -> dict | None:
        """Current, not yet persisted minute (included in usage queries)."""
        with self.lock:
            if not self._min:
                return None
            return {**self._min, "observed": self._min["samples"] > 0}

    # ================================================================ ping
    def _ping_loop(self) -> None:
        nxt = time.monotonic()
        while self.running:
            nxt += 1.0
            self._ping_once()
            self._sleep_until(nxt)
            if time.monotonic() - nxt > 3:
                nxt = time.monotonic()

    def _ping_once(self) -> None:
        host = settings["pingTarget"]
        if host != self._ping_host or time.time() - self._ping_resolved_at > 300 or not self._ping_ip:
            try:
                self._ping_ip = icmp.resolve(host)
                self._ping_host = host
                self._ping_resolved_at = time.time()
            except OSError:
                self._ping_ip = None
        r = icmp.ping(self._ping_ip, 1000) if self._ping_ip else {"ok": False, "rtt": None}
        ok = r["ok"]
        with self.lock:
            q = self._qmin
            q["sent"] += 1
            if ok:
                q["rtts"].append(r["rtt"])
                self._rtts.append(r["rtt"])
                self.last_rtt = r["rtt"]
                rs = list(self._rtts)
                self.jitter = round(statistics.fmean(abs(a - b) for a, b in zip(rs, rs[1:])), 1) if len(rs) > 1 else 0.0
                self.last_loss = 0
            else:
                q["lost"] += 1
                self.last_rtt = None
                self.last_loss = 1
        self._check_reachability(ok, host)
        if ok:
            self._check_latency()

    def _check_reachability(self, ok: bool, host: str) -> None:
        now = time.time()
        if ok:
            if self._down_since is not None:
                self.db.add_event("connect", "good", "Internet đã khôi phục",
                                  f"Ping {host} trở lại sau {_fmt_dur(now - self._down_since)} gián đoạn")
                self._down_since = None
            self._fails = 0
            return
        self._fails += 1
        if self._fails == 5 and self._down_since is None:
            self._down_since = now - 5
            if self.wifi.get("connected"):
                why = f"Wi-Fi vẫn kết nối {self.wifi.get('ssid') or ''} — sự cố có thể ở router hoặc nhà mạng"
            elif self.primary_type() == "none":
                why = "Không có giao diện mạng nào có default gateway"
            else:
                why = "Không nhận được phản hồi trong 5 giây"
            self.db.add_event("disconnect", "crit", "Mất kết nối Internet", f"Ping {host} thất bại liên tục. {why}.")

    def _check_latency(self) -> None:
        rs = list(self._rtts)
        if len(rs) < 10:
            return
        avg = statistics.fmean(rs)
        now = time.time()
        if not self._latency_alert and avg >= settings["pingCrit"] and now - self._last_lat_event > 300:
            self._latency_alert = True
            self._last_lat_event = now
            self.db.add_event("high_latency", "warn", "Độ trễ cao",
                              f"Ping trung bình 10 giây tới {settings['pingTarget']} là {avg:.0f} ms (ngưỡng {settings['pingCrit']:.0f} ms)")
        elif self._latency_alert and avg < settings["pingWarn"]:
            self._latency_alert = False

    def _check_loss(self, qual: dict) -> None:
        pct = qual["lost"] * 100 / qual["sent"]
        now = time.time()
        # ≥3 lost probes: a single dropped ICMP packet on Wi-Fi is noise, not an incident.
        # (lost == sent is a full outage, already reported by the reachability check)
        if (pct >= settings["lossWarn"] and qual["lost"] >= 3 and qual["lost"] < qual["sent"]
                and now - self._last_loss_event > 300):
            self._last_loss_event = now
            self.db.add_event("packet_loss", "warn" if pct < 10 else "crit", "Mất gói",
                              f"Mất {pct:.1f}% gói ({qual['lost']}/{qual['sent']}) trong 1 phút tới {settings['pingTarget']}")

    # ================================================================ wifi
    def _wifi_loop(self) -> None:
        if not self.wlan or not self.wlan_guid:
            with self.lock:
                self.wifi = {"connected": False, "available": False, "error": self.wlan_error}
            self._sleep_until(time.monotonic() + 30)
            return
        self._poll_wifi()
        self._sleep_until(time.monotonic() + 2)

    def _poll_wifi(self) -> None:
        conn = self.wlan.connection(self.wlan_guid)
        now = time.time()
        connected = conn.get("state") == "connected"
        prev = self.wifi
        if connected and (now - self.bss_at > 15 or prev.get("bssid") != conn.get("bssid")):
            try:
                self.bss_cache = {b["bssid"]: b for b in self.wlan.bss_list(self.wlan_guid)}
            except Exception:  # noqa: BLE001
                pass
            self.bss_at = now

        ad = next((a for a in self.net.get("adapters", []) if a["guid"] == str(self.wlan_guid)), {})
        info = {
            "available": True, "connected": connected, "state": conn.get("state"),
            "locationBlocked": bool(conn.get("locationBlocked")),
            "interfaceName": ad.get("name") or "Wi-Fi", "adapter": self.wlan_desc,
            "driver": ad.get("driver"), "driverProvider": ad.get("driverProvider"),
            "mac": (ad.get("mac") or "").replace("-", ":").lower() or None,
        }
        if connected:
            bss = self.bss_cache.get(conn.get("bssid"), {})
            ch = conn.get("channel") or bss.get("channel")
            band = bss.get("band")
            if not band and ch:
                from .winapi.wlan import channel_to_band
                band = channel_to_band(ch)
            info.update({
                "ssid": conn.get("ssid"), "bssid": conn.get("bssid"), "profile": conn.get("profile"),
                "connectionMode": conn.get("connectionMode"), "standard": conn.get("standard"),
                "radioType": conn.get("radioType"), "apStandard": bss.get("standard"),
                "authentication": conn.get("authentication"), "cipher": conn.get("cipher"),
                "signal": conn.get("signal"), "rssi": conn.get("rssi") if conn.get("rssi") is not None else bss.get("rssi"),
                "rxRate": conn.get("rxRate"), "txRate": conn.get("txRate"),
                "channel": ch, "band": band, "frequency": bss.get("frequency"),
                "channelWidth": f"{bss['width']} MHz" if bss.get("width") else None,
            })
            same = prev.get("connected") and prev.get("ssid") == info["ssid"]
            if same:
                info["connectedSince"] = prev.get("connectedSince")
            elif not prev.get("connected") and prev.get("_init") is None:
                # first observation after agent start: ask the WLAN event log when we connected
                since = self.net.get("wlanConnectedAt")
                info["connectedSince"] = since * 1000 if since and since <= now else int(self.started_at * 1000)
            else:
                info["connectedSince"] = int(now * 1000)
            with self.lock:
                q = self._qmin
                if info["signal"] is not None:
                    q["signals"].append(info["signal"])
                if info["rssi"] is not None:
                    q["rssis"].append(info["rssi"])
        info["_init"] = True

        self._wifi_events(prev, info, now)
        with self.lock:
            self.wifi = info

    def _wifi_events(self, prev: dict, cur: dict, now: float) -> None:
        if prev.get("_init") is None:
            return  # first poll — nothing to compare
        if cur["connected"] and not prev.get("connected"):
            self.db.add_event("connect", "good", "Kết nối Wi-Fi",
                              f"Đã kết nối tới {cur.get('ssid')} ({cur.get('band') or '?'}, kênh {cur.get('channel')}, {cur.get('signal')}%)")
            self.net_force.set()
            self.public_at = 0
        elif prev.get("connected") and not cur["connected"]:
            self.db.add_event("disconnect", "crit", "Mất kết nối Wi-Fi",
                              f"Ngắt kết nối khỏi {prev.get('ssid')} (tín hiệu cuối {prev.get('signal')}%, {prev.get('rssi')} dBm)")
            self.net_force.set()
        elif cur["connected"] and prev.get("ssid") != cur.get("ssid"):
            self.db.add_event("connect", "good", "Chuyển mạng Wi-Fi", f"{prev.get('ssid')} → {cur.get('ssid')}")
            self.net_force.set()
            self.public_at = 0
        elif cur["connected"] and prev.get("bssid") != cur.get("bssid"):
            self.db.add_event("roam", "info", "Chuyển điểm truy cập (roaming)",
                              f"BSSID {prev.get('bssid')} → {cur.get('bssid')} · kênh {prev.get('channel')} → {cur.get('channel')}")
        if cur["connected"] and cur.get("signal") is not None:
            if cur["signal"] < settings["signalWarn"]:
                if self._signal_low_since is None:
                    self._signal_low_since = now
                elif now - self._signal_low_since >= 10 and now - self._last_signal_event > 600:
                    self._last_signal_event = now
                    self.db.add_event("signal_drop", "warn", "Tín hiệu Wi-Fi yếu",
                                      f"Tín hiệu {cur['signal']}% ({cur.get('rssi')} dBm) dưới ngưỡng {settings['signalWarn']}% hơn 10 giây")
            else:
                self._signal_low_since = None

    # ================================================================ slow loop
    def _slow_loop(self) -> None:
        now = time.time()
        if self.net_force.is_set() or now - self.net_at > 30:
            self.net_force.clear()
            self._refresh_net()
        if settings["publicIpLookup"] and self.primary_type() != "none" and now - self.public_at > 1800:
            self._lookup_public()
        last_prune = float(self.db.kv_get("last_prune", 0))
        if now - last_prune > 3600:
            self.db.prune(settings["retentionDays"])
            self.db.kv_set("last_prune", now)
        self._check_cap()
        self._auto_speedtest(now)
        self.net_force.wait(5)

    def _check_cap(self) -> None:
        cap = settings["monthlyCapGB"]
        if not cap:
            return
        used_gb = sum(self.month) / 1024 ** 3
        key = datetime.now().strftime("%Y-%m")
        for pct, level in ((100, "crit"), (80, "warn")):
            if used_gb >= cap * pct / 100:
                k = f"cap_alert_{key}_{pct}"
                if not self.db.kv_get(k):
                    self.db.kv_set(k, 1)
                    self.db.add_event("usage_alert", level, "Cảnh báo dung lượng",
                                      f"Đã dùng {used_gb:.1f} GB / {cap:g} GB ({used_gb * 100 / cap:.0f}%) hạn mức tháng {key}")
                break

    def _auto_speedtest(self, now: float) -> None:
        mode = settings["autoSpeedtest"]
        if mode == "off" or self.primary_type() == "none" or self._down_since:
            return
        every = 6 * 3600 if mode == "6h" else 86400
        last = self.db.speedtests(1)
        if last and now - last[-1]["ts"] / 1000 < every:
            return
        if now - self.started_at < 120:
            return  # let the machine settle after start
        from . import tools
        tools.start_speedtest(self, auto=True)

    # ================================================================ views
    def status(self) -> dict:
        p = self.net.get("primary") or {}
        ptype = self.primary_type()
        if ptype == "wifi" and self.wifi.get("connected"):
            name = self.wifi.get("ssid") or self.wifi.get("interfaceName")
        elif p.get("name"):
            name = p["name"]
        else:
            name = "Mất kết nối"
        return {
            "online": self._down_since is None and ptype != "none",
            "interfaceType": ptype, "name": name, "primary": p.get("name"),
        }
