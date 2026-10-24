"""Paths and persisted settings. Everything lives inside the OPT_WIFI folder."""
from __future__ import annotations

import json
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]          # …/OPT_WIFI
FRONTEND_DIR = ROOT / "frontend"
DATA_DIR = ROOT / "data"
DB_PATH = DATA_DIR / "netpulse.db"
SETTINGS_PATH = DATA_DIR / "settings.json"
LOG_DIR = DATA_DIR / "logs"
TMP_DIR = DATA_DIR / "tmp"

VERSION = "1.0.0"
HOST = "127.0.0.1"
PORT = 8765

for _d in (DATA_DIR, LOG_DIR, TMP_DIR):
    _d.mkdir(parents=True, exist_ok=True)

DEFAULTS: dict = {
    "refreshMs": 1000,
    "unit": "bits",
    "theme": "dark",
    "accent": "cyan",
    "pingTarget": "1.1.1.1",
    "pingWarn": 80,
    "pingCrit": 150,
    "lossWarn": 1.0,
    "signalWarn": 50,
    "monthlyCapGB": 0,
    "planDownMbps": 0,
    "planUpMbps": 0,
    "retentionDays": 90,
    "notify": True,
    "autoSpeedtest": "off",       # off | 6h | daily
    "publicIpLookup": True,
    "animations": True,
    "lang": "vi",                 # UI language: vi | en
}

# validation: key -> (type, min, max) or allowed set
_RULES = {
    "refreshMs": (int, 500, 10000),
    "pingWarn": (float, 5, 2000),
    "pingCrit": (float, 10, 5000),
    "lossWarn": (float, 0.1, 100),
    "signalWarn": (int, 1, 99),
    "monthlyCapGB": (float, 0, 1_000_000),
    "planDownMbps": (float, 0, 100_000),
    "planUpMbps": (float, 0, 100_000),
    "retentionDays": (int, 1, 3650),
    "unit": {"bits", "bytes"},
    "theme": {"dark", "light"},
    "accent": {"cyan", "violet", "emerald", "pink"},
    "autoSpeedtest": {"off", "6h", "daily"},
    "lang": {"vi", "en"},
}


class Settings:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._data = dict(DEFAULTS)
        if SETTINGS_PATH.exists():
            try:
                self._data.update(self._validate(json.loads(SETTINGS_PATH.read_text("utf-8"))))
            except Exception:  # noqa: BLE001 — a corrupt file falls back to defaults
                pass

    def __getitem__(self, k: str):
        return self._data[k]

    def all(self) -> dict:
        with self._lock:
            return dict(self._data)

    @staticmethod
    def _validate(patch: dict) -> dict:
        clean = {}
        for k, v in patch.items():
            if k not in DEFAULTS:
                continue
            rule = _RULES.get(k)
            try:
                if isinstance(rule, set):
                    if v not in rule:
                        continue
                elif isinstance(rule, tuple):
                    t, lo, hi = rule
                    v = max(lo, min(hi, t(v)))
                elif isinstance(DEFAULTS[k], bool):
                    v = bool(v)
                elif k == "pingTarget":
                    v = str(v).strip()[:253]
                    if not v:
                        continue
            except (TypeError, ValueError):
                continue
            clean[k] = v
        return clean

    def update(self, patch: dict) -> dict:
        with self._lock:
            self._data.update(self._validate(patch))
            tmp = SETTINGS_PATH.with_suffix(".tmp")
            tmp.write_text(json.dumps(self._data, indent=2, ensure_ascii=False), "utf-8")
            tmp.replace(SETTINGS_PATH)
            return dict(self._data)

    def reset(self) -> dict:
        with self._lock:
            self._data = dict(DEFAULTS)
            SETTINGS_PATH.unlink(missing_ok=True)
            return dict(self._data)


settings = Settings()
