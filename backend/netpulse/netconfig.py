"""Network configuration snapshot (adapters, IP, DNS, gateway, DHCP) via PowerShell → JSON.

PowerShell is slow to start (~1 s), so callers cache the snapshot and refresh it
periodically; JSON output keeps the parsing independent of the Windows UI language.
"""
from __future__ import annotations

import json
import logging
import subprocess

from .util import CREATE_NO_WINDOW

log = logging.getLogger("netpulse.netconfig")

_PS = r"""
$ErrorActionPreference = 'SilentlyContinue'
$ad = @(Get-NetAdapter | Select-Object Name, InterfaceDescription, InterfaceGuid, ifIndex, Status, MacAddress,
    MediaType, PhysicalMediaType, DriverVersion, DriverProvider, Virtual, HardwareInterface,
    @{n='Speed';e={[uint64]$_.Speed}}, @{n='MtuSize';e={$_.MtuSize}})
$cfg = @(Get-CimInstance Win32_NetworkAdapterConfiguration -Filter 'IPEnabled=TRUE' | Select-Object InterfaceIndex,
    IPAddress, IPSubnet, DefaultIPGateway, DNSServerSearchOrder, DHCPEnabled, DHCPServer, DNSDomain,
    @{n='LeaseObtained';e={if($_.DHCPLeaseObtained){([DateTimeOffset]$_.DHCPLeaseObtained).ToUnixTimeSeconds()}}},
    @{n='LeaseExpires';e={if($_.DHCPLeaseExpires){([DateTimeOffset]$_.DHCPLeaseExpires).ToUnixTimeSeconds()}}})
$routes = @(Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Select-Object ifIndex, NextHop, RouteMetric,
    @{n='IfMetric';e={(Get-NetIPInterface -InterfaceIndex $_.ifIndex -AddressFamily IPv4).InterfaceMetric}})
$wlanConn = $null
$ev = Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-WLAN-AutoConfig/Operational'; Id=8001} -MaxEvents 1
if ($ev) { $wlanConn = ([DateTimeOffset]$ev.TimeCreated).ToUnixTimeSeconds() }
[pscustomobject]@{ host = $env:COMPUTERNAME; adapters = $ad; configs = $cfg; routes = $routes; wlanConnectedAt = $wlanConn } |
    ConvertTo-Json -Depth 4 -Compress
"""


def _as_list(v):
    if v is None:
        return []
    return v if isinstance(v, list) else [v]


def snapshot() -> dict:
    """Run the PowerShell query and return a normalized structure.

    {
      host, wlanConnectedAt,
      adapters: [{name, desc, guid, ifIndex, status, mac, media, physMedia, driver, virtual, hardware, speed, mtu}],
      primary: {ifIndex, name, ipv4, subnet, gateway, dns[], ipv6[], dhcp, dhcpServer, leaseObtained, leaseExpires, domain} | None
    }
    """
    try:
        out = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", _PS],
            capture_output=True, timeout=30, creationflags=CREATE_NO_WINDOW,
        )
        data = json.loads(out.stdout.decode("utf-8", errors="replace") or "{}")
    except Exception as e:  # noqa: BLE001 — a failed snapshot must not kill the agent
        log.warning("network snapshot failed: %s", e)
        return {"host": None, "adapters": [], "primary": None, "configs": {}, "wlanConnectedAt": None}

    adapters = []
    for a in _as_list(data.get("adapters")):
        adapters.append({
            "name": a.get("Name"), "desc": a.get("InterfaceDescription"),
            "guid": (a.get("InterfaceGuid") or "").strip("{}").lower(), "ifIndex": a.get("ifIndex"),
            "status": a.get("Status"), "mac": a.get("MacAddress"), "media": a.get("MediaType"),
            "physMedia": a.get("PhysicalMediaType"), "driver": a.get("DriverVersion"),
            "driverProvider": a.get("DriverProvider"), "virtual": bool(a.get("Virtual")),
            "hardware": bool(a.get("HardwareInterface")), "speed": int(a.get("Speed") or 0), "mtu": a.get("MtuSize"),
        })

    configs = {}
    for c in _as_list(data.get("configs")):
        ips = _as_list(c.get("IPAddress"))
        subs = _as_list(c.get("IPSubnet"))
        v4 = [(ip, subs[i] if i < len(subs) else None) for i, ip in enumerate(ips) if ":" not in ip]
        v6 = [ip for ip in ips if ":" in ip]
        gws = [g for g in _as_list(c.get("DefaultIPGateway")) if ":" not in g]
        configs[c.get("InterfaceIndex")] = {
            "ifIndex": c.get("InterfaceIndex"),
            "ipv4": v4[0][0] if v4 else None, "subnet": v4[0][1] if v4 else None,
            "gateway": gws[0] if gws else None,
            "dns": _as_list(c.get("DNSServerSearchOrder")), "ipv6": v6,
            "dhcp": bool(c.get("DHCPEnabled")), "dhcpServer": c.get("DHCPServer"),
            "leaseObtained": c.get("LeaseObtained"), "leaseExpires": c.get("LeaseExpires"),
            "domain": c.get("DNSDomain"),
        }

    # Primary interface = default route with the lowest effective metric on an "Up" adapter.
    up = {a["ifIndex"] for a in adapters if a["status"] == "Up"}
    routes = sorted(
        (r for r in _as_list(data.get("routes")) if r.get("ifIndex") in up),
        key=lambda r: (r.get("RouteMetric") or 0) + (r.get("IfMetric") or 0),
    )
    primary = None
    if routes:
        idx = routes[0]["ifIndex"]
        ad = next((a for a in adapters if a["ifIndex"] == idx), None)
        primary = {**configs.get(idx, {"ifIndex": idx}), "name": ad["name"] if ad else None}
        if not primary.get("gateway"):
            primary["gateway"] = routes[0].get("NextHop")

    return {
        "host": data.get("host"), "adapters": adapters, "configs": configs,
        "primary": primary, "wlanConnectedAt": data.get("wlanConnectedAt"),
    }
