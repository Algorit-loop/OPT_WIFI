"""ICMP echo via iphlpapi.IcmpSendEcho — no admin rights, no locale-dependent parsing."""
from __future__ import annotations

import ctypes
import socket
import time
from ctypes import wintypes

_iphlp = ctypes.WinDLL("iphlpapi", use_last_error=True)

IP_SUCCESS = 0
IP_DEST_NET_UNREACHABLE = 11002
IP_DEST_HOST_UNREACHABLE = 11003
IP_REQ_TIMED_OUT = 11010
IP_TTL_EXPIRED_TRANSIT = 11013
IP_GENERAL_FAILURE = 11050

STATUS_TEXT = {
    IP_DEST_NET_UNREACHABLE: "Destination net unreachable.",
    IP_DEST_HOST_UNREACHABLE: "Destination host unreachable.",
    IP_REQ_TIMED_OUT: "Request timed out.",
    IP_TTL_EXPIRED_TRANSIT: "TTL expired in transit.",
    IP_GENERAL_FAILURE: "General failure.",
}


class IP_OPTION_INFORMATION(ctypes.Structure):
    _fields_ = [
        ("Ttl", ctypes.c_ubyte),
        ("Tos", ctypes.c_ubyte),
        ("Flags", ctypes.c_ubyte),
        ("OptionsSize", ctypes.c_ubyte),
        ("OptionsData", ctypes.c_void_p),
    ]


class ICMP_ECHO_REPLY(ctypes.Structure):
    _fields_ = [
        ("Address", wintypes.ULONG),
        ("Status", wintypes.ULONG),
        ("RoundTripTime", wintypes.ULONG),
        ("DataSize", wintypes.USHORT),
        ("Reserved", wintypes.USHORT),
        ("Data", ctypes.c_void_p),
        ("Options", IP_OPTION_INFORMATION),
    ]


_iphlp.IcmpCreateFile.restype = wintypes.HANDLE
_iphlp.IcmpCloseHandle.argtypes = [wintypes.HANDLE]
_iphlp.IcmpSendEcho.argtypes = [
    wintypes.HANDLE, wintypes.ULONG, ctypes.c_void_p, wintypes.WORD,
    ctypes.POINTER(IP_OPTION_INFORMATION), ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD,
]
_iphlp.IcmpSendEcho.restype = wintypes.DWORD

_PAYLOAD = b"NetPulse-ping-32-bytes-payload!!"  # 32 bytes, like Windows ping


def resolve(host: str) -> str:
    """Resolve a host name to an IPv4 address (raises socket.gaierror)."""
    return socket.getaddrinfo(host, None, socket.AF_INET)[0][4][0]


def ping(ip: str, timeout_ms: int = 1000, ttl: int = 128) -> dict:
    """Send one echo request.

    Returns {ok, status, rtt (ms float|None), addr (replying address), ttl}.
    `addr` differs from `ip` when a router answers (TTL expired / unreachable).
    """
    handle = _iphlp.IcmpCreateFile()
    if handle in (None, wintypes.HANDLE(-1).value):
        raise OSError(ctypes.get_last_error(), "IcmpCreateFile failed")
    try:
        dest = int.from_bytes(socket.inet_aton(ip), "little")
        opts = IP_OPTION_INFORMATION(Ttl=ttl)
        buf_size = ctypes.sizeof(ICMP_ECHO_REPLY) + len(_PAYLOAD) + 64
        buf = ctypes.create_string_buffer(buf_size)
        t0 = time.perf_counter()
        n = _iphlp.IcmpSendEcho(handle, dest, _PAYLOAD, len(_PAYLOAD), ctypes.byref(opts), buf, buf_size, timeout_ms)
        elapsed = (time.perf_counter() - t0) * 1000
        if n == 0:
            status = ctypes.get_last_error() or IP_REQ_TIMED_OUT
            return {"ok": False, "status": status, "rtt": None, "addr": None, "ttl": None}
        reply = ICMP_ECHO_REPLY.from_buffer(buf)
        addr = socket.inet_ntoa(reply.Address.to_bytes(4, "little"))
        # RoundTripTime is integer ms; the wall-clock measurement gives sub-ms precision
        # for fast hops (it includes a few µs of API overhead).
        rtt = min(elapsed, reply.RoundTripTime + 1.0) if reply.RoundTripTime <= 1 else float(reply.RoundTripTime)
        return {
            "ok": reply.Status == IP_SUCCESS,
            "status": reply.Status,
            "rtt": round(rtt, 2),
            "addr": addr,
            "ttl": reply.Options.Ttl,
        }
    finally:
        _iphlp.IcmpCloseHandle(handle)


def status_text(status: int) -> str:
    return STATUS_TEXT.get(status, f"Error {status}.")
