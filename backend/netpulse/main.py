"""HTTP API + static frontend. Bound to 127.0.0.1 only."""
from __future__ import annotations

import logging
import os
import threading
import time
from contextlib import asynccontextmanager

import psutil
from fastapi import Body, FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from . import tools
from .collector import Collector
from .config import DATA_DIR, DB_PATH, FRONTEND_DIR, VERSION, settings
from .db import DB
from .util import is_admin

log = logging.getLogger("netpulse.api")

db = DB()
collector = Collector(db)


@asynccontextmanager
async def lifespan(app: FastAPI):
    collector.start()
    log.info("collector started")
    yield
    collector.stop()
    log.info("collector stopped")


app = FastAPI(title="NetPulse Agent", version=VERSION, lifespan=lifespan, docs_url="/api/docs", redoc_url=None)

_ALLOWED_HOSTS = {"127.0.0.1", "localhost", "[::1]"}


@app.middleware("http")
async def local_only(request: Request, call_next):
    # DNS-rebinding guard: only accept requests addressed to localhost
    host = (request.headers.get("host") or "").rsplit(":", 1)[0]
    if host not in _ALLOWED_HOSTS:
        return JSONResponse({"detail": "forbidden host"}, status_code=403)
    # CSRF guard: state-changing calls need a custom header (forces a CORS preflight we never allow)
    if request.method not in ("GET", "HEAD", "OPTIONS") and request.url.path.startswith("/api/"):
        if request.headers.get("x-netpulse") != "1":
            return JSONResponse({"detail": "missing X-NetPulse header"}, status_code=403)
    response = await call_next(request)
    # This local dashboard changes in place; stale HTML/JS can mix incompatible versions.
    if not request.url.path.startswith('/api/'):
        response.headers['Cache-Control'] = 'no-store'
    return response


# ---------------------------------------------------------------- status & live
@app.get("/api/status")
def status():
    st = collector.status()
    cap = db.speedtests(1)
    return {
        **st, "agent": "agent", "version": VERSION, "startedAt": int(collector.started_at * 1000),
        "pid": os.getpid(), "admin": is_admin(), "dataDir": str(DATA_DIR), "dbPath": str(DB_PATH), "dbSize": db.size(),
        "capacity": cap[-1] if cap else None, "eventSeq": db.last_event_id(),
        "wifiAvailable": bool(collector.wlan_guid), "locationBlocked": bool(collector.wifi.get("locationBlocked")),
        "samples": len(collector.buffer),
        "lastSeenEvent": int(db.kv_get("ui_last_seen_event", 0) or 0),
    }


@app.get("/api/live")
def live(since: int = 0, n: int = 0):
    with collector.lock:
        buf = list(collector.buffer)
    if n:
        samples = buf[-n:]
    else:
        samples = [s for s in buf if s["ts"] > since]
    return {"samples": samples, "eventSeq": db.last_event_id(), "status": collector.status()}


# ---------------------------------------------------------------- network info
def _wifi_view() -> dict:
    w = {k: v for k, v in collector.wifi.items() if not k.startswith("_")}
    return w


@app.get("/api/wifi")
def wifi():
    return _wifi_view()


@app.post("/api/wifi/scan")
async def wifi_scan():
    if not collector.wlan or not collector.wlan_guid:
        raise HTTPException(400, collector.wlan_error or "Không có card Wi-Fi")

    def scan():
        from .winapi.wlan import WlanError
        collector.wlan.scan(collector.wlan_guid)
        time.sleep(3.5)  # scan completes asynchronously in ~2–4 s
        try:
            nets = collector.wlan.bss_list(collector.wlan_guid)
        except WlanError as e:
            if e.args and e.args[0] == 5:
                raise HTTPException(403, "location") from e
            raise
        cur = collector.wifi.get("bssid")
        for x in nets:
            x["connected"] = x["bssid"] == cur
            x["hidden"] = not x["ssid"]
            x["ssid"] = x["ssid"] or "(mạng ẩn)"
        return sorted(nets, key=lambda x: -x["rssi"])

    return await run_in_threadpool(scan)


@app.post("/api/wifi/connect")
async def wifi_connect(body: dict = Body(...)):
    pw = body.get("password")
    r = await run_in_threadpool(tools.connect_wifi, collector, str(body.get("ssid") or ""), None if pw is None else str(pw))
    if r.get("error") == "location":
        raise HTTPException(403, "location")
    return r


@app.get("/api/network")
def network():
    p = collector.net.get("primary") or {}
    v6 = p.get("ipv6") or []
    ad = collector.primary_adapter() or {}
    return {
        "hostname": collector.net.get("host"), "interfaceName": p.get("name"), "interfaceType": collector.primary_type(),
        "adapter": ad.get("desc"), "ipv4": p.get("ipv4"), "subnet": p.get("subnet"), "gateway": p.get("gateway"),
        "dns": p.get("dns") or [], "ipv6": next((a for a in v6 if a.lower().startswith("fe80")), None),
        "ipv6Global": next((a for a in v6 if not a.lower().startswith("fe80")), None),
        "dhcp": p.get("dhcp"), "dhcpServer": p.get("dhcpServer"),
        "leaseObtained": p["leaseObtained"] * 1000 if p.get("leaseObtained") else None,
        "leaseExpires": p["leaseExpires"] * 1000 if p.get("leaseExpires") else None,
        "domain": p.get("domain"), "mtu": ad.get("mtu"), "linkSpeed": ad.get("speed"),
        "publicIp": collector.public.get("ip"), "isp": collector.public.get("isp"),
        "location": ", ".join(x for x in (collector.public.get("city"), collector.public.get("country")) if x) or None,
        "updatedAt": int(collector.net_at * 1000),
    }


@app.get("/api/adapters")
def adapters():
    io = psutil.net_io_counters(pernic=True)
    configs = collector.net.get("configs") or {}
    out = []
    for a in collector.net.get("adapters", []):
        media = (a.get("physMedia") or a.get("media") or "")
        typ = ("Wireless" if "802.11" in media else "Ethernet" if "802.3" in media
               else "Bluetooth" if "bluetooth" in (a.get("desc") or "").lower() else "Virtual" if a.get("virtual") else media or "Khác")
        c = io.get(a["name"])
        cfg = configs.get(a["ifIndex"]) or configs.get(str(a["ifIndex"])) or {}
        out.append({
            "name": a["name"], "desc": a["desc"], "type": typ, "status": a["status"], "speed": a["speed"],
            "mac": a["mac"], "ipv4": cfg.get("ipv4") or "—", "driver": a.get("driver"),
            "rx": c.bytes_recv if c else 0, "tx": c.bytes_sent if c else 0,
            "primary": a["ifIndex"] == (collector.net.get("primary") or {}).get("ifIndex"),
        })
    return out


@app.get("/api/capacity")
def capacity():
    cap = db.speedtests(1)
    return cap[-1] if cap else None


# ---------------------------------------------------------------- history
@app.get("/api/usage")
def usage(range: str = "24h"):  # noqa: A002 — query param name used by the UI
    if range not in ("24h", "7d", "30d", "12m"):
        raise HTTPException(400, "range")
    return db.usage(range, collector.pending())


@app.get("/api/usage/heatmap")
def heatmap():
    return db.heatmap()


@app.get("/api/quality")
def quality(range: str = "1h"):  # noqa: A002
    if range not in ("1h", "24h", "7d"):
        raise HTTPException(400, "range")
    return db.quality(range)


@app.get("/api/quality/targets")
async def targets():
    return await run_in_threadpool(tools.ping_targets, collector)


@app.get("/api/events")
def events(after: int = 0, limit: int = 2000):
    return db.events(after, max(1, min(limit, 10000)))


@app.post("/api/events/seen")
def events_seen(body: dict = Body(...)):
    db.kv_set("ui_last_seen_event", int(body.get("id") or 0))
    return {"ok": True}


@app.delete("/api/events")
def clear_events():
    db.x("DELETE FROM events")
    return {"ok": True}


@app.get("/api/speedtest/history")
def speed_history():
    return db.speedtests(50)


# ---------------------------------------------------------------- tools
@app.post("/api/tools/speedtest")
def tool_speedtest():
    return {"job": tools.start_speedtest(collector).id}


@app.post("/api/tools/ping")
def tool_ping(body: dict = Body(...)):
    try:
        return {"job": tools.start_ping(body.get("host", ""), body.get("count", 4)).id}
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@app.post("/api/tools/traceroute")
def tool_trace(body: dict = Body(...)):
    try:
        return {"job": tools.start_traceroute(body.get("host", "")).id}
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@app.post("/api/tools/dns")
async def tool_dns(body: dict = Body(...)):
    try:
        return await run_in_threadpool(tools.dns_lookup, body.get("host", ""), body.get("type", "A"))
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@app.get("/api/jobs/active")
def jobs_active():
    return tools.active_jobs()


@app.get("/api/jobs/{job_id}")
def job(job_id: str, line: int = 0, item: int = 0):
    j = tools.get_job(job_id)
    if not j:
        raise HTTPException(404, "job")
    return j.view(line, item)


@app.post("/api/actions/{name}")
async def action(name: str, body: dict = Body(default={})):
    return await run_in_threadpool(tools.run_action, collector, name, bool(body.get("elevate")))


# ---------------------------------------------------------------- settings & data
@app.get("/api/settings")
def get_settings():
    return settings.all()


@app.put("/api/settings")
def put_settings(body: dict = Body(...)):
    return settings.update(body)


@app.delete("/api/settings")
def reset_settings():
    return settings.reset()


@app.delete("/api/data")
def wipe_data():
    db.wipe_history()
    with collector.lock:
        collector.today = [0, 0]
        collector.month = [0, 0]
        collector.session = [0, 0]
        collector._min = None  # drop the half-collected minute too
        collector._qmin = collector._new_qmin(0)
    db.add_event("agent", "info", "Đã xoá lịch sử", "Toàn bộ dữ liệu thống kê, log và speed test đã được xoá")
    return {"ok": True}


SERVER = None  # set by run.py — the uvicorn.Server instance


@app.post("/api/shutdown")
def shutdown():
    def later():
        time.sleep(0.3)
        if SERVER is not None:
            SERVER.should_exit = True  # graceful: lifespan shutdown → collector.stop() flushes data
        else:
            os._exit(0)
    threading.Thread(target=later, daemon=True).start()
    return {"ok": True}


# static frontend last so /api/* wins
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
