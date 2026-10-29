"""python -m server — запускает сайт и API AMANOGAWA."""

import logging
import os

import uvicorn
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

host = os.getenv("HOST", "127.0.0.1")
port = int(os.getenv("PORT", "8000"))
uvicorn.run("server.app:app", host=host, port=port, log_level="warning")
