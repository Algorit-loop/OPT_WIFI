"""On-demand tools: speed test, ping, traceroute, DNS lookup, network actions, diagnostics.

Long-running tools run as background "jobs" that the UI polls for new lines/items.
"""
from __future__ import annotations

import logging
import re
import socket
import statistics
import subprocess
import threading
import time
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor

import dns.exception
import dns.resolver
import dns.reversename

from . import speedtest
from .config import TMP_DIR, settings
from .util import CREATE_NO_WINDOW, is_admin, oem_encoding, run_cmd
from .winapi import icmp

log = logging.getLogger("netpulse.tools")
_pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix="np-tool")


# ====================================================================== jobs
class Job:
    def __init__(self, kind: str, params: dict | None = None) -> None:
        self.id = uuid.uuid4().hex[:12]
        self.kind = kind
        self.params = params or {}
        self.lines: list[dict] = []
        self.items: list[dict] = []
        self.progress: dict = {}
        self.result = None
        self.error: str | None = None
        self.done = False
        self.created = time.time()

    def line(self, text: str, cls: str = "") -> None:
        self.lines.append({"text": text, "cls": cls})

    def view(self, line_from: int = 0, item_from: int = 0) -> dict:
        return {"id": self.id, "kind": self.kind, "params": self.params, "lines": self.lines[line_from:], "items": self.items[item_from:],
                "progress": self.progress, "result": self.result, "error": self.error, "done": self.done}


_jobs: dict[str, Job] = {}
_jobs_lock = threading.Lock()


def _start(kind: str, fn, params: dict | None = None) -> Job:
    job = Job(kind, params)
    with _jobs_lock:
        for k in [k for k, j in _jobs.items() if j.done and time.time() - j.created > 600]:
            del _jobs[k]
        _jobs[job.id] = job

    def run():
        try:
            fn(job)
        except Exception as e:  # noqa: BLE001
            log.exception("job %s failed", kind)
            job.error = str(e) or e.__class__.__name__
            job.line(f"Lỗi: {job.error}", "er")
        finally:
            job.done = True

    threading.Thread(target=run, daemon=True, name=f"np-job-{kind}").start()
    return job


def get_job(job_id: str) -> Job | None:
    return _jobs.get(job_id)


def active_jobs() -> dict[str, dict]:
    """Newest still-running job of each kind — lets a reloaded page re-attach to work in progress."""
    with _jobs_lock:
        jobs = sorted((j for j in _jobs.values() if not j.done), key=lambda j: j.created)
    return {j.kind: {"id": j.id, "params": j.params, "created": int(j.created * 1000)} for j in jobs}


# ====================================================================== speed test
_speed_lock = threading.Lock()
_speed_job: Job | None = None


def start_speedtest(collector, auto: bool = False) -> Job:
    global _speed_job
    with _speed_lock:
        if _speed_job and not _speed_job.done:
            return _speed_job

        def fn(job: Job):
            def progress(p: dict) -> None:
                job.progress.update(p)
                job.items.append(p)  # full history, so a page that re-attaches can redraw the live chart
            res = speedtest.run(progress)
            wifi = collector.wifi if collector.wifi.get("connected") else {}
            res["iface"] = (collector.net.get("primary") or {}).get("name")
            res["ssid"] = wifi.get("ssid")
            collector.db.add_speedtest(res)
            collector.db.add_event(
                "speedtest", "good", "Speed test hoàn tất" + (" (tự động)" if auto else ""),
                f"↓ {res['down'] / 1e6:.0f} Mbps · ↑ {res['up'] / 1e6:.0f} Mbps · ping {res['ping']:.0f} ms · {res['server']}",
            )
            if res.get("isp"):
                collector.public.update({"ip": res.get("ip"), "isp": res.get("isp")})
            job.result = res

        _speed_job = _start("speedtest", fn, {"auto": auto})
        return _speed_job


# ====================================================================== ping / traceroute
def _clean_host(host: str) -> str:
    host = (host or "").strip()
    if not host or len(host) > 253 or any(c in host for c in " /\\\"'`;&|<>"):
        raise ValueError("Host không hợp lệ")
    return host


def start_ping(host: str, count: int) -> Job:
    host = _clean_host(host)
    count = max(1, min(100, int(count)))

    def fn(job: Job):
        try:
            ip = icmp.resolve(host)
        except OSError:
            job.line(f"Ping request could not find host {host}. Please check the name and try again.", "er")
            return
        job.line(f"Pinging {host}" + (f" [{ip}]" if ip != host else "") + " with 32 bytes of data:", "dim")
        times, lost = [], 0
        for i in range(count):
            t0 = time.monotonic()
            r = icmp.ping(ip, 2000)
            if r["ok"]:
                times.append(r["rtt"])
                t = r["rtt"]
                job.line(f"Reply from {r['addr']}: bytes=32 time{'<1' if t < 1 else '=' + str(round(t))}ms TTL={r['ttl']}", "ok")
            else:
                lost += 1
                job.line(f"Reply from {r['addr']}: {icmp.status_text(r['status'])}" if r.get("addr") else icmp.status_text(r["status"]), "er")
            if i < count - 1:
                time.sleep(max(0, 1 - (time.monotonic() - t0)))
        job.line("")
        job.line(f"Ping statistics for {ip}:", "p")
        job.line(f"    Packets: Sent = {count}, Received = {len(times)}, Lost = {lost} ({round(lost * 100 / count)}% loss)")
        if times:
            jit = statistics.fmean(abs(a - b) for a, b in zip(times, times[1:])) if len(times) > 1 else 0
            job.line("Approximate round trip times in milli-seconds:", "p")
            job.line(f"    Minimum = {min(times):.0f}ms, Maximum = {max(times):.0f}ms, Average = {statistics.fmean(times):.0f}ms, Jitter = {jit:.1f}ms")
        job.result = {"times": times, "lost": lost}

    return _start("ping", fn, {"host": host, "count": count})


def _rdns(ip: str) -> str:
    fut = _pool.submit(socket.gethostbyaddr, ip)
    try:
        return fut.result(timeout=1.5)[0]
    except Exception:  # noqa: BLE001
        return "—"


def start_traceroute(host: str, max_hops: int = 30) -> Job:
    host = _clean_host(host)

    def fn(job: Job):
        ip = icmp.resolve(host)
        job.progress = {"target": ip}
        for ttl in range(1, max_hops + 1):
            rtts, addr, reached = [], None, False
            for _ in range(3):
                r = icmp.ping(ip, 2000, ttl=ttl)
                if r["addr"]:
                    addr = r["addr"]
                    rtts.append(r["rtt"])
                    reached = reached or r["ok"]
                else:
                    rtts.append(None)
            job.items.append({"hop": ttl, "ip": addr or "*", "name": _rdns(addr) if addr else "*",
                              "rtt": [None if x is None else round(x) for x in rtts] if addr else None})
            if reached:
                break
        job.result = {"hops": len(job.items), "reached": reached}

    return _start("traceroute", fn, {"host": host})


# ====================================================================== DNS
def dns_lookup(host: str, rtype: str) -> dict:
    host = _clean_host(host)
    rtype = rtype.upper()
    if rtype not in {"A", "AAAA", "MX", "NS", "TXT", "CNAME", "SOA", "PTR"}:
        raise ValueError("Loại bản ghi không hỗ trợ")
    res = dns.resolver.Resolver()
    res.lifetime = 5
    q = host
    if rtype == "PTR":
        q = dns.reversename.from_address(host)
    t0 = time.perf_counter()
    records, error = [], None
    try:
        ans = res.resolve(q, rtype)
        for r in ans:
            if rtype in ("A", "AAAA"):
                v = r.address
            elif rtype == "MX":
                v = f"{r.preference} {r.exchange.to_text()}"
            elif rtype == "TXT":
                v = " ".join(f'"{s.decode(errors="replace")}"' for s in r.strings)
            else:
                v = r.to_text()
            records.append({"type": rtype, "value": v, "ttl": ans.rrset.ttl})
    except dns.resolver.NXDOMAIN:
        error = "Tên miền không tồn tại (NXDOMAIN)"
    except dns.resolver.NoAnswer:
        error = None
    except dns.exception.Timeout:
        error = "Hết thời gian chờ DNS server"
    except Exception as e:  # noqa: BLE001
        error = str(e)
    return {"server": res.nameservers[0] if res.nameservers else None,
            "time": round((time.perf_counter() - t0) * 1000), "records": records, "error": error}


# ====================================================================== actions
def _elevated(cmdline: str) -> tuple[int, str]:
    """Run a cmd line elevated through UAC, capturing output into data/tmp."""
    out = TMP_DIR / f"elev-{uuid.uuid4().hex[:8]}.txt"
    ps = (
        f"$p = Start-Process -FilePath cmd.exe -ArgumentList '/c {cmdline} > \"{out}\" 2>&1' "
        "-Verb RunAs -WindowStyle Hidden -Wait -PassThru; exit $p.ExitCode"
    )
    p = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
                       capture_output=True, timeout=180, creationflags=CREATE_NO_WINDOW)
    text = ""
    if out.exists():
        text = out.read_bytes().decode(oem_encoding(), errors="replace").replace("\r\n", "\n").strip()
        out.unlink(missing_ok=True)
    if p.returncode != 0 and not text:
        err = p.stderr.decode(oem_encoding(), errors="replace")
        if "canceled" in err.lower() or "huỷ" in err.lower() or "cancel" in err.lower():
            return 1223, "Đã huỷ yêu cầu quyền Administrator (UAC)."
        return p.returncode, err.strip() or "Không chạy được với quyền Administrator."
    return p.returncode, text


def _q(s: str) -> str:
    return '"' + s.replace('"', "") + '"'


def run_action(collector, name: str, elevate: bool = False) -> dict:
    iface = (collector.net.get("primary") or {}).get("name") or ""
    wifi_if = collector.wifi.get("interfaceName") or "Wi-Fi"
    profile = collector.wifi.get("profile") or collector.wifi.get("ssid")

    if name == "diag":
        return {"ok": True, "output": diagnose(collector)}

    cmds: list[str]
    if name == "flushdns":
        cmds = ["ipconfig /flushdns"]
    elif name == "renew":
        cmds = [f"ipconfig /renew {_q(iface)}" if iface else "ipconfig /renew"]
    elif name == "release":  # release + renew so the machine never stays without an address
        cmds = [f"ipconfig /release {_q(iface)}", f"ipconfig /renew {_q(iface)}"] if iface else ["ipconfig /release", "ipconfig /renew"]
    elif name == "reconnect":
        if not profile:
            return {"ok": False, "output": "Không có profile Wi-Fi để kết nối lại (chưa kết nối Wi-Fi?)."}
        cmds = [f"netsh wlan disconnect interface={_q(wifi_if)}", f"netsh wlan connect name={_q(profile)} interface={_q(wifi_if)}"]
    elif name == "disconnect":
        cmds = [f"netsh wlan disconnect interface={_q(wifi_if)}"]
    elif name == "resetWinsock":
        cmds = ["netsh winsock reset"]
    else:
        return {"ok": False, "output": f"Thao tác không hỗ trợ: {name}"}

    outputs, ok = [], True
    if elevate and not is_admin():
        rc, text = _elevated(" & ".join(cmds))
        return {"ok": rc == 0, "output": text or "(không có output)", "elevated": True}
    for i, c in enumerate(cmds):
        if name == "reconnect" and i == 1:
            time.sleep(1.5)
        rc, text = run_cmd(["cmd", "/c", c], timeout=90)
        outputs.append(f"> {c}\n{text}" if len(cmds) > 1 else text)
        if rc != 0:
            ok = False
            break
    out = "\n\n".join(outputs) or "(không có output)"
    # e.g. "The requested operation requires elevation" — offer a UAC retry for any failed command
    needs_admin = (not ok) and not is_admin()
    collector.net_force.set()
    return {"ok": ok, "output": out, "needsAdmin": needs_admin}


# ====================================================================== Wi-Fi connect
# dot11 auth algorithm → (profile <authentication>, <encryption>, needs a password)
_PROFILE_AUTH = {
    1: ("open", "none", False),       # Open
    10: ("OWE", "AES", False),        # Enhanced Open
    4: ("WPAPSK", None, True),        # WPA-Personal
    7: ("WPA2PSK", None, True),       # WPA2-Personal
    9: ("WPA3SAE", "AES", True),      # WPA3-Personal
}
_CIPHER_ENC = {2: "TKIP", 4: "AES"}


def _xml(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def _profile_xml(ssid: str, auth: str, enc: str, password: str | None) -> str:
    key = ""
    if password is not None:
        key_type = "networkKey" if len(password) == 64 else "passPhrase"
        key = (f"<sharedKey><keyType>{key_type}</keyType><protected>false</protected>"
               f"<keyMaterial>{_xml(password)}</keyMaterial></sharedKey>")
    return (
        '<?xml version="1.0"?><WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1">'
        f"<name>{_xml(ssid)}</name><SSIDConfig><SSID><hex>{ssid.encode('utf-8').hex().upper()}</hex>"
        f"<name>{_xml(ssid)}</name></SSID></SSIDConfig><connectionType>ESS</connectionType>"
        "<connectionMode>auto</connectionMode><MSM><security><authEncryption>"
        f"<authentication>{auth}</authentication><encryption>{enc}</encryption><useOneX>false</useOneX>"
        f"</authEncryption>{key}</security></MSM></WLANProfile>"
    )


def _wait_connected(collector, ssid: str, profile: str, timeout: float = 20.0) -> bool:
    """Poll until the interface is connected to ssid; give up early once it settles back to disconnected."""
    t0, started, idle_since = time.time(), False, None
    while time.time() - t0 < timeout:
        time.sleep(0.5)
        c = collector.wlan.connection(collector.wlan_guid)
        st = c.get("state")
        if st == "connected" and (c.get("ssid") == ssid or c.get("profile") == profile):
            return True
        if st in ("associating", "authenticating", "discovering") or st == "connected":
            started, idle_since = True, None
        elif st == "disconnected" and started:
            idle_since = idle_since or time.time()
            if time.time() - idle_since > 4:
                return False
    return False


_wifi_op = threading.Lock()  # one connect / switch at a time


def connect_wifi(collector, ssid: str, password: str | None = None) -> dict:
    if not _wifi_op.acquire(blocking=False):
        return {"ok": False, "error": "Đang có thao tác Wi-Fi khác, hãy thử lại sau"}
    try:
        return _connect_wifi(collector, ssid, password)
    finally:
        _wifi_op.release()


def _connect_wifi(collector, ssid: str, password: str | None) -> dict:
    """Connect to a nearby network. Uses a saved profile when Windows has one; otherwise creates one.

    Returns {"ok": True} on success, {"needPassword": True} when a secured network has no saved
    profile and no password was given, or {"ok": False, "error": ...}.
    """
    from .winapi.wlan import WlanError

    if not collector.wlan or not collector.wlan_guid:
        return {"ok": False, "error": "Không có card Wi-Fi"}
    ssid = (ssid or "").strip()
    if not ssid:
        return {"ok": False, "error": "Thiếu tên mạng (SSID)"}
    try:
        nets = [x for x in collector.wlan.available_networks(collector.wlan_guid) if x["ssid"] == ssid and x["infrastructure"]]
    except WlanError as e:
        if e.args and e.args[0] == 5:
            return {"ok": False, "error": "location"}
        raise
    if not nets:
        return {"ok": False, "error": "Không còn thấy mạng này, hãy quét lại"}

    saved = next((x for x in nets if x["hasProfile"] and x["profile"]), None)
    created = False
    if saved and password is None:
        profile = saved["profile"]
    else:
        net = nets[0]
        spec = _PROFILE_AUTH.get(net["auth"])
        if not spec:
            return {"ok": False, "error": "Loại bảo mật này (doanh nghiệp / WEP) chưa hỗ trợ, hãy kết nối trong cài đặt Windows"}
        auth, enc, needs_pw = spec
        enc = enc or _CIPHER_ENC.get(net["cipher"], "AES")
        if needs_pw and password is None:
            return {"ok": False, "needPassword": True}
        if needs_pw and not (8 <= len(password) <= 63 or (len(password) == 64 and all(c in "0123456789abcdefABCDEF" for c in password))):
            return {"ok": False, "error": "Mật khẩu Wi-Fi phải dài 8–63 ký tự"}
        profile = ssid
        try:
            collector.wlan.set_profile(collector.wlan_guid, _profile_xml(ssid, auth, enc, password if needs_pw else None))
        except WlanError as e:
            log.warning("set profile %r: %s", ssid, e)
            return {"ok": False, "error": "Windows không nhận cấu hình mạng này"}
        created = True

    log.info("connecting to %r (profile %r, new=%s)", ssid, profile, created)
    try:
        collector.wlan.connect(collector.wlan_guid, profile)
    except WlanError as e:
        log.warning("connect %r: %s", ssid, e)
        return {"ok": False, "error": "Windows từ chối yêu cầu kết nối"}
    ok = _wait_connected(collector, ssid, profile)
    collector.net_force.set()
    if ok:
        return {"ok": True}
    if created and password is not None:
        collector.wlan.delete_profile(collector.wlan_guid, profile)  # don't keep a wrong password
        return {"ok": False, "error": "Không kết nối được — sai mật khẩu hoặc tín hiệu quá yếu"}
    return {"ok": False, "error": "Không kết nối được tới mạng này"}


def _wait_bssid(collector, want: str | None, timeout: float) -> dict:
    """Poll the connection until it is up on `want` (any access point when None).

    Returns early with the connection once Windows has settled on another access point after the link
    went down (it fell back). Otherwise returns the last state seen when the time runs out.
    """
    t0, down, c = time.time(), False, {}
    while time.time() - t0 < timeout:
        time.sleep(0.3)
        c = collector.wlan.connection(collector.wlan_guid)
        if c.get("state") == "connected":
            if want is None or c.get("bssid") == want or down:
                return c
        else:
            down = True
    return c


def _internet_ok(ip: str, tries: int) -> bool:
    for i in range(tries):
        try:
            if icmp.ping(ip, 1000)["ok"]:
                return True
        except OSError:
            pass
        if i < tries - 1:
            time.sleep(0.5)
    return False


def switch_bssid(collector, bssid: str) -> dict:
    """Move to another access point (BSSID) of the network we are connected to.

    Succeeds only when we end up on that BSSID and the Internet still answers. Otherwise we go back to the
    previous BSSID (about 1 s) — better than leaving it to Windows, which takes 6–7 s and may pick a
    different access point. Result: {ok, reason?, rollback?, from, now | bssid/channel/band}.
    reason: not_connected | not_found | busy | location | failed | other_ap | no_internet
    rollback: bssid (back on the old one) | profile (Windows chose) | failed
    """
    bssid = (bssid or "").strip().lower().replace("-", ":")
    if not collector.wlan or not collector.wlan_guid or not re.fullmatch(r"([0-9a-f]{2}:){5}[0-9a-f]{2}", bssid):
        return {"ok": False, "reason": "not_found"}
    if not _wifi_op.acquire(blocking=False):
        return {"ok": False, "reason": "busy"}
    try:
        return _switch_bssid(collector, bssid)
    finally:
        _wifi_op.release()


def _switch_bssid(collector, bssid: str) -> dict:
    from .winapi.wlan import WlanError, channel_to_band

    w, guid = collector.wlan, collector.wlan_guid
    cur = w.connection(guid)
    if cur.get("state") != "connected" or not cur.get("profile"):
        return {"ok": False, "reason": "not_connected"}
    try:
        target = next((b for b in w.bss_list(guid) if b["bssid"] == bssid), None)
    except WlanError as e:
        if e.args and e.args[0] == 5:
            return {"ok": False, "reason": "location"}
        raise
    if not target or target["ssid"] != cur["ssid"]:
        return {"ok": False, "reason": "not_found"}

    def where(c: dict) -> dict:
        return {"bssid": c.get("bssid"), "channel": c.get("channel"), "band": channel_to_band(c.get("channel") or 0)}

    here = where(cur)
    if bssid == cur["bssid"]:
        return {"ok": True, "bssid": bssid, "channel": target["channel"], "band": target["band"], "from": here}

    # Only demand Internet after the switch if it worked before it (an ISP outage is not the switch's fault).
    try:
        ip = icmp.resolve(settings["pingTarget"])
    except OSError:
        ip = None
    need_net = bool(ip) and _internet_ok(ip, 2)

    log.info("switch %r: %s (ch %s) -> %s (ch %s)", cur["ssid"], cur["bssid"], here["channel"], bssid, target["channel"])
    try:
        w.connect(guid, cur["profile"], bssid)
    except WlanError as e:
        log.warning("switch connect: %s", e)
        return {"ok": False, "reason": "failed", "rollback": "bssid", "from": here, "now": here}  # nothing changed

    now = _wait_bssid(collector, bssid, 8)
    if now.get("state") != "connected":
        reason = "failed"
    elif now.get("bssid") != bssid:
        reason = "other_ap"
    elif need_net and not _internet_ok(ip, 6):
        reason = "no_internet"
    else:
        collector.net_force.set()
        return {"ok": True, "bssid": bssid, "channel": target["channel"], "band": target["band"], "from": here}

    log.warning("switch to %s failed (%s), going back to %s", bssid, reason, cur["bssid"])
    rollback = "failed"
    try:
        w.connect(guid, cur["profile"], cur["bssid"])
        back = _wait_bssid(collector, cur["bssid"], 8)
        if back.get("state") == "connected" and back.get("bssid") == cur["bssid"]:
            rollback = "bssid"
        else:  # the old access point is gone: let Windows pick one of the network
            w.connect(guid, cur["profile"])
            rollback = "profile" if _wait_bssid(collector, None, 10).get("state") == "connected" else "failed"
    except WlanError as e:
        log.warning("switch rollback: %s", e)
    collector.net_force.set()
    return {"ok": False, "reason": reason, "rollback": rollback, "from": here, "now": where(w.connection(guid))}


def diagnose(collector) -> str:
    lines = []
    p = collector.net.get("primary") or {}
    st = collector.status()

    def chk(ok, label, detail=""):
        lines.append(f"[{'OK ' if ok else 'LỖI'}] {label}" + (f" — {detail}" if detail else ""))
        return ok

    has_if = chk(bool(p.get("name")), "Giao diện mạng", f"{p.get('name')} ({st['interfaceType']})" if p.get("name") else "không có default route")
    if collector.wlan_guid:
        w = collector.wifi
        chk(w.get("connected"), "Wi-Fi", f"{w.get('ssid')} · {w.get('signal')}% · {w.get('rssi')} dBm" if w.get("connected") else "chưa kết nối")
    gw_ok = False
    if p.get("gateway"):
        r = icmp.ping(p["gateway"], 1500)
        gw_ok = chk(r["ok"], f"Gateway {p['gateway']}", f"{r['rtt']:.0f} ms" if r["ok"] else icmp.status_text(r["status"]))
    else:
        chk(False, "Gateway", "không có")
    t0 = time.perf_counter()
    try:
        ip = socket.getaddrinfo("www.google.com", 443, socket.AF_INET)[0][4][0]
        dns_ok = chk(True, "Phân giải DNS", f"www.google.com → {ip} ({(time.perf_counter() - t0) * 1000:.0f} ms)")
    except OSError as e:
        dns_ok = chk(False, "Phân giải DNS", str(e))
    r = icmp.ping("1.1.1.1", 1500)
    inet_ok = chk(r["ok"], "Ping Internet (1.1.1.1)", f"{r['rtt']:.0f} ms" if r["ok"] else icmp.status_text(r["status"]))
    try:
        t0 = time.perf_counter()
        with urllib.request.urlopen("http://www.gstatic.com/generate_204", timeout=5) as resp:
            http_ok = chk(resp.status == 204, "Truy cập web (HTTP)", f"{resp.status} · {(time.perf_counter() - t0) * 1000:.0f} ms"
                          + ("" if resp.status == 204 else " — có thể bị captive portal"))
    except Exception as e:  # noqa: BLE001
        http_ok = chk(False, "Truy cập web (HTTP)", str(e))
    lines.append("")
    if all([has_if, gw_ok, dns_ok, inet_ok, http_ok]):
        lines.append("Kết luận: kết nối hoạt động bình thường, không phát hiện sự cố.")
    elif not has_if or not gw_ok:
        lines.append("Kết luận: sự cố trong mạng nội bộ (Wi-Fi/LAN/router). Thử kết nối lại Wi-Fi hoặc khởi động lại router.")
    elif not inet_ok and not http_ok:
        lines.append("Kết luận: router hoạt động nhưng không ra được Internet — khả năng sự cố phía nhà mạng.")
    elif not dns_ok:
        lines.append("Kết luận: Internet có nhưng DNS lỗi. Thử 'Xoá cache DNS' hoặc đổi DNS sang 1.1.1.1 / 8.8.8.8.")
    else:
        lines.append("Kết luận: kết nối một phần — có thể bị chặn ICMP hoặc cần đăng nhập captive portal.")
    return "\n".join(lines)


# ====================================================================== multi-target ping
def ping_targets(collector) -> list[dict]:
    p = collector.net.get("primary") or {}
    targets = []
    if p.get("gateway"):
        targets.append(("Gateway", p["gateway"]))
    for d in (p.get("dns") or [])[:1]:
        if d != p.get("gateway") and d not in ("1.1.1.1", "8.8.8.8"):
            targets.append(("DNS chính", d))
    targets += [("Cloudflare DNS", "1.1.1.1"), ("Google DNS", "8.8.8.8")]

    def probe(t):
        name, host = t
        rtts, lost = [], 0
        for _ in range(4):
            r = icmp.ping(host, 1000)
            if r["ok"]:
                rtts.append(r["rtt"])
            else:
                lost += 1
            time.sleep(0.15)
        jit = statistics.fmean(abs(a - b) for a, b in zip(rtts, rtts[1:])) if len(rtts) > 1 else 0
        return {"name": name, "host": host, "ping": round(statistics.fmean(rtts), 1) if rtts else None,
                "jitter": round(jit, 1), "loss": round(lost * 100 / 4)}

    return list(_pool.map(probe, targets))
