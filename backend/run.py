"""Entry point: python backend/run.py [--port 8765] [--no-browser]"""
from __future__ import annotations

import argparse
import logging
import logging.handlers
import socket
import sys
import webbrowser
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from netpulse.config import HOST, LOG_DIR, PORT  # noqa: E402


def _port_busy(port: int) -> bool:
    with socket.socket() as s:
        s.settimeout(0.5)
        return s.connect_ex((HOST, port)) == 0


def main() -> None:
    ap = argparse.ArgumentParser(description="NetPulse local network monitor")
    ap.add_argument("--port", type=int, default=PORT)
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()
    url = f"http://{HOST}:{args.port}/"
    if sys.stdout is None:  # pythonw: no console
        sys.stdout = sys.stderr = open(LOG_DIR / "console.log", "a", encoding="utf-8", buffering=1)
    else:
        for s in (sys.stdout, sys.stderr):
            try:
                s.reconfigure(encoding="utf-8", errors="replace")
            except (AttributeError, ValueError):
                pass

    handlers: list[logging.Handler] = [
        logging.handlers.RotatingFileHandler(LOG_DIR / "agent.log", maxBytes=2_000_000, backupCount=3, encoding="utf-8")
    ]
    if sys.stdout and sys.stdout.isatty():
        handlers.append(logging.StreamHandler())
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s", handlers=handlers)

    if _port_busy(args.port):
        print(f"NetPulse đã chạy sẵn tại {url}")
        if not args.no_browser:
            webbrowser.open(url)
        return

    import uvicorn

    if not args.no_browser:
        import threading
        threading.Timer(1.5, lambda: webbrowser.open(url)).start()
    print(f"NetPulse agent: {url}  (Ctrl+C để dừng)")
    from netpulse import main as app_module

    server = uvicorn.Server(uvicorn.Config(app_module.app, host=HOST, port=args.port, log_level="warning",
                                           access_log=False, log_config=None))
    app_module.SERVER = server
    server.run()


if __name__ == "__main__":
    main()
