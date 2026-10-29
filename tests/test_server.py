import asyncio
import base64
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from dotenv import dotenv_values
from fastapi import HTTPException
from fastapi.testclient import TestClient
from openai import AsyncOpenAI

import server.app as backend


@pytest.fixture(autouse=True)
def isolated_state(monkeypatch, tmp_path):
    for key in (*backend.DEFAULTS, backend.SECRET):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setattr(backend, "ENV_FILE", tmp_path / ".env")
    monkeypatch.setattr(backend, "INPUTS", tmp_path / "inputs")
    monkeypatch.setattr(backend, "state", {"rag": None, "dim": None, "parser_ok": False, "error": None})
    monkeypatch.setattr(backend, "jobs", {})
    monkeypatch.setattr(backend, "background_tasks", set())
    monkeypatch.setattr(backend, "init_lock", asyncio.Lock())
    monkeypatch.setattr(backend, "work_lock", asyncio.Lock())
    monkeypatch.setattr(backend, "settings_lock", asyncio.Lock())
    monkeypatch.setattr(backend, "active_operations", 0)
    monkeypatch.delenv("OPEN_BROWSER", raising=False)


@pytest.fixture
def client():
    with TestClient(backend.app, base_url="http://localhost:8000",
                    headers={"X-Amanogawa": "1"}) as client:
        yield client


def test_site_and_missing_key(client):
    assert client.get("/").status_code == 200
    assert client.get("/js/chat.js").status_code == 200
    assert client.get("/api/status").json()["key"] is False
    assert client.post("/api/connect").status_code == 503
    assert client.get("/.env").status_code == 404


@pytest.mark.parametrize("values", [
    {"EMBEDDING_DIM": "0"}, {"EMBEDDING_DIM": "-2"},
    {"TOP_K": "0"}, {"TOP_K": "201"}, {"TOP_K": ""},
    {"HISTORY_TURNS": "21"}, {"HISTORY_TURNS": "-1"},
    {"LLM_MODEL": ""}, {"EMBEDDING_MODEL": ""},
    {"QUERY_MODE": "unknown"}, {"PARSER": "unknown"},
    {"CLOUDRU_BASE_URL": "not a URL"}, {"CLOUDRU_BASE_URL": "https://host:wrong/v1"},
    {"CLOUDRU_BASE_URL": "https://user:password@host/v1"},
    {"LLM_MODEL": "model\nOTHER=value"},
])
def test_bad_settings_do_not_change_file_or_environment(client, values):
    response = client.put("/api/settings", json={"values": values})
    assert response.status_code == 400
    assert not backend.ENV_FILE.exists()
    assert backend.cfg("TOP_K") == "40"


def test_settings_survive_dotenv_reload_and_keep_key(client):
    key = "example-key-with # space and ' quote"
    response = client.put("/api/settings", json={"api_key": key,
        "values": {"HISTORY_TURNS": "0", "EMBEDDING_DIM": ""}})
    assert response.status_code == 200
    assert key not in response.text
    assert dotenv_values(backend.ENV_FILE)[backend.SECRET] == key
    assert client.put("/api/settings", json={"values": {"TOP_K": "20"}}).status_code == 200
    assert dotenv_values(backend.ENV_FILE)[backend.SECRET] == key


def test_busy_settings_preserve_active_instance_and_key(monkeypatch):
    async def scenario():
        rag = SimpleNamespace(finalize_storages=AsyncMock())
        backend.state.update(rag=rag, dim=1024, parser_ok=True)
        async with backend.use_rag() as held:
            assert held is rag
            with pytest.raises(HTTPException) as error:
                await backend.put_settings(backend.SettingsIn(api_key="new-key"))
            assert error.value.status_code == 409
            rag.finalize_storages.assert_not_called()
            assert not backend.ENV_FILE.exists()
        await backend.put_settings(backend.SettingsIn(values={"TOP_K": "20"}))
        rag.finalize_storages.assert_awaited_once()
        assert backend.state == {"rag": None, "dim": None, "parser_ok": False, "error": None}
    asyncio.run(scenario())


def test_stream_reports_provider_failure(client):
    backend.state["rag"] = SimpleNamespace(lightrag=SimpleNamespace(aquery_llm=AsyncMock(
        return_value={"status": "failure", "message": "provider unavailable", "llm_response": {}})),
        finalize_storages=AsyncMock())
    response = client.post("/api/query", json={"question": "test"})
    events = [json.loads(line) for line in response.text.splitlines()]
    assert events[0]["type"] == "error"
    assert "provider unavailable" in events[0]["error"]
    assert events[-1] == {"type": "done"}
    assert backend.active_operations == 0


def test_stream_keeps_sources_and_history(client, monkeypatch):
    monkeypatch.setenv("HISTORY_TURNS", "1")
    async def chunks():
        yield "Ответ "
        yield "по документу"
    query = AsyncMock(return_value={"status": "success", "data": {"references": [
        {"reference_id": "1", "file_path": "пример.md"}]}, "llm_response": {
        "is_streaming": True, "response_iterator": chunks()}})
    backend.state["rag"] = SimpleNamespace(lightrag=SimpleNamespace(aquery_llm=query),
                                           finalize_storages=AsyncMock())
    history = [{"role": "user", "content": "old"}, {"role": "assistant", "content": "old"},
               {"role": "user", "content": "recent"}, {"role": "assistant", "content": "recent"}]
    response = client.post("/api/query", json={"question": "test", "history": history})
    events = [json.loads(line) for line in response.text.splitlines()]
    assert events[0]["sources"][0]["file"] == "пример.md"
    assert "".join(e["text"] for e in events if e["type"] == "text") == "Ответ по документу"
    assert query.call_args.kwargs["param"].conversation_history == history[-2:]


@pytest.mark.parametrize("headers,status", [({"Host": "evil.example"}, 403),
    ({"Host": "localhost"}, 200), ({"Host": "[::1]"}, 200), ({"Host": "[::1]:8000"}, 200)])
def test_local_host_guard(client, headers, status):
    assert client.get("/api/status", headers=headers).status_code == status


def test_external_form_cannot_write(client):
    assert client.post("/api/connect", headers={"X-Amanogawa": ""}).status_code == 403


@pytest.mark.parametrize("name", ["..", "CON.txt", "NUL", r"C:\fakepath\пример.txt", "a" * 140 + ".md"])
def test_upload_names_are_portable(name):
    cleaned = backend.safe_name(name)
    assert cleaned not in {".", "..", "CON.txt", "NUL"}
    assert "/" not in cleaned and "\\" not in cleaned
    assert len(cleaned) <= 120
    if name.endswith(".md"):
        assert cleaned.endswith(".md")


def test_empty_and_oversized_uploads_leave_no_files(client, monkeypatch):
    assert client.post("/api/upload", files={"file": ("empty.md", b"")}).status_code == 400
    monkeypatch.setattr(backend, "MAX_UPLOAD", 2)
    assert client.post("/api/upload", files={"file": ("large.md", b"123")}).status_code == 413
    assert list(backend.INPUTS.iterdir()) == []
    assert not backend.jobs


def test_text_upload_reaches_rag_without_parser(client):
    insert = AsyncMock()
    backend.state["rag"] = SimpleNamespace(insert_content_list=insert, finalize_storages=AsyncMock())
    response = client.post("/api/upload", files={"file": ("пример.md", "Текст".encode())})
    assert response.status_code == 200
    # Wait for the background task on the server's loop, not by sleeping.
    async def wait():
        if backend.background_tasks:
            await asyncio.gather(*backend.background_tasks)
    client.portal.call(wait)
    insert.assert_awaited_once()
    assert insert.call_args.args[0][0]["text"] == "Текст"


@pytest.mark.parametrize("with_messages", [False, True])
def test_vision_adapter_sends_one_messages_argument(monkeypatch, with_messages):
    import lightrag.llm.openai as adapter
    captured = []
    def respond(request):
        captured.append(json.loads(request.content))
        return httpx.Response(200, json={"id": "test", "object": "chat.completion", "created": 0,
            "model": "vision", "choices": [{"index": 0, "finish_reason": "stop",
            "message": {"role": "assistant", "content": "image description"}}]})
    def make_client(**kwargs):
        return AsyncOpenAI(api_key="test", base_url="https://example.invalid/v1",
            http_client=httpx.AsyncClient(transport=httpx.MockTransport(respond)))
    monkeypatch.setattr(adapter, "create_openai_async_client", make_client)
    monkeypatch.setenv("VISION_MODEL", "vision")
    payload = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\0" * 30).decode()
    if with_messages:
        result = asyncio.run(backend.vision_func("", messages=[
            {"role": "system", "content": "describe"},
            {"role": "user", "content": [{"type": "text", "text": "image"}]}]))
    else:
        result = asyncio.run(backend.vision_func("describe", image_data=payload))
    assert result == "image description"
    assert captured[0]["messages"][-1]["role"] == "user"
    assert isinstance(captured[0]["messages"][-1]["content"], list)
