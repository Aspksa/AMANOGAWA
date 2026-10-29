"""AMANOGAWA — сервер: сайт + база знаний на RAG-Anything с моделями Cloud.ru.

Запуск: python -m server   (из корня проекта; AMANOGAWA.BAT делает это сам)
"""

import asyncio
import base64
import json
import logging
import os
import re
import threading
import time
import uuid
import webbrowser
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv, set_key
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / ".env"
load_dotenv(ENV_FILE, override=False)

from lightrag import QueryParam  # noqa: E402
from lightrag.base import DocStatus  # noqa: E402
from lightrag.llm.openai import openai_complete_if_cache, openai_embed  # noqa: E402
from lightrag.utils import EmbeddingFunc  # noqa: E402
from openai import AsyncOpenAI  # noqa: E402
from raganything import RAGAnything, RAGAnythingConfig  # noqa: E402
from raganything.image_signature import image_mime_type  # noqa: E402

log = logging.getLogger("amanogawa")

DATA = ROOT / "data"
INPUTS = DATA / "inputs"
STORAGE = DATA / "rag_storage"
OUTPUT = DATA / "output"

TEXT_EXT = {".txt", ".md", ".markdown"}
MAX_UPLOAD = 200 * 1024 * 1024
MODES = {"local", "global", "hybrid", "naive", "mix", "bypass"}

# ----- Настройки (хранятся в .env, меняются со страницы «Настройки») -----
DEFAULTS = {
    "CLOUDRU_BASE_URL": "https://foundation-models.api.cloud.ru/v1",
    "LLM_MODEL": "Qwen/Qwen3-235B-A22B-Instruct-2507",
    "EMBEDDING_MODEL": "Qwen/Qwen3-Embedding-0.6B",
    "EMBEDDING_DIM": "",  # пусто — определяется автоматически
    "VISION_MODEL": "",  # пусто — картинки в PDF не описываются
    "QUERY_MODE": "mix",
    "TOP_K": "40",
    "HISTORY_TURNS": "3",
    "SUMMARY_LANGUAGE": "Russian",
    "PARSER": "mineru",
}
SECRET = "CLOUDRU_API_KEY"


def cfg(name):
    return (os.getenv(name) or DEFAULTS.get(name, "")).strip()


def slug(text):
    return re.sub(r"[^\w.-]+", "_", text).strip("_") or "default"


def llm_func(prompt, system_prompt=None, history_messages=None, **kwargs):
    # LightRAG просит structured output для ключевых слов; не все модели Cloud.ru
    # его поддерживают, а JSON из обычного ответа LightRAG разбирает сам.
    kwargs.pop("keyword_extraction", None)
    kwargs.pop("response_format", None)
    return openai_complete_if_cache(
        cfg("LLM_MODEL"),
        prompt,
        system_prompt=system_prompt,
        history_messages=history_messages or [],
        api_key=cfg(SECRET),
        base_url=cfg("CLOUDRU_BASE_URL"),
        **kwargs,
    )


def vision_func(prompt, system_prompt=None, history_messages=None,
                image_data=None, messages=None, **kwargs):
    model, key, url = cfg("VISION_MODEL"), cfg(SECRET), cfg("CLOUDRU_BASE_URL")
    if messages:
        return openai_complete_if_cache(model, "", messages=messages,
                                        api_key=key, base_url=url, **kwargs)
    if image_data:
        mime = image_mime_type(base64.b64decode(image_data[:24])) or "image/jpeg"
        msgs = []
        if system_prompt:
            msgs.append({"role": "system", "content": system_prompt})
        msgs.append({"role": "user", "content": [
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{image_data}"}},
        ]})
        return openai_complete_if_cache(model, "", messages=msgs,
                                        api_key=key, base_url=url, **kwargs)
    return llm_func(prompt, system_prompt, history_messages, **kwargs)


def embed(texts, **kwargs):
    return openai_embed.func(texts, model=cfg("EMBEDDING_MODEL"), api_key=cfg(SECRET),
                             base_url=cfg("CLOUDRU_BASE_URL"), **kwargs)


async def detect_embedding_dim():
    if cfg("EMBEDDING_DIM"):
        return int(cfg("EMBEDDING_DIM"))
    vec = await embed(["AMANOGAWA"])
    return len(vec[0])


# ----- Состояние -----
state = {"rag": None, "parser_ok": False, "error": None, "dim": None}
init_lock = asyncio.Lock()
work_lock = asyncio.Lock()  # документы индексируются по одному
jobs = {}  # загрузки, которые ещё не попали в базу или упали


async def get_rag():
    if state["rag"] is not None:
        return state["rag"]
    if not cfg(SECRET):
        raise HTTPException(503, "Нет ключа Cloud.ru: впишите его на странице «Настройки».")
    async with init_lock:
        if state["rag"] is not None:
            return state["rag"]
        try:
            os.environ["SUMMARY_LANGUAGE"] = cfg("SUMMARY_LANGUAGE")  # язык описаний в графе
            dim = await detect_embedding_dim()
            # У каждой модели эмбеддингов свой индекс: векторы разных моделей несовместимы.
            config = RAGAnythingConfig(
                working_dir=str(STORAGE / slug(cfg("EMBEDDING_MODEL"))),
                parser_output_dir=str(OUTPUT),
                parser=cfg("PARSER"),
                enable_image_processing=bool(cfg("VISION_MODEL")),
            )
            rag = RAGAnything(
                config=config,
                llm_model_func=llm_func,
                vision_model_func=vision_func if cfg("VISION_MODEL") else None,
                embedding_func=EmbeddingFunc(embedding_dim=dim, max_token_size=8192, func=embed),
            )
            # Парсер (MinerU и т.п.) нужен только для PDF/Office/картинок.
            # Текстовые файлы работают и без него, поэтому проверяем сами.
            state["parser_ok"] = bool(rag.doc_parser.check_installation())
            rag._parser_installation_checked = True
            result = await rag._ensure_lightrag_initialized()
            if not result or not result.get("success"):
                raise RuntimeError((result or {}).get("error", "LightRAG не запустился"))
            state.update(rag=rag, error=None, dim=dim)
            log.info("RAG-Anything готов: LLM=%s, эмбеддинги=%s (dim=%s)",
                     cfg("LLM_MODEL"), cfg("EMBEDDING_MODEL"), dim)
        except Exception as e:
            state["error"] = str(e)
            log.exception("Не удалось запустить RAG-Anything")
            raise HTTPException(502, f"Не удалось подключиться к Cloud.ru: {e}")
    return state["rag"]


async def reset_rag():
    async with init_lock, work_lock:
        rag, state["rag"] = state["rag"], None
        state["error"] = None
        if rag is not None:
            await rag.finalize_storages()


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
                    [{"type": "text", "text": text, "page_idx": 0}], file_path=path.name,
                )
            else:
                if not state["parser_ok"]:
                    raise RuntimeError(
                        f"Для {path.suffix} нужен парсер «{rag.config.parser}», он не установлен. "
                        "Текстовые файлы (.txt, .md) работают и без него."
                    )
                await rag.process_document_complete(file_path=str(path), output_dir=str(OUTPUT))
        jobs.pop(job_id, None)  # дальше документ виден в базе
    except HTTPException as e:
        job.update(status="error", error=e.detail)
    except Exception as e:
        log.exception("Ошибка индексации %s", path.name)
        job.update(status="error", error=str(e))


STATUS_MAP = {
    DocStatus.PENDING: "queued",
    DocStatus.PROCESSING: "processing",
    DocStatus.PREPROCESSED: "processing",
    DocStatus.PROCESSED: "done",
    DocStatus.FAILED: "error",
}


async def stored_documents(rag):
    docs = []
    for st, ui in STATUS_MAP.items():
        for doc_id, d in (await rag.lightrag.get_docs_by_status(st)).items():
            docs.append({
                "id": doc_id,
                "name": d.file_path,
                "status": ui,
                "error": d.error_msg,
                "chunks": d.chunks_count,
                "updated": d.updated_at,
            })
    return docs


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

LOCAL_HOSTS = {"127.0.0.1", "localhost", "[::1]"}


@app.middleware("http")
async def local_only(request: Request, call_next):
    # Сервер слушает только этот компьютер. Проверка Host защищает от DNS rebinding,
    # а обязательный заголовок не даёт чужим сайтам слать формы на localhost.
    if request.url.path.startswith("/api/"):
        host = (request.headers.get("host") or "").rsplit(":", 1)[0]
        if host not in LOCAL_HOSTS:
            return JSONResponse({"error": "Доступ только с этого компьютера"}, status_code=403)
        if request.method not in ("GET", "HEAD", "OPTIONS") and request.headers.get("x-amanogawa") != "1":
            return JSONResponse({"error": "Нет заголовка X-Amanogawa"}, status_code=403)
    return await call_next(request)


@app.exception_handler(HTTPException)
async def http_error(_, exc: HTTPException):
    return JSONResponse({"error": exc.detail}, status_code=exc.status_code)


@app.get("/api/status")
async def status():
    return {
        "key": bool(cfg(SECRET)),
        "ready": state["rag"] is not None,
        "error": state["error"],
        "llm": cfg("LLM_MODEL"),
        "embedding": cfg("EMBEDDING_MODEL"),
        "vision": cfg("VISION_MODEL") or None,
        "dim": state["dim"],
        "parser": cfg("PARSER"),
        "parser_ok": state["parser_ok"] if state["rag"] else None,
    }


@app.post("/api/connect")
async def connect():
    await get_rag()
    return await status()


# --- Настройки ---
class SettingsIn(BaseModel):
    values: dict[str, str] = {}
    api_key: str | None = None  # пусто — ключ не меняется


@app.get("/api/settings")
async def get_settings():
    key = cfg(SECRET)
    return {
        "values": {k: cfg(k) for k in DEFAULTS},
        "defaults": DEFAULTS,
        "key_set": bool(key),
        "key_hint": f"…{key[-4:]}" if len(key) > 8 else "",
    }


@app.put("/api/settings")
async def put_settings(body: SettingsIn):
    changes = {k: v.strip() for k, v in body.values.items() if k in DEFAULTS}
    if body.api_key and body.api_key.strip():
        changes[SECRET] = body.api_key.strip()
    if changes.get("QUERY_MODE", "mix") not in MODES:
        raise HTTPException(400, "Неизвестный режим поиска")
    for k in ("EMBEDDING_DIM", "TOP_K", "HISTORY_TURNS"):
        if changes.get(k) and not changes[k].isdigit():
            raise HTTPException(400, f"{k}: нужно целое число")
    if any(re.search(r"[\r\n]", v) for v in changes.values()):
        raise HTTPException(400, "Значения должны быть в одну строку")
    ENV_FILE.touch(exist_ok=True)
    for k, v in changes.items():
        set_key(str(ENV_FILE), k, v, quote_mode="never")
        os.environ[k] = v
    await reset_rag()
    return await get_settings()


class ModelsIn(BaseModel):
    api_key: str | None = None
    base_url: str | None = None


@app.post("/api/models")
async def models(body: ModelsIn):
    key = (body.api_key or "").strip() or cfg(SECRET)
    if not key:
        raise HTTPException(400, "Сначала впишите ключ")
    client = AsyncOpenAI(api_key=key, base_url=(body.base_url or "").strip() or cfg("CLOUDRU_BASE_URL"))
    try:
        page = await client.models.list()
        return {"models": sorted(m.id for m in page.data)}
    except Exception as e:
        raise HTTPException(502, f"Cloud.ru не отдал список моделей: {e}")
    finally:
        await client.close()


# --- Документы ---
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
    job_id = "job-" + uuid.uuid4().hex[:12]
    jobs[job_id] = {"id": job_id, "name": dest.name, "status": "queued", "error": None,
                    "chunks": None, "updated": time.strftime("%Y-%m-%dT%H:%M:%S")}
    asyncio.create_task(index_file(job_id, dest))
    return jobs[job_id]


@app.get("/api/documents")
async def documents():
    docs = []
    if state["rag"] is None and cfg(SECRET):
        try:
            await get_rag()
        except HTTPException:
            pass
    if state["rag"] is not None:
        docs = await stored_documents(state["rag"])
    names = {d["name"] for d in docs}
    pending = [j for j in jobs.values() if j["status"] == "error" or j["name"] not in names]
    return sorted(pending + docs, key=lambda d: d["updated"] or "", reverse=True)


@app.delete("/api/documents/{doc_id}")
async def delete_document(doc_id: str):
    if doc_id in jobs:
        job = jobs[doc_id]
        if job["status"] != "error":
            raise HTTPException(409, "Документ ещё обрабатывается")
        jobs.pop(doc_id)
        (INPUTS / job["name"]).unlink(missing_ok=True)
        return {"deleted": doc_id}
    rag = await get_rag()
    async with work_lock:
        result = await rag.lightrag.adelete_by_doc_id(doc_id)
    if result.status != "success":
        raise HTTPException(result.status_code or 400, result.message)
    if result.file_path:
        (INPUTS / Path(result.file_path).name).unlink(missing_ok=True)
    return {"deleted": doc_id}


# --- Вопросы ---
class Question(BaseModel):
    question: str
    mode: str | None = None
    history: list[dict[str, str]] = []


@app.post("/api/query")
async def query(q: Question):
    text = q.question.strip()
    if not text:
        raise HTTPException(400, "Пустой вопрос")
    mode = q.mode or cfg("QUERY_MODE")
    if mode not in MODES:
        raise HTTPException(400, f"Неизвестный режим: {mode}")
    rag = await get_rag()

    turns = int(cfg("HISTORY_TURNS") or 0)
    history = [
        {"role": m["role"], "content": m["content"]}
        for m in q.history
        if m.get("role") in ("user", "assistant") and m.get("content")
    ][-turns * 2:] if turns else []

    param = QueryParam(mode=mode, stream=True, include_references=True,
                       top_k=int(cfg("TOP_K") or 40), conversation_history=history)

    async def events():
        def line(obj):
            return json.dumps(obj, ensure_ascii=False) + "\n"
        try:
            result = await rag.lightrag.aquery_llm(text, param=param)
            refs = (result.get("data") or {}).get("references") or []
            yield line({"type": "sources", "sources": [
                {"id": r.get("reference_id"), "file": r.get("file_path")} for r in refs
            ]})
            llm = result.get("llm_response") or {}
            if llm.get("is_streaming") and llm.get("response_iterator") is not None:
                async for chunk in llm["response_iterator"]:
                    if chunk:
                        yield line({"type": "text", "text": chunk})
            else:
                yield line({"type": "text", "text": llm.get("content")
                            or "Ничего не нашлось. Загрузите документы или переформулируйте вопрос."})
        except Exception as e:
            log.exception("Ошибка запроса")
            yield line({"type": "error", "error": f"Ошибка запроса к модели: {e}"})
        yield line({"type": "done"})

    return StreamingResponse(events(), media_type="application/x-ndjson")


# --- Граф знаний ---
@app.get("/api/graph")
async def graph(label: str = "*", max_nodes: int = 300):
    rag = await get_rag()
    kg = await rag.lightrag.get_knowledge_graph(label or "*", max_depth=3,
                                                max_nodes=max(10, min(max_nodes, 1000)))
    return {
        "truncated": kg.is_truncated,
        "nodes": [{
            "id": n.id,
            "type": n.properties.get("entity_type", ""),
            "description": n.properties.get("description", ""),
            "file": n.properties.get("file_path", ""),
        } for n in kg.nodes],
        "edges": [{
            "source": e.source,
            "target": e.target,
            "description": e.properties.get("description", ""),
            "keywords": e.properties.get("keywords", ""),
        } for e in kg.edges],
    }


@app.get("/api/graph/labels")
async def graph_labels():
    rag = await get_rag()
    return {"labels": await rag.lightrag.get_graph_labels()}


# ----- Сайт (index.html, css, js) -----
@app.get("/")
async def index():
    return FileResponse(ROOT / "index.html")


app.mount("/css", StaticFiles(directory=ROOT / "css"), name="css")
app.mount("/js", StaticFiles(directory=ROOT / "js"), name="js")
app.mount("/img", StaticFiles(directory=ROOT / "img"), name="img")
