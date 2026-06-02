#!/usr/bin/env python3
"""
Agents v2 Фаза C2 — GEPA HTTP-сервис (отдельный контейнер).

Раньше `runner.py` запускался из NestJS через `child_process.spawn` ВНУТРИ
контейнера backend (см. историю gepa-runner.service.ts). Это раздувало образ
backend pip-зависимостями (gepa/dspy), ломало атомарность сборки и плодило
дочерние процессы в API. Теперь GEPA живёт в собственном контейнере `z-gepa`,
а backend ходит сюда по HTTP (`GepaRunnerService.callGepaService`).

Эндпоинты:
    POST /optimize  — тело = тот же JSON-payload, что раньше шёл в stdin runner'а:
                      { seed_prompt, reflective_dataset, task_lm, reflection_lm,
                        max_metric_calls }.
                      Ответ — { pareto_frontier: [...], cost_usd } либо
                      { error, trace, pareto_frontier: [] } (HTTP 200 в обоих
                      случаях — backend различает по полю `error`, как и раньше
                      различал по JSON из stdout).
    GET  /health    — liveness для docker healthcheck.
    GET  /version   — sanity-инфо о runner'е и Python.

Контракт `_run_gepa` переиспользуется из `runner.py` без изменений, поэтому
CLI-режим (`python3 runner.py`) продолжает работать для smoke-тестов.

См. plans/tz/2026-05-29-agents-v2-umbrella.md §C2.
"""

from __future__ import annotations

import os
import sys
import traceback
from typing import Any

from fastapi import FastAPI, Request

# runner.py лежит рядом — переиспользуем ядро логики, не дублируя его.
from runner import _run_gepa  # type: ignore

app = FastAPI(title="z-gepa", version="0.1.0")


@app.get("/health")
def health() -> dict[str, str]:
    """Liveness probe для docker healthcheck (не грузит gepa/dspy)."""
    return {"status": "ok"}


@app.get("/version")
def version() -> dict[str, str]:
    return {"runner": "gepa-runner", "version": "0.1.0", "python": sys.version}


@app.post("/optimize")
async def optimize(request: Request) -> dict[str, Any]:
    """
    Запускает GEPA optimization. Тело — произвольный JSON (тот же контракт,
    что раньше шёл в stdin). Ошибки НЕ превращаем в HTTP 5xx: возвращаем
    `{ error, trace, pareto_frontier: [] }` с кодом 200, чтобы backend-сторона
    (GepaRunnerService) пометила status='failed' и не падала — ровно как
    раньше при разборе JSON из stdout subprocess'а.
    """
    try:
        payload = await request.json()
    except Exception as exc:  # noqa: BLE001
        return {"error": f"invalid payload: {exc}", "pareto_frontier": []}

    try:
        return _run_gepa(payload)
    except Exception as exc:  # noqa: BLE001
        return {
            "error": str(exc),
            "trace": traceback.format_exc(),
            "pareto_frontier": [],
        }


if __name__ == "__main__":
    import uvicorn

    # Один worker: GEPA-прогон длится до часа и упирается в LLM, а не в CPU;
    # конкуренция отсекается Redis-локом в gepa-optimize.cron на стороне backend.
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=int(os.environ.get("GEPA_PORT", "8000")),
    )
