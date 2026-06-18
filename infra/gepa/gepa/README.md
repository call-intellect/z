# GEPA runner для backend prompt evolution

Agents v2 Фаза C2 (см. `plans/tz/2026-05-29-agents-v2-umbrella.md` §C2).

## Что это

Python-обёртка над библиотекой [`gepa`](https://github.com/gepa-ai/gepa)
(Reflective Prompt Evolution, arxiv 2507.19457).

**С 2026-06 крутится в отдельном контейнере `z-gepa`** (HTTP-сервис на FastAPI,
`server.py`). Backend (`GepaRunnerService`) ходит сюда по
`POST {GEPA_SERVICE_URL}/optimize` (default `http://gepa:8000`).

> Раньше `runner.py` запускался из Node через `child_process.spawn` ВНУТРИ
> контейнера backend — это раздувало образ pip-зависимостями (gepa/dspy),
> ломало атомарность сборки и плодило дочерние процессы в API. Теперь
> зависимости изолированы в собственном образе (`backend/python/Dockerfile`).

Файлы:
- `runner.py` — ядро логики (`_run_gepa`) + CLI-режим для smoke-тестов.
- `server.py` — HTTP-обёртка (FastAPI), точка входа контейнера.

## Запуск

### Контейнер (как в проде)

```bash
# Prod (часть основного compose):
docker compose up -d --build gepa
docker compose logs -f gepa

# Dev (порт публикуется на хост, backend крутится процессом):
docker compose -f docker-compose.dev.yml up -d gepa
#   в .env: GEPA_SERVICE_URL=http://127.0.0.1:58000
```

### Локально без контейнера

```bash
# Sanity check CLI (без зависимостей):
python3 backend/python/gepa/runner.py --version

# HTTP-сервис:
pip install -r backend/python/gepa/requirements.txt
cd backend/python/gepa && python server.py   # слушает :8000

# Проверка:
curl localhost:8000/health
curl -X POST localhost:8000/optimize -H 'content-type: application/json' \
  -d '{"seed_prompt":"You are helpful...","reflective_dataset":[...],"task_lm":"deepseek-v4-pro","reflection_lm":"deepseek-v4-pro","max_metric_calls":150}'
```

## Контракт

**`POST /optimize`** — тело JSON (тот же payload, что раньше шёл в stdin):
```json
{
  "seed_prompt": "...",
  "reflective_dataset": [
    {"input": "...", "original": "...", "edited": "...", "diff": "..."}
  ],
  "task_lm": "deepseek-v4-pro",
  "reflection_lm": "deepseek-v4-pro",
  "max_metric_calls": 150
}
```

**Ответ:** JSON (всегда HTTP 200 — backend различает успех/ошибку по полю `error`)
```json
{
  "pareto_frontier": [
    {"text": "...", "metrics": {"accuracy": 0.87, "cost": 0.12}, "traces": [...]}
  ],
  "cost_usd": 12.34
}
```

При ошибке:
```json
{"error": "<message>", "trace": "<py-traceback>", "pareto_frontier": []}
```

**`GET /health`** — `{"status":"ok"}` (docker healthcheck).
**`GET /version`** — инфо о runner'е и Python.
