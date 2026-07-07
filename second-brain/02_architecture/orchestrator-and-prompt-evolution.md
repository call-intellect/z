---
title: AI-инфра — Orchestrator + prompt-evolution (построено, выключено)
type: architecture
status: reference — крупный dormant-слой; включение = решение владельца
date: 2026-07-05
source: замер кода 2026-07-05
related:
  - "[[ai-integration]]"
  - "[[llm-cache-status]]"
  - "[[chief-of-staff-capability-map]]"
  - "[[../01_projects/llm-router]]"
---

# Orchestrator + prompt-evolution — построенный, но выключенный AI-слой

> Два крупных подмодуля AI-инфры полностью построены, но за флагами OFF. Важны стратегически: `Orchestrator` — готовый кандидат в «мозг дня руководителя» (C12), а prompt-evolution — петля роста качества подсказок. Фактическое состояние роутера/моделей — [[ai-integration]], [[../01_projects/llm-router]].

## 1. `orchestrator` — движок multi-agent research (OFF)

Модуль `backend/src/modules/orchestrator/`. Полный движок глубокого reasoning: `plan → BullMQ subagent fan-out (4 стратегии над графом) → synthesis → verify с retry`, SSE-стрим, UI `/orchestrator`, admin-тумблер.

- Флаг `ORCHESTRATOR_ENABLED=false` (`env.schema.ts:428`).
- Работает как ad-hoc pull (`POST /orchestrator/runs`), **не** как проактивный дневной слой.
- Модели `OrchestratorRun` / `OrchestratorSubagentJob`; ключ `orchestrator.service.ts`, `planning.service.ts`.
- **Стратегическое значение:** единственный готовый кандидат стоять за «что сегодня важно?» (C12) — не строить композитор с нуля, а надеть дневной цикл + сборку ленты поверх готового фундамента.

## 2. `prompt-evolution` — рост качества промптов (всё OFF)

Модуль `backend/src/modules/prompt-evolution/`. Три ветки самообучения, все за флагами:

- **GEPA** — эволюция промптов через внешний Python-сервис (`http://gepa:8000`); `PROMPT_EVOLUTION_ENABLED=false` (без сервиса → `skipped_no_python`). Cron'ы `GepaOptimize/Promote/AbMonitor`.
- **AutoRule** — извлечение правил из правок пользователей → инъекция в промпты; `AUTORULE_ENABLED=false`, правила застревают в `status=shadow`. **Дешевле GEPA (без Python)** — первый кандидат на включение.
- **Concierge-PRM** — shadow-скоринг качества выбора инструмента; `CONCIERGE_PRM_SHADOW_ENABLED=false`.
- **PromptFeedback** — `LlmRouter` эмитит `ai.invocation.completed`, `PromptFeedbackCollectorService` пишет правки+эмбеддинги, но оба потребителя (GEPA/AutoRule) выключены → **данные копятся мёртвым грузом**.

## 3. Пробел: нет premium reasoning-тира

`LlmRouteTier=primary/secondary/tertiary` — это fallback-цепочка, а не уровень интеллекта. Экзек-подсказки (`operations-*-digest`, `hr-recommender`, `forecast-weekly`) упираются в потолок `deepseek-v4-pro`. Ввод формального SMART-тира (kie/gemini для суждения/приоритизации, на `internal`-агрегатах из-за dataClass-фильтра) — блокер №1 для проактивной надстройки Chief of Staff. Подробно — [[chief-of-staff-capability-map]] и `plans/analysis/2026-07-05-chief-of-staff-gap-map.md`.
