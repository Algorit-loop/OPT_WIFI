"""SQLite storage: per-minute traffic/quality, hourly traffic roll-up, events, speed tests.

Times are stored as epoch seconds (UTC); grouping by local day/month uses SQLite's
'localtime' modifier so buckets match the user's clock.
"""
from __future__ import annotations

import sqlite3
import threading
import time
from datetime import datetime, timedelta

from .config import DB_PATH

SCHEMA = """
CREATE TABLE IF NOT EXISTS traffic_min (
  ts INTEGER PRIMARY KEY, rx INTEGER NOT NULL, tx INTEGER NOT NULL,
  peak_down REAL, peak_up REAL, active_s REAL, active_rx INTEGER, samples INTEGER, iface TEXT
);
CREATE TABLE IF NOT EXISTS traffic_hour (
  ts INTEGER PRIMARY KEY, rx INTEGER NOT NULL, tx INTEGER NOT NULL,
  peak_down REAL, peak_up REAL, active_s REAL, active_rx INTEGER
);
CREATE TABLE IF NOT EXISTS quality_min (
  ts INTEGER PRIMARY KEY, sent INTEGER, lost INTEGER, ping_avg REAL, ping_min REAL, ping_max REAL,
  jitter REAL, signal REAL, rssi REAL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, type TEXT, level TEXT, title TEXT, detail TEXT
);
CREATE INDEX IF NOT EXISTS events_ts ON events(ts);
CREATE TABLE IF NOT EXISTS speedtests (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, down REAL, up REAL, ping REAL, jitter REAL,
  server TEXT, iface TEXT, ssid TEXT
);
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
"""


class DB:
    def __init__(self, path=DB_PATH) -> None:
        self.path = path
        self._lock = threading.Lock()
        self.conn = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA synchronous=NORMAL")
        self.conn.executescript(SCHEMA)

    def q(self, sql: str, args=()) -> list[sqlite3.Row]:
        with self._lock:
            return self.conn.execute(sql, args).fetchall()

    def x(self, sql: str, args=()) -> int:
        with self._lock:
            cur = self.conn.execute(sql, args)
            return cur.lastrowid

    # ------------------------------------------------------------------ kv
    def kv_get(self, k: str, default=None):
        r = self.q("SELECT v FROM kv WHERE k=?", (k,))
        return r[0]["v"] if r else default

    def kv_set(self, k: str, v) -> None:
        self.x("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", (k, str(v)))

    # ------------------------------------------------------------------ writes
    def write_minute(self, t: dict, qual: dict | None) -> None:
        """Persist one finished minute and roll it into the hourly table."""
        hour = t["ts"] - t["ts"] % 3600
        with self._lock:
            c = self.conn
            c.execute("BEGIN")
            try:
                c.execute(
                    "INSERT OR REPLACE INTO traffic_min VALUES (?,?,?,?,?,?,?,?,?)",
                    (t["ts"], t["rx"], t["tx"], t["peak_down"], t["peak_up"], t["active_s"], t["active_rx"], t["samples"], t["iface"]),
                )
                if t["samples"]:
                    c.execute(
                        """INSERT INTO traffic_hour VALUES (?,?,?,?,?,?,?)
                           ON CONFLICT(ts) DO UPDATE SET rx=rx+excluded.rx, tx=tx+excluded.tx,
                             peak_down=MAX(peak_down, excluded.peak_down), peak_up=MAX(peak_up, excluded.peak_up),
                             active_s=active_s+excluded.active_s, active_rx=active_rx+excluded.active_rx""",
                        (hour, t["rx"], t["tx"], t["peak_down"], t["peak_up"], t["active_s"], t["active_rx"]),
                    )
                if qual:
                    c.execute(
                        "INSERT OR REPLACE INTO quality_min VALUES (?,?,?,?,?,?,?,?,?)",
                        (qual["ts"], qual["sent"], qual["lost"], qual["ping_avg"], qual["ping_min"], qual["ping_max"],
                         qual["jitter"], qual["signal"], qual["rssi"]),
                    )
                c.execute("COMMIT")
            except Exception:
                c.execute("ROLLBACK")
                raise

    def add_event(self, type_: str, level: str, title: str, detail: str, ts: float | None = None) -> int:
        return self.x(
            "INSERT INTO events(ts,type,level,title,detail) VALUES (?,?,?,?,?)",
            (int(ts or time.time()), type_, level, title, detail),
        )

    def add_speedtest(self, r: dict) -> int:
        return self.x(
            "INSERT INTO speedtests(ts,down,up,ping,jitter,server,iface,ssid) VALUES (?,?,?,?,?,?,?,?)",
            (int(time.time()), r["down"], r["up"], r["ping"], r["jitter"], r.get("server"), r.get("iface"), r.get("ssid")),
        )

    def prune(self, retention_days: int) -> None:
        cut = int(time.time()) - retention_days * 86400
        self.x("DELETE FROM traffic_min WHERE ts < ?", (cut,))
        self.x("DELETE FROM quality_min WHERE ts < ?", (cut,))
        self.x("DELETE FROM events WHERE ts < ?", (cut,))
        # hourly roll-up is tiny (~9k rows/year) — keep 3 years for long-term trends
        self.x("DELETE FROM traffic_hour WHERE ts < ?", (int(time.time()) - 3 * 365 * 86400,))

    def wipe_history(self) -> None:
        for t in ("traffic_min", "traffic_hour", "quality_min", "events", "speedtests"):
            self.x(f"DELETE FROM {t}")
        self.x("DELETE FROM kv WHERE k LIKE 'cap_alert_%'")
        with self._lock:
            self.conn.execute("VACUUM")

    # ------------------------------------------------------------------ reads
    def totals_since(self, ts: int) -> tuple[int, int]:
        # Use hourly roll-ups for complete hours so pruned minute rows still count.
        # Only the first, partial hour needs minute rows to respect an unaligned ts.
        first_full_hour = (ts + 3599) // 3600 * 3600
        hour = self.q(
            "SELECT COALESCE(SUM(rx),0) rx, COALESCE(SUM(tx),0) tx FROM traffic_hour WHERE ts >= ?",
            (first_full_hour,),
        )[0]
        if first_full_hour == ts:
            return hour["rx"], hour["tx"]
        minute = self.q(
            "SELECT COALESCE(SUM(rx),0) rx, COALESCE(SUM(tx),0) tx FROM traffic_min WHERE ts >= ? AND ts < ?",
            (ts, first_full_hour),
        )[0]
        return hour["rx"] + minute["rx"], hour["tx"] + minute["tx"]

    def usage(self, rng: str, pending: dict | None) -> list[dict]:
        """Consumption buckets in local time; observed=False means no traffic sample was collected."""
        now = datetime.now()
        buckets: list[tuple[datetime, datetime, str]] = []
        if rng == "24h":
            start = now.replace(minute=0, second=0, microsecond=0) - timedelta(hours=23)
            for i in range(24):
                b = start + timedelta(hours=i)
                buckets.append((b, b + timedelta(hours=1), f"{b.hour:02d}h"))
        elif rng in ("7d", "30d"):
            n = 7 if rng == "7d" else 30
            start = now.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=n - 1)
            for i in range(n):
                b = start + timedelta(days=i)
                buckets.append((b, b + timedelta(days=1), f"{b.day:02d}/{b.month:02d}"))
        else:
            y, m = now.year, now.month
            months = []
            for _ in range(12):
                months.append((y, m))
                m -= 1
                if m == 0:
                    y, m = y - 1, 12
            for y, m in reversed(months):
                b = datetime(y, m, 1)
                e = datetime(y + (m == 12), m % 12 + 1, 1)
                buckets.append((b, e, f"T{m}/{str(y)[2:]}"))

        lo, hi = int(buckets[0][0].timestamp()), int(buckets[-1][1].timestamp())
        rows = self.q("SELECT * FROM traffic_hour WHERE ts >= ? AND ts < ? ORDER BY ts", (lo, hi))
        out = []
        j = 0
        for b, e, label in buckets:
            bs, be = int(b.timestamp()), int(e.timestamp())
            rx = tx = active_rx = 0
            active_s = 0.0
            peak = 0.0
            observed = False
            while j < len(rows) and rows[j]["ts"] < be:
                r = rows[j]
                if r["ts"] >= bs:
                    observed = True
                    rx += r["rx"]; tx += r["tx"]; active_rx += r["active_rx"] or 0
                    active_s += r["active_s"] or 0; peak = max(peak, r["peak_down"] or 0)
                j += 1
            if pending and pending.get("observed", pending.get("samples", 0) > 0) and bs <= pending["ts"] < be:
                observed = True
                rx += pending["rx"]; tx += pending["tx"]; active_rx += pending["active_rx"]
                active_s += pending["active_s"]; peak = max(peak, pending["peak_down"])
            out.append({
                "ts": bs * 1000, "label": label, "down": rx, "up": tx,
                "avg": (active_rx * 8 / active_s) if active_s else 0, "peak": peak, "observed": observed,
            })
        return out

    def heatmap(self) -> list[list[float | None]]:
        """Average bytes per weekday/hour over 28 days; None means no observation."""
        since = int(time.time()) - 28 * 86400
        rows = self.q(
            """SELECT CAST(strftime('%w', ts, 'unixepoch', 'localtime') AS INT) dow,
                      CAST(strftime('%H', ts, 'unixepoch', 'localtime') AS INT) hr,
                      SUM(rx + tx) bytes,
                      COUNT(DISTINCT date(ts, 'unixepoch', 'localtime')) days
               FROM traffic_hour WHERE ts >= ? GROUP BY dow, hr""",
            (since,),
        )
        grid = [[None] * 24 for _ in range(7)]
        for r in rows:
            grid[(r["dow"] + 6) % 7][r["hr"]] = r["bytes"] / max(1, r["days"])
        return grid

    def quality(self, rng: str) -> list[dict]:
        n, step = {"1h": (60, 60), "24h": (96, 900), "7d": (84, 7200)}.get(rng, (60, 60))
        now = int(time.time())
        end = now - now % step + step
        start = end - n * step
        rows = self.q(
            f"""SELECT (ts / {step}) * {step} b, SUM(sent) sent, SUM(lost) lost,
                       SUM(ping_avg * (sent - lost)) / NULLIF(SUM(CASE WHEN ping_avg IS NOT NULL THEN sent - lost END), 0) avg,
                       MIN(ping_min) mn, MAX(ping_max) mx, AVG(jitter) jit, AVG(signal) sig
                FROM quality_min WHERE ts >= ? AND ts < ? GROUP BY b""",
            (start, end),
        )
        by = {r["b"]: r for r in rows}
        out = []
        for i in range(n):
            b = start + i * step
            r = by.get(b)
            if not r or not r["sent"]:
                out.append({"ts": b * 1000, "avg": None, "min": None, "max": None, "jitter": None, "loss": None, "signal": None, "sent": 0})
                continue
            out.append({
                "ts": b * 1000,
                "avg": round(r["avg"], 1) if r["avg"] is not None else None,
                "min": round(r["mn"], 1) if r["mn"] is not None else None,
                "max": round(r["mx"], 1) if r["mx"] is not None else None,
                "jitter": round(r["jit"], 1) if r["jit"] is not None else None,
                "loss": round(r["lost"] * 100 / r["sent"], 1),
                "signal": round(r["sig"]) if r["sig"] is not None else None,
                "sent": r["sent"],
            })
        return out

    def events(self, after: int = 0, limit: int = 2000) -> list[dict]:
        rows = self.q("SELECT * FROM events WHERE id > ? ORDER BY id DESC LIMIT ?", (after, limit))
        return [{"id": r["id"], "ts": r["ts"] * 1000, "type": r["type"], "level": r["level"],
                 "title": r["title"], "detail": r["detail"]} for r in rows]

    def last_event_id(self) -> int:
        r = self.q("SELECT COALESCE(MAX(id),0) m FROM events")
        return r[0]["m"]

    def speedtests(self, limit: int = 50) -> list[dict]:
        rows = self.q("SELECT * FROM speedtests ORDER BY ts DESC LIMIT ?", (limit,))
        return [{"id": r["id"], "ts": r["ts"] * 1000, "down": r["down"], "up": r["up"], "ping": r["ping"],
                 "jitter": r["jitter"], "server": r["server"], "iface": r["iface"], "ssid": r["ssid"]} for r in reversed(rows)]

    def size(self) -> int:
        total = 0
        for suffix in ("", "-wal", "-shm"):
            p = self.path.with_name(self.path.name + suffix)
            if p.exists():
                total += p.stat().st_size
        return total
