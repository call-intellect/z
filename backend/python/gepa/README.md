# GEPA runner для backend prompt evolution

Agents v2 Фаза C2 (см. `plans/tz/2026-05-29-agents-v2-umbrella.md` §C2).

## Что это

Python-обёртка над библиотекой [`gepa`](https://github.com/gepa-ai/gepa)
(Reflective Prompt Evolution, arxiv 2507.19457). Запускается из Node
(`GepaRunnerService`) через `child_process.spawn`.

## Запуск

```bash
# Sanity check (без зависимостей):
python3 backend/python/gepa/runner.py --version

# Реальный запуск (требуется pip install -r requirements.txt):
echo '{"seed_prompt":"You are helpful...","reflective_dataset":[...],"task_lm":"deepseek-v4-pro","reflection_lm":"deepseek-v4-pro","max_metric_calls":150}' \
  | python3 backend/python/gepa/runner.py
```

## Контракт

**stdin:** JSON
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

**stdout:** JSON
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

## Установка зависимостей

В Docker prod-runner устанавливаются автоматически (`pip install -r requirements.txt`).
Для локальной разработки:

```bash
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r backend/python/gepa/requirements.txt
```
