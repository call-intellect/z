---
title: Единый помощник — single-pass Мастер + упрощённый chat-v2
date: 2026-06-25
tags: [concierge, chat-v2, dialog-layer, rag, single-pass, edinyy-pomoshnik]
---

# Единый помощник: single-pass Мастер + chat-v2 (4 вызова)

## Что было поставлено

ТЗ [`plans/tz/2026-06-25-edinyy-pomoshnik-arhitektura.md`](../../plans/tz/2026-06-25-edinyy-pomoshnik-arhitektura.md) (Ф1–Ф6) — упрощение архитектуры ассистента. Три вскрытых проблемы:

1. **Сломанные ответы в Telegram** (прод-разговор `cmqs42gdq01lj01qqsblfdon4`): бот вместо ответа вываливал сырой JSON. Корень — ReAct-петля Мастера (`for i<maxSteps`): chat-v2 каждый раз отвечал корректно, но петля не понимала, что инструмент уже вернул готовый ответ, зацикливалась и через `buildPartialAnswer` отдавала обрезанный JSON.
2. **Два мозга** — в кабинет вели два пути к ответам (Мастер и прямой chat-v2).
3. **Вторая скрытая петля внутри chat-v2** — `route → plan → step-retrieval → sufficiency`: ещё одна петля + 3 агента-дубля, утяжелявшие ответ.

Цель: один вход (Мастер), один проход без петель, тяжёлую модель тратить только на синтез.

## Как решал (фазы + ключевые файлы + коммиты)

Коммиты на ветке `feature/edinyy-pomoshnik-arhitektura`: `f51e5a0e` (Ф4a) → `381b717c` (Ф4b) → `bffc7796` (Ф3) → `e5fb42d6` (Ф2a) → `6a430537` (Ф2) → `01bb3958` (Ф2c) → `a100f6bd` (Ф6) → `d9c306c5` (Ф5) → `8dac5210` (Ф1/Ф5).

- **Ф4a — single-pass retrieval chat-v2** (`f51e5a0e`, `knowledge-core/services/chat-v2.service.ts`): удалены методы `routeComplexity`/`planSteps`/`judgeSufficiency`/`retrieveWithOptionalPlan`; `topK` разнесён на `rag.k_retrieve` (30) / `rag.k_context` (18); переранжировщик `rag-rerank` оживлён (пул 30 > `rag.rerank_min_pool` 12, сужает 30→18) и накормлен summary+историей+вопросом+3 формулировками. Промпты `RAG_ROUTE`/`RAG_PLAN`/`RAG_SUFFICIENCY` оставлены exports в `prompts/rag-pipeline.prompts.ts` (консервация).
- **Ф4b — слитое понимание** (`381b717c`, `dialog-layer/services/query-plan-extractor.service.ts` + `dialog.service.ts`): `dialog-multi-query` + `dialog-extract-plan` → один вызов `dialog-understand` (метод `understand()`), kill-switch `rag.understanding_merged` (default ON; OFF → два прежних вызова).
- **Ф3 — петля уточнения** (`bffc7796`): синтез помечает переспрос токеном `[[CLARIFY]]` → `needsClarification` течёт `ChatV2Output→SynthesisResult→ChatAnswer→контроллер/SSE`; при нём groundedness-gate пропускается и `answerCache.set` обходится.
- **Ф2/Ф2a/Ф2c — single-pass Мастер** (`6a430537`/`e5fb42d6`/`01bb3958`, `concierge/services/concierge.service.ts`): убраны `for i<maxSteps`, loop-guard, `buildPartialAnswer`, сырой JSON-дамп; крутилки `concierge.max_steps`/`rag.loop_guard_threshold` удалены. Слой 1 (детерм. перехват) → Слой 2 (один диспетч-вызов `concierge-respond`) → Слой 3 (один проход). `answer` → chat-v2 `askEphemeral` в процессе, текст слово-в-слово; `action` → инструмент + render-вызов (`CONCIERGE_RENDER_SYSTEM_PROMPT`). Канальный clarify — Redis-ключ `concierge:clarify:<bindingId>` (`assistant-channel.bridge` + telegram/max адаптеры).
- **Ф6 — модели по агентам** (`a100f6bd`): сид `scripts/seed-llm-task-routes-edinyy-pomoshnik.ts` (5 агентов через `LlmTaskRoute`) + diag `scripts/diag-llm-routes.ts`. `concierge-respond`→`gpt-5.4-mini`; `dialog-understand`/`chat-v2`→`deepseek-v4-pro`; `rag-rerank`/`rag-groundedness`→`deepseek-v4-flash`.
- **Ф5 — ложное «Готово»** (`d9c306c5`): окно свежести implicit-матча probe `probe.implicit_match_max_age_days` (3 дня).
- **Ф1/Ф5 фронт** (`8dac5210`): «Память» = дверь к реестрам (`MemorySearch` удалён); `/chat-v2`+`/assistant` → redirect `/chat`; `eventTypeLabel` фолбэк latin_snake→«Уведомление»; видимые «Concierge»→«Мастер».

## Что вышло (документация — эта сессия)

Я делал **только документацию** по уже реализованному рефактору (код не трогал):

- `second-brain/02_architecture/knowledge-core.md` — §Б помечен «заменён single-pass» (история), добавлен §Б′ «Единый помощник» (Мастер 3-слой + chat-v2 4-вызова).
- `second-brain/02_architecture/module-map.md` — новая дат. секция «Единый помощник» (concierge single-pass / chat-v2 memoryless / dialog-understand / routes / фронт).
- `second-brain/01_projects/ai-jobs.md` — таблица rag-taskType: `rag-route`/`rag-plan`/`rag-sufficiency` помечены «законсервированы», добавлены строки `chat-v2`/`dialog-understand`, инвентарь ~10→4, карта моделей Ф6.
- `second-brain/01_projects/concierge-agent.md` — Pipeline-секция переписана на single-pass (3 слоя).
- `second-brain/01_projects/frontend-pages.md` — `/chat-v2`+`/assistant` redirect, `/memory`=дверь, дат. changelog-строка.
- `second-brain/04_не-сделано/README.md` — строка про схлопывание 3 движков чата (`chat-surface-convergence`); строка про консервацию итеративного поиска уже была.
- `docs/operations/prod-deploy-log.md` — блок «Единого помощника» расширен с Ф6 на Ф2–Ф6: добавлены 4 новые крутилки (`rag.k_retrieve`/`rag.k_context`/`rag.understanding_merged` в `seed-admin-setting-smart-search.ts`; `probe.implicit_match_max_age_days` в `seed-admin-settings.ts`) + frontend rebuild + smoke.

Верификация фактов против кода (vexp заблокирован — grep+Read): убедился, что route/plan/sufficiency-методы удалены из `chat-v2.service.ts`, промпты сохранены как exports, `dialog-understand` taskType + `rag.understanding_merged` knob существуют, 4 крутилки сидятся зарегистрированными в STEPS сидами, route-сид соответствует ТЗ §5.

Бэкенд-тесты (со слов задачи) 6503/6505 зелёные (2 env-фейла в нетронутых модулях); фронт typecheck/lint — 0 ошибок.

## Чему научился

- **Passthrough — это правило, а не частный случай.** Текст синтеза отдаётся слово-в-слово для всего `answer`-пути: иначе порвутся маркеры `[BLOCK:id]`, а повторная обработка GPT-5 mini рискует вернуть выдумку, которую уже отсёк контролёр заземления.
- **Render-вызов с отдельным промптом** (`CONCIERGE_RENDER_SYSTEM_PROMPT`) для `action`-пути — чтобы статус действия не утёк сырым JSON (корень прод-бага был именно в смешении «ответа» и «дампа инструмента»).
- **Memoryless `askEphemeral`** — chat-v2 как движок не держит свою `ChatV2Conversation`; тред один и принадлежит Мастеру, история+summary передаются на каждый вызов. Меньше состояния — меньше рассинхронов.
- **Kill-switch на слияние понимания** (`rag.understanding_merged`) — слияние 2→1 вызова рискованное (один вызов определяет весь поиск), поэтому старый двухвызовный путь сохранён как fallback за рубильником.
- **Документация vs прод-лог.** Блок прод-лога «Единого помощника» был заведён только под Ф6 (routes, «изменений app-кода нет») — но 4 новые AdminSetting-крутилки из Ф4/Ф5 нигде не были задокументированы. Урок: при отдельных фазах одного рефактора проверять, что прод-операции ВСЕХ фаз (а не только последней закоммиченной) попали в `prod-deploy-log`.
- **Фронт FAB/колокольчик уже были сделаны** параллельной сессией (2026-06-20) — Ф1 в основном свелась к редиректам + «Память»=дверь; полная конвергенция 3 движков отколота под визуальную приёмку отдельным ТЗ (`chat-surface-convergence`).
