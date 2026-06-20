---
title: Разводка idea↔decision + Карта целей — реализация двух ТЗ
date: 2026-06-20
type: реализация
tz:
  - plans/tz/2026-06-20-idea-vs-decision-disambiguation.md
  - plans/tz/2026-06-20-goals-map-and-ideas-tz.md
branch: feature/idv-and-goals-map → dev
---

# Что было поставлено

Реализовать последовательно два ТЗ через скилл-оркестратор (tz-orchestrator), без возврата к владельцу с вопросами:
1. **idea-vs-decision** (Ф1–7) — конвейер путал «идею» и «решение» → дубли (idea+decision на одно) и тихие потери решений.
2. **goals-map-and-ideas** (Ф1–5) — новая вкладка «Карта» в `/goals`: радиальная strategy-map + слой идей + «принять идею → цель» + AI-подсказка родителя для orphan.

Финальный коммит/push — в ветку `dev`.

# Как решал

**Картография первой** (Workflow, 5 параллельных читателей) — line-номера в ТЗ устарели после свежих коммитов T5/T2/T4 (надёжность записи, регламенты уже в dev). Это окупилось: вскрыло несколько расхождений ТЗ↔код (см. уроки).

**Фазами, гибрид сам/суб-агенты:** промпты, сиды, схему/миграцию, backend-эндпоинты, идемпотентные writer'ы — писал сам (контроль формулировок и read-only/RBAC/409-гарантий критичен). Крупные frontend-куски (GoalsMapView ~radial-canvas, слой идей, orphan-UI) — суб-агентам с исчерпывающим контрактом + жёсткая приёмка (грепы инвариантов токенов, build, re-Read). Коммит по фазам (10 коммитов).

# Что вышло

10 коммитов `a148b755`..`2264c3aa`. Все приёмки зелёные: typecheck (backend+frontend), lint 0 errors, build (DI/декораторы), снапшоты промптов (обновлены, diff чистый), unit-тесты (markRealizedByDecision/reconcile 8, promoteToGoal 5, goal-map 12, goal/idea мапперы). Прод-инструкция — `docs/operations/prod-deploy-log.md` (миграция авто + patch в STEPS + smoke).

# Чему научился (уроки)

- **Модель LLM для taskType живёт в таблице `LlmTaskRoute` (tier-форма в `seed-llm-task-routes-default.ts`), НЕ в AdminSetting и не в хардкоде.** ТЗ idv Ф2 говорил «AdminSetting + code-fallback» — реальность иная. Картография спасла от неверной реализации. Смена модели = правка tier-сида + идемпотентный patch (уважает `editedByAdmin`). `refreshCache` берёт tier-записи приоритетнее legacy JSON.
- **`DECISION_DISCRIMINATOR` контрпродуктивен для `idea-extract`.** Он содержит «признак разовости → НЕ извлекай как норму/решение/черту», а idea-extract намеренно ловит разовые предложения. Подключил discriminator только к `block-ingest`/`decision-extract`; idea-extract закрыл точечным гейтом Ф1. Буквальное следование ТЗ («обернуть все три») дало бы регресс ловли идей.
- **`hierarchyArbiter` (specialist-3-14) отбрасывал `reasoning`/`confidence` из LLM-ответа.** Для suggest-parent расширил `HierarchyVerdict` аддитивно (прокинул их) — `processBlock` не задет, новый промпт не нужен (reuse `goal-hierarchy-link`).
- **`KnowledgeCoreModule` — `@Global`**: его экспортируемые провайдеры (`Specialist314GoalsService`, `Specialist36Service`) доступны в любом контроллере/сервисе через `@Optional @Inject` без явного импорта модуля. Так goals.controller получил suggest-parent, а ideas.service — Specialist36, без правки `imports:`.
- **Снапшот-тесты промптов** (`*.snapshot.spec.ts`) фиксируют точный текст SYSTEM — любая правка промпта ломает их → `bunx vitest -u` в том же коммите + ревью diff `.snap` (только добавленный текст).
- **strict-TS и моки vitest:** `mock.calls[0]?.[0]` падает на `vi.fn(async () => …)` без параметров (пустой tuple) → давать фиктивный параметр `vi.fn(async (_a: unknown) => …)` или приводить через `as unknown`. `toHaveBeenCalledWith(expect.objectContaining(...))` вместо ручного доступа к calls.
- **import-order (`import-x/order`)** имеет тонкую группировку по глубине пути — ручные пустые строки конфликтуют; надёжнее `eslint --fix`.
- **`tsc --noEmit` иногда падает OOM (code 134, V8 allocation)** на большом backend — транзиентно; `NODE_OPTIONS="--max-old-space-size=8192"` снимает.
- **writer-слой уже идемпотентен** (T5/T2): не дублировал dedup; Ф5/Ф6 — аддитивная связь `realized_as` поверх готового каркаса.

# Combined-разборщик включён ВКЛЮЧЁННЫМ (гибрид, владелец потребовал Ship-On)

После выката владелец потребовал включить combined-разборщик глобально, без ручных действий. При попытке включить вскрылось:
- **producer combined не подключён** — метод `enqueueSpecialistsCombined` нигде не вызывался: combined-worker написан, но в конвейер не встроен (флаг сам по себе ничего не активировал);
- **combined покрывает 9 из 12 специалистов** — вне его: goals(3-14), project-customer(3-4), personal-relation(3-12). «Просто заменить всех» = потеря этих 3 типов; «параллельно» = ×2 стоимость на 8 типах.

**Решение — гибрид (доказано таблицей вариантов):** combined берёт 9 single-pass-извлекателей одним вызовом; 3 multi-step (резолюция/KNN/иерархия сверх извлечения) остаются раздельными — их нельзя свернуть в один проход без потери логики. Реализация: `RouterService.COMBINED_COVERED` (9) + фильтр в `dispatch` (при ON убрать 9, оставить 3); `block-distill.worker` ставит combined per-meeting с барьером-паузой `SPECIALISTS_COMBINED_DELAY_MS` + дедуп по встрече (поздние блоки до-запускают сами, combined идемпотентен — отдельный reconcile не нужен); флаг `SPECIALISTS_COMBINED_ENABLED` default true. Фильтр — по специалисту-получателю, НЕ по signalType (один сигнал `fact` идёт и к combined-covered knowledge-clone, и к keep project-customer). 4 unit-теста на гибрид. Урок: «включить флаг» ≠ «фича работает» — проверяй, вызывается ли producer и покрывает ли подсистема весь объём.

# Прочие открытые хвосты
- **suggest-parent без отдельного unit-теста** — тонкая read-only обёртка над уже протестированными `knnCandidates`/`hierarchyArbiter` + простой BFS-обход потомков; приёмка статическая (read-only код-факт + typecheck/build).
- Боевая проверка эффекта (дубли→0, рост доли решений, idea:decision-перекос) — ship-and-observe через `diag graph` после выката.
