---
date: 2026-06-30
type: история
tags: [goals, planning, tz, architecture, second-brain]
---

# Планирование: консолидация движка целей (goals-engine-consolidation)

## Что было поставлено
Владелец попросил большой разбор всего, что касается сущности «цель» (какие агенты создают, где дашборд, что когда считается), потом — в обсуждении — упростить машинерию целей. По ходу уточнил: **упрощаем = оптимизируем/наводим порядок, НЕ удаляем фичи** (особенно дифференциатор «вектор людей: кто пашет, но не к цели»). Итог — пройти цепочку анализ → архитектура → ТЗ.

## Как решал
- **2 параллельных fan-out (Workflow)**: (1) картография 8 фоновых агентов целей по подсистемам — модель, извлечение, граф-связи, OKR, дашборд, операции/трекер, фронт + верификатор расписаний; (2) контракт-якоря под ТЗ по O1–O10 (точные `path:line`, сниппеты, развилки).
- **Разговор с владельцем** развёл путаницу: ДВА `strategic-alignment` (knowledge-core продюсер `0 4` UTC vs goals issue-based `0 6`), ДВА «вектора» (движение цели → компас vs вклад людей → экран исполнения).
- **Скилл-цепочка:** анализ `plans/analysis/2026-06-29-goals-engine-consolidation.md` → `solution-blueprint` (архитектура, approved владельцем «пиши тз») → `tz-author` (ТЗ, 9 фаз).
- **Проверка пересечения с ТЗ извлечения** (`2026-06-30-extraction-layer-rewrite.md`): цели вне `COMBINED_COVERED` → не конфликтует, зафиксировал граничный контракт.
- Коммит `82e39e87`, ветка `work/2026-06-29`.

## Что вышло
3 документа (анализ / архитектура-approved / ТЗ-ready-to-implement) запушены. Кода нет — чистое планирование. ТЗ: 9 фаз, машинно-проверяемая приёмка, граничные контракты с чисткой обещаний и ТЗ извлечения.

## Чему научился (факты по коду — кандидаты в code-pitfalls)
- **Цели архитектурно отделены от combo:** специалист `3-14-goals` НЕ в `COMBINED_COVERED` (`router.service.ts:84-98` — три multi-step специалиста project-customer/personal-relation/goals делают резолюцию/иерархию сверх извлечения). Combo извлекает 8 сущностей + tasks, целей среди них нет. Маршрут `commitment/plan_item → GOALS` (`router:426-428`).
- **Баг тайминга компаса:** продюсер движения `knowledge-core/strategic-alignment.cron` бьёт `0 4` UTC = 07:00 МСК — ПОСЛЕ сборки дневного дайджеста `operations-daily-digest.cron` `0 3` UTC = 06:00 МСК. Компас утром показывает вчера.
- **Дыра ручных целей:** `goal-theme-linker.cron` берёт только `source:'ai'`+`sourceBlockIds`; `linkGoalThemes` hard-return без `sourceBlockIds`; `strategic-alignment.worker` skip `no_themes`. → ручная цель без тем не попадает на компас. Лечится KNN `Goal.embedding → Theme.embedding` (HNSW-индексы уже есть).
- **Мёртвый `GoalCascadeService`** — `onChildCompleted`/`onParentMissed` только в `.spec`. Подключается через доменное событие `goal.status_changed` (паттерн `idea.status_changed`).
- **Задачное alignment уже не на компасе** — компас на графовом `cachedAlignment`; виджеты `StrategicAlignmentWidget`/`GoalVectorVerdictWidget` осиротели (0 импортов).

## Поведенческие уроки (вынесены в memory)
- `feedback_discussion-text-not-buttons` — в исследовательском диалоге не звать AskUserQuestion; варианты текстом + рекомендация.
- `feedback_simplify-means-optimize-not-delete` — «упрощаем» = консолидация/дубли/дыры, не выключать фичи; дифференциаторы не трогать.
