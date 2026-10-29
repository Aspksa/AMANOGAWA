"""AMANOGAWA — сервер: сайт + база знаний на RAG-Anything с моделями Cloud.ru.

Запуск: python -m server   (из корня проекта; AMANOGAWA.BAT делает это сам)
"""

import asyncio
import base64
import logging
import os
import re
import threading
import time
import webbrowser
import uuid
from contextlib import asynccontextmanager
from functools import partial
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env", override=False)

from lightrag.llm.openai import openai_complete_if_cache, openai_embed  # noqa: E402
from lightrag.utils import EmbeddingFunc  # noqa: E402
from raganything import RAGAnything, RAGAnythingConfig  # noqa: E402
from raganything.image_signature import image_mime_type  # noqa: E402

log = logging.getLogger("amanogawa")

DATA = ROOT / "data"
INPUTS = DATA / "inputs"
STORAGE = DATA / "rag_storage"
OUTPUT = DATA / "output"

TEXT_EXT = {".txt", ".md", ".markdown"}
MAX_UPLOAD = 200 * 1024 * 1024


def env(name, default=""):
    return (os.getenv(name) or default).strip()


# ----- Настройки Cloud.ru (OpenAI-совместимый API) -----
API_KEY = env("CLOUDRU_API_KEY")
BASE_URL = env("CLOUDRU_BASE_URL", "https://foundation-models.api.cloud.ru/v1")
LLM_MODEL = env("LLM_MODEL", "Qwen/Qwen3-235B-A22B-Instruct-2507")
VISION_MODEL = env("VISION_MODEL")  # пусто — картинки не описываются
EMBEDDING_MODEL = env("EMBEDDING_MODEL", "Qwen/Qwen3-Embedding-0.6B")
EMBEDDING_DIM = env("EMBEDDING_DIM")  # пусто — определяется автоматически
QUERY_MODE = env("QUERY_MODE", "mix")


def llm_func(prompt, system_prompt=None, history_messages=None, **kwargs):
    # LightRAG просит structured output для ключевых слов; не все модели Cloud.ru
    # его поддерживают, а JSON из обычного ответа LightRAG разбирает сам.
    kwargs.pop("keyword_extraction", None)
    kwargs.pop("response_format", None)
    return openai_complete_if_cache(
        LLM_MODEL,
        prompt,
        system_prompt=system_prompt,
        history_messages=history_messages or [],
        api_key=API_KEY,
        base_url=BASE_URL,
        **kwargs,
    )


def vision_func(prompt, system_prompt=None, history_messages=None,
                image_data=None, messages=None, **kwargs):
    if messages:
        return openai_complete_if_cache(
            VISION_MODEL, "", messages=messages,
            api_key=API_KEY, base_url=BASE_URL, **kwargs,
        )
    if image_data:
        mime = image_mime_type(base64.b64decode(image_data[:24])) or "image/jpeg"
        msgs = []
        if system_prompt:
            msgs.append({"role": "system", "content": system_prompt})
        msgs.append({"role": "user", "content": [
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{image_data}"}},
        ]})
        return openai_complete_if_cache(
            VISION_MODEL, "", messages=msgs,
            api_key=API_KEY, base_url=BASE_URL, **kwargs,
        )
    return llm_func(prompt, system_prompt, history_messages, **kwargs)


async def detect_embedding_dim():
    if EMBEDDING_DIM:
        return int(EMBEDDING_DIM)
    vec = await openai_embed.func(
        ["AMANOGAWA"], model=EMBEDDING_MODEL, api_key=API_KEY, base_url=BASE_URL
    )
    return len(vec[0])


# ----- Состояние -----
state = {"rag": None, "parser_ok": False, "error": None}
init_lock = asyncio.Lock()
work_lock = asyncio.Lock()  # документы индексируются по одному
jobs = {}


async def get_rag():
    if state["rag"] is not None:
        return state["rag"]
    if not API_KEY:
        raise HTTPException(503, "Нет ключа Cloud.ru: впишите CLOUDRU_API_KEY в файл .env и перезапустите.")
    async with init_lock:
        if state["rag"] is not None:
            return state["rag"]
        try:
            dim = await detect_embedding_dim()
            config = RAGAnythingConfig(
                working_dir=str(STORAGE),
                parser_output_dir=str(OUTPUT),
                enable_image_processing=bool(VISION_MODEL),
            )
            rag = RAGAnything(
                config=config,
                llm_model_func=llm_func,
                vision_model_func=vision_func if VISION_MODEL else None,
                embedding_func=EmbeddingFunc(
                    embedding_dim=dim,
                    max_token_size=8192,
                    func=partial(openai_embed.func, model=EMBEDDING_MODEL,
                                 api_key=API_KEY, base_url=BASE_URL),
                ),
            )
            # Парсер (MinerU и т.п.) нужен только для PDF/Office/картинок.
            # Текстовые файлы работают и без него, поэтому проверяем сами.
            state["parser_ok"] = bool(rag.doc_parser.check_installation())
            rag._parser_installation_checked = True
            result = await rag._ensure_lightrag_initialized()
            if not result or not result.get("success"):
                raise RuntimeError((result or {}).get("error", "LightRAG не запустился"))
            state["rag"], state["error"] = rag, None
            log.info("RAG-Anything готов: LLM=%s, эмбеддинги=%s (dim=%s)", LLM_MODEL, EMBEDDING_MODEL, dim)
        except HTTPException:
            raise
        except Exception as e:
            state["error"] = str(e)
            log.exception("Не удалось запустить RAG-Anything")
            raise HTTPException(502, f"Не удалось подключиться к Cloud.ru: {e}")
    return state["rag"]


def safe_name(name):
    name = Path(name or "file").name
    name = re.sub(r"[^\w.\- ]+", "_", name, flags=re.UNICODE).strip() or "file"
    return name[:120]


async def index_file(job_id, path: Path):
    job = jobs[job_id]
    try:
        rag = await get_rag()
        async with work_lock:
            job["status"] = "processing"
            if path.suffix.lower() in TEXT_EXT:
                text = path.read_text(encoding="utf-8", errors="replace")
                if not text.strip():
                    raise ValueError("Файл пустой")
                await rag.insert_content_list(
                    [{"type": "text", "text": text, "page_idx": 0}],
                    file_path=path.name,
                )
            else:
                if not state["parser_ok"]:
                    raise RuntimeError(
                        f"Для {path.suffix} нужен парсер «{rag.config.parser}», он не установлен. "
                        "Текстовые файлы (.txt, .md) работают и без него."
                    )
                await rag.process_document_complete(
                    file_path=str(path), output_dir=str(OUTPUT)
                )
        job["status"] = "done"
    except HTTPException as e:
        job.update(status="error", error=e.detail)
    except Exception as e:
        log.exception("Ошибка индексации %s", path.name)
        job.update(status="error", error=str(e))
    job["finished"] = time.time()


# ----- API -----
@asynccontextmanager
async def lifespan(_):
    if os.getenv("OPEN_BROWSER") == "1":
        url = f"http://127.0.0.1:{os.getenv('PORT', '8000')}/"
        threading.Timer(1.0, webbrowser.open, [url]).start()
    yield
    if state["rag"] is not None:
        await state["rag"].finalize_storages()


app = FastAPI(title="AMANOGAWA", lifespan=lifespan,
              docs_url="/api/docs", openapi_url="/api/openapi.json")


class Question(BaseModel):
    question: str
    mode: str | None = None


@app.get("/api/status")
async def status():
    return {
        "key": bool(API_KEY),
        "ready": state["rag"] is not None,
        "error": state["error"],
        "base_url": BASE_URL,
        "llm": LLM_MODEL,
        "embedding": EMBEDDING_MODEL,
        "vision": VISION_MODEL or None,
        "parser_ok": state["parser_ok"] if state["rag"] else None,
    }


@app.post("/api/connect")
async def connect():
    await get_rag()
    return await status()


@app.post("/api/upload")
async def upload(file: UploadFile = File(...)):
    INPUTS.mkdir(parents=True, exist_ok=True)
    name = safe_name(file.filename)
    dest = INPUTS / name
    if dest.exists():
        dest = INPUTS / f"{dest.stem}-{uuid.uuid4().hex[:6]}{dest.suffix}"
    size = 0
    with dest.open("wb") as out:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_UPLOAD:
                out.close()
                dest.unlink(missing_ok=True)
                raise HTTPException(413, "Файл больше 200 МБ")
            out.write(chunk)
    job_id = uuid.uuid4().hex[:12]
    jobs[job_id] = {"id": job_id, "name": dest.name, "status": "queued",
                    "error": None, "started": time.time(), "finished": None}
    asyncio.create_task(index_file(job_id, dest))
    return jobs[job_id]


@app.get("/api/documents")
async def documents():
    return sorted(jobs.values(), key=lambda j: j["started"], reverse=True)


@app.post("/api/query")
async def query(q: Question):
    text = q.question.strip()
    if not text:
        raise HTTPException(400, "Пустой вопрос")
    rag = await get_rag()
    mode = q.mode or QUERY_MODE
    if mode not in {"local", "global", "hybrid", "naive", "mix", "bypass"}:
        raise HTTPException(400, f"Неизвестный режим: {mode}")
    try:
        answer = await rag.aquery(text, mode=mode)
    except Exception as e:
        log.exception("Ошибка запроса")
        raise HTTPException(502, f"Ошибка запроса к модели: {e}")
    if not answer:
        answer = "Ничего не нашлось. Загрузите документы или переформулируйте вопрос."
    return {"answer": answer, "mode": mode}


@app.exception_handler(HTTPException)
async def http_error(_, exc: HTTPException):
    return JSONResponse({"error": exc.detail}, status_code=exc.status_code)


# ----- Сайт (index.html, css, js) -----
@app.get("/")
async def index():
    return FileResponse(ROOT / "index.html")


app.mount("/css", StaticFiles(directory=ROOT / "css"), name="css")
app.mount("/js", StaticFiles(directory=ROOT / "js"), name="js")
