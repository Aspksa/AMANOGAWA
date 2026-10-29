# AMANOGAWA

天の川 — Млечный Путь.

## Запуск

Дважды кликните **`AMANOGAWA.BAT`** (Windows).

1. При первом запуске создаётся `.venv` и ставятся RAG-Anything и зависимости (это долго: MinerU тянет PyTorch, нужно 10+ минут и несколько ГБ).
2. Если файла `.env` нет, он создаётся из `.env.example` и открывается в Блокноте: впишите ключ Cloud.ru после `CLOUDRU_API_KEY=`, сохраните и закройте.
3. Сайт открывается на http://localhost:8000/, раздел **База знаний** — загрузка документов и вопросы к ним.

Если Python не установлен, `index.html` откроется прямо в браузере (без базы знаний). Нужен Python 3.10+.

## База знаний: RAG-Anything + Cloud.ru

- [RAG-Anything](https://github.com/HKUDS/RAG-Anything) (MIT) лежит целиком в `vendor/RAG-Anything`, версия записана в `vendor/RAG-Anything.VERSION`.
- Модели — Cloud.ru Foundation Models через OpenAI-совместимый API (`https://foundation-models.api.cloud.ru/v1`).
- Ключ хранится только в `.env` на вашем компьютере; `.env` в `.gitignore` и в git не попадает.
- Имена моделей меняются в `.env` (`LLM_MODEL`, `EMBEDDING_MODEL`, `VISION_MODEL`). Точные имена смотрите в каталоге Foundation Models в консоли Cloud.ru.
- `.txt` и `.md` индексируются сразу; PDF, Office и картинки разбирает парсер MinerU (на Python 3.14 MinerU не ставится, там работают только текстовые файлы).
- Загруженные файлы и индекс хранятся в `data/` (тоже не попадает в git).

API сервера: `GET /api/status`, `POST /api/upload`, `GET /api/documents`, `POST /api/query`. Документация — http://localhost:8000/api/docs.

Запуск без BAT: `python -m pip install -r requirements.txt`, затем `python -m server`.

## Структура

- `index.html` — страница
- `css/style.css` — стили, адаптивные под любой размер экрана
- `js/main.js` — звёздное небо и мобильное меню
- `js/rag.js` — раздел «База знаний»
- `server/` — сервер на FastAPI: отдаёт сайт и API базы знаний
- `vendor/RAG-Anything/` — исходный код RAG-Anything
