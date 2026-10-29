"""python -m server — запускает сайт и API AMANOGAWA."""

import asyncio
import logging
import os
import socket
from pathlib import Path

import uvicorn
from dotenv import load_dotenv


def listen_socket(host, port):
    """Reserve the actual port before opening the browser (no bind/check race)."""
    if host not in {"127.0.0.1", "localhost", "::1"}:
        raise ValueError("HOST должен указывать на этот компьютер (127.0.0.1, localhost или ::1)")
    if not 0 <= port <= 65535:
        raise ValueError("PORT должен быть от 0 до 65535")
    family = socket.AF_INET6 if host == "::1" else socket.AF_INET
    try:
        return socket.create_server((host, port), family=family)
    except OSError as exc:
        if exc.errno not in {98, 48, 10048} and getattr(exc, "winerror", None) != 10048:
            raise
        return socket.create_server((host, 0), family=family)


def main():
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8000"))
    if os.name == "nt":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    with listen_socket(host, port) as sock:
        os.environ["PORT"] = str(sock.getsockname()[1])
        os.environ["HOST"] = host
        display_host = f"[{host}]" if ":" in host else host
        print(f"AMANOGAWA: http://{display_host}:{os.environ['PORT']}/", flush=True)
        server = uvicorn.Server(uvicorn.Config("server.app:app", host=host,
                                               port=int(os.environ["PORT"]), log_level="info"))
        server.run(sockets=[sock])


if __name__ == "__main__":
    main()

