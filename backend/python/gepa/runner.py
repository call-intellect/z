#!/usr/bin/env python3
"""
Agents v2 Фаза C2 — GEPA runner для backend prompt evolution.

Используется из GepaRunnerService через child_process.spawn:
    payload = JSON.stringify({ seed_prompt, reflective_dataset, task_lm,
                               reflection_lm, max_metric_calls })
    stdout = JSON: { pareto_frontier: [{ text, metrics, traces }] }

При сбое — JSON { error: <message>, candidates: [] }, чтобы Node-сторона
могла gracefully отметить status='failed' и не разрушать cron.

См. plans/tz/2026-05-29-agents-v2-umbrella.md §C2.
"""

from __future__ import annotations

import json
import os
import sys
import traceback
from typing import Any


def _emit(payload: dict[str, Any]) -> None:
    """Печатает JSON одной строкой в stdout."""
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))
    sys.stdout.write("\n")
    sys.stdout.flush()


def _read_payload() -> dict[str, Any]:
    raw = sys.stdin.read()
    if not raw.strip():
        raise ValueError("empty stdin payload")
    return json.loads(raw)


def _run_gepa(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Реальный вызов GEPA. Импортируем gepa/dspy лениво: если зависимости
    отсутствуют (dev без pip install) — поднимем понятную ошибку, которую
    Node-сторона залогирует и пометит status='failed'.
    """
    try:
        from gepa import optimize  # type: ignore
        from gepa.adapters.default import DefaultAdapter  # type: ignore
    except ImportError as exc:
        raise RuntimeError(
            f"gepa/dspy не установлены ({exc}). "
            "Установите: pip install -r backend/python/gepa/requirements.txt"
        ) from exc

    seed_prompt = payload.get("seed_prompt")
    dataset = payload.get("reflective_dataset", [])
    task_lm = payload.get("task_lm", "deepseek-v4-pro")
    reflection_lm = payload.get("reflection_lm", "deepseek-v4-pro")
    max_metric_calls = int(payload.get("max_metric_calls", 150))

    if not isinstance(seed_prompt, str) or not seed_prompt:
        raise ValueError("seed_prompt must be non-empty string")
    if not isinstance(dataset, list) or len(dataset) == 0:
        raise ValueError("reflective_dataset must be non-empty list")

    # Префикс провайдера: GEPA/DSPy ожидает 'provider/model' формат
    # (через litellm). Для DeepSeek используем `deepseek/<model>`.
    task_lm_full = task_lm if "/" in task_lm else f"deepseek/{task_lm}"
    reflection_lm_full = (
        reflection_lm if "/" in reflection_lm else f"deepseek/{reflection_lm}"
    )

    result = optimize(  # type: ignore
        seed_prompt=seed_prompt,
        dataset=dataset,
        task_lm=task_lm_full,
        reflection_lm=reflection_lm_full,
        max_metric_calls=max_metric_calls,
        adapter=DefaultAdapter(),
    )

    pareto = getattr(result, "pareto_frontier", []) or []
    out_candidates: list[dict[str, Any]] = []
    for c in pareto:
        out_candidates.append(
            {
                "text": getattr(c, "prompt", "") or "",
                "metrics": getattr(c, "metrics", {}) or {},
                "traces": getattr(c, "traces", []) or [],
            }
        )

    cost_usd = getattr(result, "cost_usd", None)
    return {
        "pareto_frontier": out_candidates,
        "cost_usd": cost_usd if isinstance(cost_usd, (int, float)) else None,
    }


def main() -> int:
    # --version — sanity check для dev/Docker healthcheck.
    if len(sys.argv) > 1 and sys.argv[1] in ("--version", "-v"):
        _emit({"runner": "gepa-runner", "version": "0.1.0", "python": sys.version})
        return 0

    try:
        payload = _read_payload()
    except Exception as exc:  # noqa: BLE001
        _emit(
            {
                "error": f"invalid payload: {exc}",
                "pareto_frontier": [],
            }
        )
        return 2

    try:
        result = _run_gepa(payload)
        _emit(result)
        return 0
    except Exception as exc:  # noqa: BLE001
        _emit(
            {
                "error": str(exc),
                "trace": traceback.format_exc(),
                "pareto_frontier": [],
            }
        )
        return 1


if __name__ == "__main__":
    sys.exit(main())
