"""Small shared helpers: subprocess flags, console decoding, admin check."""
from __future__ import annotations

import ctypes
import subprocess

CREATE_NO_WINDOW = 0x08000000  # no console flash when running under pythonw


def oem_encoding() -> str:
    """Console programs (ipconfig, netsh) write in the OEM code page."""
    try:
        return f"cp{ctypes.windll.kernel32.GetOEMCP()}"
    except Exception:  # noqa: BLE001
        return "utf-8"


def run_cmd(args: list[str], timeout: int = 60) -> tuple[int, str]:
    p = subprocess.run(args, capture_output=True, timeout=timeout, creationflags=CREATE_NO_WINDOW)
    text = (p.stdout + p.stderr).decode(oem_encoding(), errors="replace").replace("\r\n", "\n")
    return p.returncode, text.strip()


def is_admin() -> bool:
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:  # noqa: BLE001
        return False
