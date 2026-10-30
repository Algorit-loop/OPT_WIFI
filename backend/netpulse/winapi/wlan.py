"""Windows Native WiFi API (wlanapi.dll) via ctypes.

Locale-independent replacement for parsing `netsh wlan show ...`.
On Windows 11 24H2+, SSID/BSSID/scan data require Location permission for desktop
apps; when it is missing the API returns ERROR_ACCESS_DENIED and we report
`locationBlocked` instead of failing.
"""
from __future__ import annotations

import ctypes
import threading
import uuid
from ctypes import wintypes

_wlan = ctypes.WinDLL("wlanapi", use_last_error=True)

ERROR_SUCCESS = 0
ERROR_ACCESS_DENIED = 5
ERROR_INVALID_STATE = 5023
ERROR_NOT_FOUND = 1168

OPCODE_CURRENT_CONNECTION = 7
OPCODE_CHANNEL_NUMBER = 8
OPCODE_RSSI = 0x10000102

DOT11_BSS_TYPE_ANY = 3

IF_STATE = {
    0: "not_ready", 1: "connected", 2: "ad_hoc_formed", 3: "disconnecting",
    4: "disconnected", 5: "associating", 6: "discovering", 7: "authenticating",
}
PHY = {
    1: ("FHSS", "802.11"), 2: ("DSSS", "802.11"), 3: ("IR", "802.11"),
    4: ("Wi-Fi 2 (802.11a)", "802.11a"), 5: ("Wi-Fi 1 (802.11b)", "802.11b"),
    6: ("Wi-Fi 3 (802.11g)", "802.11g"), 7: ("Wi-Fi 4 (802.11n)", "802.11n"),
    8: ("Wi-Fi 5 (802.11ac)", "802.11ac"), 9: ("WiGig (802.11ad)", "802.11ad"),
    10: ("Wi-Fi 6 (802.11ax)", "802.11ax"), 11: ("Wi-Fi 7 (802.11be)", "802.11be"),
}
AUTH = {
    1: "Open", 2: "Shared Key", 3: "WPA-Enterprise", 4: "WPA-Personal", 5: "WPA-None",
    6: "WPA2-Enterprise", 7: "WPA2-Personal", 8: "WPA3-Enterprise 192", 9: "WPA3-Personal",
    10: "OWE", 11: "WPA3-Enterprise",
}
CIPHER = {
    0: "None", 1: "WEP-40", 2: "TKIP", 4: "CCMP (AES)", 5: "WEP-104", 6: "BIP",
    8: "GCMP", 9: "GCMP-256", 10: "CCMP-256", 0x100: "Group", 0x101: "WEP",
}
CONN_MODE = {0: "Profile", 1: "Temporary profile", 2: "Discovery (secure)", 3: "Discovery (unsecure)", 4: "Auto", 5: "Invalid"}


class GUID(ctypes.Structure):
    _fields_ = [("Data1", wintypes.DWORD), ("Data2", wintypes.WORD), ("Data3", wintypes.WORD), ("Data4", ctypes.c_ubyte * 8)]

    def __str__(self) -> str:
        return str(uuid.UUID(bytes_le=bytes(self)))


class DOT11_SSID(ctypes.Structure):
    _fields_ = [("uSSIDLength", wintypes.ULONG), ("ucSSID", ctypes.c_ubyte * 32)]

    def text(self) -> str:
        raw = bytes(self.ucSSID[: self.uSSIDLength])
        return raw.decode("utf-8", errors="replace")


class WLAN_INTERFACE_INFO(ctypes.Structure):
    _fields_ = [("InterfaceGuid", GUID), ("strInterfaceDescription", ctypes.c_wchar * 256), ("isState", ctypes.c_int)]


class WLAN_INTERFACE_INFO_LIST(ctypes.Structure):
    _fields_ = [("dwNumberOfItems", wintypes.DWORD), ("dwIndex", wintypes.DWORD), ("InterfaceInfo", WLAN_INTERFACE_INFO * 1)]


class WLAN_ASSOCIATION_ATTRIBUTES(ctypes.Structure):
    _fields_ = [
        ("dot11Ssid", DOT11_SSID), ("dot11BssType", ctypes.c_int), ("dot11Bssid", ctypes.c_ubyte * 6),
        ("dot11PhyType", ctypes.c_int), ("uDot11PhyIndex", wintypes.ULONG), ("wlanSignalQuality", wintypes.ULONG),
        ("ulRxRate", wintypes.ULONG), ("ulTxRate", wintypes.ULONG),
    ]


class WLAN_SECURITY_ATTRIBUTES(ctypes.Structure):
    _fields_ = [("bSecurityEnabled", wintypes.BOOL), ("bOneXEnabled", wintypes.BOOL), ("dot11AuthAlgorithm", ctypes.c_int), ("dot11CipherAlgorithm", ctypes.c_int)]


class WLAN_CONNECTION_ATTRIBUTES(ctypes.Structure):
    _fields_ = [
        ("isState", ctypes.c_int), ("wlanConnectionMode", ctypes.c_int), ("strProfileName", ctypes.c_wchar * 256),
        ("wlanAssociationAttributes", WLAN_ASSOCIATION_ATTRIBUTES), ("wlanSecurityAttributes", WLAN_SECURITY_ATTRIBUTES),
    ]


class WLAN_RATE_SET(ctypes.Structure):
    _fields_ = [("uRateSetLength", wintypes.ULONG), ("usRateSet", wintypes.USHORT * 126)]


class WLAN_BSS_ENTRY(ctypes.Structure):
    _fields_ = [
        ("dot11Ssid", DOT11_SSID), ("uPhyId", wintypes.ULONG), ("dot11Bssid", ctypes.c_ubyte * 6),
        ("dot11BssType", ctypes.c_int), ("dot11BssPhyType", ctypes.c_int), ("lRssi", wintypes.LONG),
        ("uLinkQuality", wintypes.ULONG), ("bInRegDomain", ctypes.c_ubyte), ("usBeaconPeriod", wintypes.USHORT),
        ("ullTimestamp", ctypes.c_ulonglong), ("ullHostTimestamp", ctypes.c_ulonglong),
        ("usCapabilityInformation", wintypes.USHORT), ("ulChCenterFrequency", wintypes.ULONG),
        ("wlanRateSet", WLAN_RATE_SET), ("ulIeOffset", wintypes.ULONG), ("ulIeSize", wintypes.ULONG),
    ]


class WLAN_BSS_LIST(ctypes.Structure):
    _fields_ = [("dwTotalSize", wintypes.DWORD), ("dwNumberOfItems", wintypes.DWORD), ("wlanBssEntries", WLAN_BSS_ENTRY * 1)]


class WLAN_AVAILABLE_NETWORK(ctypes.Structure):
    _fields_ = [
        ("strProfileName", ctypes.c_wchar * 256), ("dot11Ssid", DOT11_SSID), ("dot11BssType", ctypes.c_int),
        ("uNumberOfBssids", wintypes.ULONG), ("bNetworkConnectable", wintypes.BOOL), ("wlanNotConnectableReason", wintypes.DWORD),
        ("uNumberOfPhyTypes", wintypes.ULONG), ("dot11PhyTypes", ctypes.c_int * 8), ("bMorePhyTypes", wintypes.BOOL),
        ("wlanSignalQuality", wintypes.ULONG), ("bSecurityEnabled", wintypes.BOOL),
        ("dot11DefaultAuthAlgorithm", ctypes.c_int), ("dot11DefaultCipherAlgorithm", ctypes.c_int),
        ("dwFlags", wintypes.DWORD), ("dwReserved", wintypes.DWORD),
    ]


class WLAN_AVAILABLE_NETWORK_LIST(ctypes.Structure):
    _fields_ = [("dwNumberOfItems", wintypes.DWORD), ("dwIndex", wintypes.DWORD), ("Network", WLAN_AVAILABLE_NETWORK * 1)]


class WLAN_CONNECTION_PARAMETERS(ctypes.Structure):
    _fields_ = [
        ("wlanConnectionMode", ctypes.c_int), ("strProfile", wintypes.LPCWSTR), ("pDot11Ssid", ctypes.POINTER(DOT11_SSID)),
        ("pDesiredBssidList", ctypes.c_void_p), ("dot11BssType", ctypes.c_int), ("dwFlags", wintypes.DWORD),
    ]


class DOT11_BSSID_LIST(ctypes.Structure):
    """NDIS_OBJECT_HEADER (Type, Revision, Size) + counts + a one-entry MAC array."""
    _fields_ = [
        ("Type", ctypes.c_ubyte), ("Revision", ctypes.c_ubyte), ("Size", ctypes.c_ushort),
        ("uNumOfEntries", wintypes.ULONG), ("uTotalNumOfEntries", wintypes.ULONG), ("BSSIDs", (ctypes.c_ubyte * 6) * 1),
    ]


NDIS_OBJECT_TYPE_DEFAULT = 0x80
DOT11_BSSID_LIST_REVISION_1 = 1
AVAILABLE_NETWORK_CONNECTED = 0x1
AVAILABLE_NETWORK_HAS_PROFILE = 0x2
CONNECTION_MODE_PROFILE = 0
DOT11_BSS_TYPE_INFRASTRUCTURE = 1


_wlan.WlanOpenHandle.argtypes = [wintypes.DWORD, ctypes.c_void_p, ctypes.POINTER(wintypes.DWORD), ctypes.POINTER(wintypes.HANDLE)]
_wlan.WlanCloseHandle.argtypes = [wintypes.HANDLE, ctypes.c_void_p]
_wlan.WlanEnumInterfaces.argtypes = [wintypes.HANDLE, ctypes.c_void_p, ctypes.POINTER(ctypes.POINTER(WLAN_INTERFACE_INFO_LIST))]
_wlan.WlanQueryInterface.argtypes = [
    wintypes.HANDLE, ctypes.POINTER(GUID), ctypes.c_int, ctypes.c_void_p,
    ctypes.POINTER(wintypes.DWORD), ctypes.POINTER(ctypes.c_void_p), ctypes.POINTER(ctypes.c_int),
]
_wlan.WlanGetNetworkBssList.argtypes = [
    wintypes.HANDLE, ctypes.POINTER(GUID), ctypes.c_void_p, ctypes.c_int, wintypes.BOOL,
    ctypes.c_void_p, ctypes.POINTER(ctypes.POINTER(WLAN_BSS_LIST)),
]
_wlan.WlanScan.argtypes = [wintypes.HANDLE, ctypes.POINTER(GUID), ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p]
_wlan.WlanGetAvailableNetworkList.argtypes = [
    wintypes.HANDLE, ctypes.POINTER(GUID), wintypes.DWORD, ctypes.c_void_p, ctypes.POINTER(ctypes.POINTER(WLAN_AVAILABLE_NETWORK_LIST)),
]
_wlan.WlanSetProfile.argtypes = [
    wintypes.HANDLE, ctypes.POINTER(GUID), wintypes.DWORD, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.BOOL,
    ctypes.c_void_p, ctypes.POINTER(wintypes.DWORD),
]
_wlan.WlanDeleteProfile.argtypes = [wintypes.HANDLE, ctypes.POINTER(GUID), wintypes.LPCWSTR, ctypes.c_void_p]
_wlan.WlanConnect.argtypes = [wintypes.HANDLE, ctypes.POINTER(GUID), ctypes.POINTER(WLAN_CONNECTION_PARAMETERS), ctypes.c_void_p]
_wlan.WlanFreeMemory.argtypes = [ctypes.c_void_p]
for _f in ("WlanOpenHandle", "WlanCloseHandle", "WlanEnumInterfaces", "WlanQueryInterface", "WlanGetNetworkBssList", "WlanScan",
           "WlanGetAvailableNetworkList", "WlanSetProfile", "WlanDeleteProfile", "WlanConnect"):
    getattr(_wlan, _f).restype = wintypes.DWORD


class WlanError(OSError):
    pass


def _mac(b) -> str:
    return ":".join(f"{x:02x}" for x in bytes(b))


def freq_to_band_channel(khz: int) -> tuple[str | None, int | None]:
    mhz = khz // 1000
    if 2400 <= mhz <= 2500:
        return "2.4 GHz", 14 if mhz == 2484 else (mhz - 2407) // 5
    if 4900 <= mhz < 5925:
        return "5 GHz", (mhz - 5000) // 5
    if 5925 <= mhz <= 7125:
        return "6 GHz", (mhz - 5950) // 5
    return None, None


def channel_to_band(ch: int) -> str | None:
    if 1 <= ch <= 14:
        return "2.4 GHz"
    if 32 <= ch <= 177:
        return "5 GHz"
    return None


def parse_ies(data: bytes, privacy: bool) -> dict:
    """Extract security, max standard and channel width from 802.11 Information Elements."""
    info = {"security": "Open" if not privacy else "WEP", "apStandard": None, "width": 20}
    ht = vht = he = eht = False
    akms: list[int] = []
    wpa1 = False
    i = 0
    while i + 2 <= len(data):
        eid, ln = data[i], data[i + 1]
        body = data[i + 2: i + 2 + ln]
        i += 2 + ln
        if eid == 45:
            ht = True
        elif eid == 61 and len(body) >= 2:  # HT Operation
            if body[1] & 0x04:
                info["width"] = max(info["width"], 40)
        elif eid == 191:
            vht = True
        elif eid == 192 and len(body) >= 3:  # VHT Operation
            w, c0, c1 = body[0], body[1], body[2]
            if w == 1:
                info["width"] = max(info["width"], 160 if (c1 and abs(c1 - c0) == 8) else 80)
            elif w in (2, 3):
                info["width"] = 160
        elif eid == 48 and len(body) >= 8:  # RSN
            try:
                n_pair = int.from_bytes(body[6:8], "little")
                off = 8 + 4 * n_pair
                n_akm = int.from_bytes(body[off: off + 2], "little")
                for k in range(n_akm):
                    s = body[off + 2 + 4 * k: off + 6 + 4 * k]
                    if s[:3] == b"\x00\x0f\xac":
                        akms.append(s[3])
            except Exception:
                pass
        elif eid == 221 and body[:4] == b"\x00\x50\xf2\x01":
            wpa1 = True
        elif eid == 255 and body:
            ext = body[0]
            if ext == 35:
                he = True
            elif ext == 36 and len(body) >= 7:  # HE Operation, 6 GHz info present?
                params = int.from_bytes(body[1:4], "little")
                if params & (1 << 17):  # 6 GHz Operation Information Present
                    off = 7 + (3 if params & (1 << 14) else 0) + (1 if params & (1 << 15) else 0)
                    if len(body) > off + 1:
                        info["width"] = max(info["width"], {0: 20, 1: 40, 2: 80, 3: 160}.get(body[off + 1] & 0x03, 20))
            elif ext in (106, 108):
                eht = True
    if akms:
        if 8 in akms or 24 in akms:
            info["security"] = "WPA3-Personal" + ("/WPA2" if 2 in akms else "")
        elif 2 in akms or 6 in akms:
            info["security"] = "WPA2-Personal"
        elif 18 in akms:
            info["security"] = "OWE"
        elif 1 in akms or 5 in akms or 12 in akms:
            info["security"] = "WPA2-Enterprise"
        else:
            info["security"] = "WPA2"
    elif wpa1:
        info["security"] = "WPA-Personal"
    info["apStandard"] = (
        "Wi-Fi 7 (802.11be)" if eht else "Wi-Fi 6 (802.11ax)" if he else "Wi-Fi 5 (802.11ac)" if vht
        else "Wi-Fi 4 (802.11n)" if ht else None
    )
    return info


class Wlan:
    """Thread-safe wrapper holding one client handle."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._h = wintypes.HANDLE()
        ver = wintypes.DWORD()
        rc = _wlan.WlanOpenHandle(2, None, ctypes.byref(ver), ctypes.byref(self._h))
        if rc != ERROR_SUCCESS:
            raise WlanError(rc, f"WlanOpenHandle failed ({rc}) — WLAN AutoConfig service may be stopped")

    def close(self) -> None:
        if self._h:
            _wlan.WlanCloseHandle(self._h, None)
            self._h = wintypes.HANDLE()

    def interfaces(self) -> list[dict]:
        with self._lock:
            p = ctypes.POINTER(WLAN_INTERFACE_INFO_LIST)()
            rc = _wlan.WlanEnumInterfaces(self._h, None, ctypes.byref(p))
            if rc != ERROR_SUCCESS:
                raise WlanError(rc, f"WlanEnumInterfaces failed ({rc})")
            try:
                n = p.contents.dwNumberOfItems
                arr = ctypes.cast(ctypes.addressof(p.contents.InterfaceInfo), ctypes.POINTER(WLAN_INTERFACE_INFO * n)).contents
                return [{"guid": str(it.InterfaceGuid), "_guid": GUID.from_buffer_copy(it.InterfaceGuid),
                         "description": it.strInterfaceDescription, "state": IF_STATE.get(it.isState, str(it.isState))} for it in arr]
            finally:
                _wlan.WlanFreeMemory(p)

    def _query(self, guid: GUID, opcode: int):
        size = wintypes.DWORD()
        data = ctypes.c_void_p()
        rc = _wlan.WlanQueryInterface(self._h, ctypes.byref(guid), opcode, None, ctypes.byref(size), ctypes.byref(data), None)
        return rc, data

    def connection(self, guid: GUID) -> dict:
        """Current connection attributes; {'state': 'disconnected'} when not associated."""
        with self._lock:
            rc, data = self._query(guid, OPCODE_CURRENT_CONNECTION)
            if rc in (ERROR_INVALID_STATE, ERROR_NOT_FOUND):
                return {"state": "disconnected"}
            if rc == ERROR_ACCESS_DENIED:
                return {"state": "unknown", "locationBlocked": True}
            if rc != ERROR_SUCCESS:
                raise WlanError(rc, f"WlanQueryInterface(current_connection) failed ({rc})")
            try:
                c = ctypes.cast(data, ctypes.POINTER(WLAN_CONNECTION_ATTRIBUTES)).contents
                a, s = c.wlanAssociationAttributes, c.wlanSecurityAttributes
                std, radio = PHY.get(a.dot11PhyType, (None, None))
                out = {
                    "state": IF_STATE.get(c.isState, str(c.isState)),
                    "connectionMode": CONN_MODE.get(c.wlanConnectionMode, ""),
                    "profile": c.strProfileName,
                    "ssid": a.dot11Ssid.text(),
                    "bssid": _mac(a.dot11Bssid),
                    "phy": a.dot11PhyType,
                    "standard": std,
                    "radioType": radio,
                    "signal": int(a.wlanSignalQuality),
                    "rxRate": round(a.ulRxRate / 1000),
                    "txRate": round(a.ulTxRate / 1000),
                    "authentication": AUTH.get(s.dot11AuthAlgorithm, f"Auth {s.dot11AuthAlgorithm}"),
                    "cipher": CIPHER.get(s.dot11CipherAlgorithm, f"Cipher {s.dot11CipherAlgorithm}"),
                    "securityEnabled": bool(s.bSecurityEnabled),
                }
            finally:
                _wlan.WlanFreeMemory(data)
            # SSID empty but connected → privacy-filtered (location permission)
            if out["state"] == "connected" and not out["ssid"] and out["bssid"] == "00:00:00:00:00:00":
                out["locationBlocked"] = True
            for op, key in ((OPCODE_CHANNEL_NUMBER, "channel"), (OPCODE_RSSI, "rssi")):
                rc, d = self._query(guid, op)
                if rc == ERROR_SUCCESS:
                    try:
                        out[key] = ctypes.cast(d, ctypes.POINTER(ctypes.c_long)).contents.value
                    finally:
                        _wlan.WlanFreeMemory(d)
            return out

    def scan(self, guid: GUID) -> int:
        with self._lock:
            return _wlan.WlanScan(self._h, ctypes.byref(guid), None, None, None)

    def bss_list(self, guid: GUID) -> list[dict]:
        """Cached BSS list from the last scan (all visible access points)."""
        with self._lock:
            p = ctypes.POINTER(WLAN_BSS_LIST)()
            rc = _wlan.WlanGetNetworkBssList(self._h, ctypes.byref(guid), None, DOT11_BSS_TYPE_ANY, False, None, ctypes.byref(p))
            if rc == ERROR_ACCESS_DENIED:
                raise WlanError(rc, "location")
            if rc != ERROR_SUCCESS:
                raise WlanError(rc, f"WlanGetNetworkBssList failed ({rc})")
            try:
                n = p.contents.dwNumberOfItems
                base = ctypes.addressof(p.contents.wlanBssEntries)
                size = ctypes.sizeof(WLAN_BSS_ENTRY)
                out = []
                for k in range(n):
                    addr = base + k * size
                    e = WLAN_BSS_ENTRY.from_address(addr)
                    ies = ctypes.string_at(addr + e.ulIeOffset, e.ulIeSize) if e.ulIeSize else b""
                    band, ch = freq_to_band_channel(e.ulChCenterFrequency)
                    ie = parse_ies(ies, bool(e.usCapabilityInformation & 0x10))
                    std, radio = PHY.get(e.dot11BssPhyType, (None, None))
                    out.append({
                        "ssid": e.dot11Ssid.text(), "bssid": _mac(e.dot11Bssid), "rssi": int(e.lRssi),
                        "signal": int(e.uLinkQuality), "band": band, "channel": ch,
                        "frequency": e.ulChCenterFrequency // 1000, "security": ie["security"],
                        "standard": ie["apStandard"] or std, "radioType": radio, "width": ie["width"],
                    })
                return out
            finally:
                _wlan.WlanFreeMemory(p)

    def available_networks(self, guid: GUID) -> list[dict]:
        """One entry per SSID (and per saved profile matching it), as Windows' own network list sees them."""
        with self._lock:
            p = ctypes.POINTER(WLAN_AVAILABLE_NETWORK_LIST)()
            rc = _wlan.WlanGetAvailableNetworkList(self._h, ctypes.byref(guid), 0, None, ctypes.byref(p))
            if rc == ERROR_ACCESS_DENIED:
                raise WlanError(rc, "location")
            if rc != ERROR_SUCCESS:
                raise WlanError(rc, f"WlanGetAvailableNetworkList failed ({rc})")
            try:
                n = p.contents.dwNumberOfItems
                arr = ctypes.cast(ctypes.addressof(p.contents.Network), ctypes.POINTER(WLAN_AVAILABLE_NETWORK * n)).contents
                return [{
                    "ssid": x.dot11Ssid.text(), "profile": x.strProfileName or None,
                    "hasProfile": bool(x.dwFlags & AVAILABLE_NETWORK_HAS_PROFILE),
                    "connected": bool(x.dwFlags & AVAILABLE_NETWORK_CONNECTED),
                    "connectable": bool(x.bNetworkConnectable), "securityEnabled": bool(x.bSecurityEnabled),
                    "auth": x.dot11DefaultAuthAlgorithm, "cipher": x.dot11DefaultCipherAlgorithm,
                    "infrastructure": x.dot11BssType == DOT11_BSS_TYPE_INFRASTRUCTURE,
                } for x in arr]
            finally:
                _wlan.WlanFreeMemory(p)

    def set_profile(self, guid: GUID, xml: str) -> None:
        """Create or overwrite an all-user profile."""
        with self._lock:
            reason = wintypes.DWORD()
            rc = _wlan.WlanSetProfile(self._h, ctypes.byref(guid), 0, xml, None, True, None, ctypes.byref(reason))
            if rc != ERROR_SUCCESS:
                raise WlanError(rc, f"WlanSetProfile failed ({rc}, reason {reason.value})")

    def delete_profile(self, guid: GUID, name: str) -> None:
        with self._lock:
            _wlan.WlanDeleteProfile(self._h, ctypes.byref(guid), name, None)

    def connect(self, guid: GUID, profile: str, bssid: str | None = None) -> None:
        """Start connecting with a saved profile. Returns at once; the result shows up in connection().

        With `bssid` the connection prefers that access point. It is a preference, not a lock: if the
        access point cannot be reached Windows falls back to another one of the same network.
        """
        with self._lock:
            want = None
            if bssid:
                want = DOT11_BSSID_LIST(NDIS_OBJECT_TYPE_DEFAULT, DOT11_BSSID_LIST_REVISION_1, ctypes.sizeof(DOT11_BSSID_LIST), 1, 1)
                for i, b in enumerate(bytes.fromhex(bssid.replace(":", ""))):
                    want.BSSIDs[0][i] = b
            params = WLAN_CONNECTION_PARAMETERS(
                CONNECTION_MODE_PROFILE, profile, None, ctypes.addressof(want) if want else None, DOT11_BSS_TYPE_INFRASTRUCTURE, 0)
            rc = _wlan.WlanConnect(self._h, ctypes.byref(guid), ctypes.byref(params), None)
            if rc != ERROR_SUCCESS:
                raise WlanError(rc, f"WlanConnect failed ({rc})")
