"""Exercise vendored RAG-Anything and installed LightRAG without paid API calls."""

import asyncio
import atexit
import hashlib

import numpy as np
from lightrag import QueryParam
from lightrag.utils import EmbeddingFunc, Tokenizer
from raganything import RAGAnything, RAGAnythingConfig

from server.app import stored_documents


class CharacterTokenizer:
    def encode(self, content):
        return list(content.encode("utf-8"))

    def decode(self, tokens):
        return bytes(tokens).decode("utf-8", errors="replace")


def test_text_ingestion_query_and_delete(tmp_path):
    async def scenario():
        async def embedding(texts, **kwargs):
            return np.array([[byte / 255 for byte in hashlib.sha256(text.encode()).digest()[:8]]
                             for text in texts])

        async def llm(prompt, **kwargs):
            if kwargs.get("stream"):
                async def chunks():
                    yield "Проверочный ответ"
                return chunks()
            # Empty extraction is valid: this test checks ingestion/storage and
            # API compatibility rather than the quality of a language model.
            return "<|COMPLETE|>"

        rag = RAGAnything(config=RAGAnythingConfig(working_dir=str(tmp_path / "storage"),
            parser_output_dir=str(tmp_path / "output"), enable_image_processing=False),
            llm_model_func=llm,
            embedding_func=EmbeddingFunc(embedding_dim=8, max_token_size=8192, func=embedding),
            lightrag_kwargs={"tokenizer": Tokenizer("test", CharacterTokenizer()),
                             "entity_extract_max_gleaning": 0})
        # Same text-only initialization path as server.app.get_rag().
        rag._parser_installation_checked = True
        try:
            await rag.insert_content_list([{"type": "text", "text": "Документ AMANOGAWA для проверки.",
                                            "page_idx": 0}], file_path="пример.md")
            docs = await stored_documents(rag)
            assert len(docs) == 1
            assert docs[0]["name"] == "пример.md"
            assert docs[0]["status"] == "done"
            result = await rag.lightrag.aquery_llm("Проверка", QueryParam(mode="bypass", stream=True))
            assert result["status"] == "success"
            assert "".join([chunk async for chunk in result["llm_response"]["response_iterator"]]) == "Проверочный ответ"
            deleted = await rag.lightrag.adelete_by_doc_id(docs[0]["id"])
            assert deleted.status == "success"
            assert await stored_documents(rag) == []
        finally:
            await rag.finalize_storages()
            atexit.unregister(rag.close)
    asyncio.run(asyncio.wait_for(scenario(), timeout=20))
