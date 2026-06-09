---
date: 2026-06-09
title: Query Understanding Волна 1 — Tier 0 (понимание структуры запроса) + Tier 1 (recall-safe структурный фильтр)
tags: [chat-v2, dialog-layer, knowledge-core, retrieval, query-understanding, llm-router, ship-on]
distilled: false
---

# Query Understanding Волна 1: понимание структуры запроса + recall-safe фильтр

## Что было поставлено

ТЗ [`plans/tz/2026-06-10-query-understanding-tier0-tier1.md`](../../plans/tz/2026-06-10-query-understanding-tier0-tier1.md) — Волна 1 (Tier 0 + Tier 1, 5 фаз, весь бэкенд, **без миграций БД**).

Боль (по коду, verified): chat-v2 retrieval ранжировал только по смыслу (cosine+BM25+1-hop граф), а dialog-layer извлекал лишь `intent`. Темпорально-структурный запрос («что мы решали по маркетингу на этой неделе?») молча деградировал — слова уходили в эмбеддинг, фильтра не было, мог вернуться ответ трёхмесячной давности по другому отделу. Для не-разработчика тихая ошибка дороже, чем для dev-инструмента.

Цель: чат понимает **структуру** вопроса (период / тип сигнала / ветка-тема / сущность / «я» / «сейчас») и применяет её как **recall-safe структурный фильтр** поверх графа — вместо чистого смыслового сходства; при пустом результате честно «в памяти нет», без выдумки.

## Как решал

Оркестрация фаза→кодер→независимая приёмка (греп+re-Read+typecheck/build/тесты)→коммит, без остановок между фазами.

- **Ф1 (`150786bd`) — Tier 0 извлекатель + резолвер.** `QueryPlanExtractorService` (`backend/src/modules/dialog-layer/services/query-plan-extractor.service.ts`): один LLM-вызов `dialog-extract-plan` (primary `deepseek-v4-flash`, Р9) → `QueryPlanFilters` (период-токен + signalTypes + themeBranches + entityHints + personScope + aggregation + needsAction + activeNow), санитизация ответа по runtime-наборам enum (`SignalType`/`ThemeBranch`), fail-open при ошибке/битом JSON/`confidence < QUERY_PLAN_MIN_CONFIDENCE=0.6`. Детерминированный `period-resolver.ts` (токены this_week/last_week/yesterday/today/this_month/last_month/last_n_days/none → `[dateFrom,dateTo]` в Europe/Moscow, фикс. UTC+3, без date-библиотек, чистая функция — «сегодня» приходит параметром). Промпт `extract-plan.prompt.ts` (cache-friendly: стабильный SYSTEM + injection-guard, вопрос в конце USER за data-маркерами).
- **Ф2 (`a3be674b`) — проброс + резолв.** `DialogProcessResult.structuralFilters` (`StructuralRetrievalFilters`: dateFrom/dateTo/signalTypes/entityIds/themeBranches/bitemporalActiveOnly) протянут `SynthesisInput → ChatV2Input → RetrievalInput`. `resolveStructuralFilters` (не мутирующий read): entityHints → `Entity.id` по canonicalName/aliases; personScope → `Person.entityId` спрашивающего (userId из сессии, не из текста) и сворачивается в тот же entity-фильтр; activeNow → bitemporalActiveOnly. Любая ошибка БД → null (без фильтра).
- **Ф3 (`51ec0ff7`) — recall-safe ретрив.** `ChatV2RetrievalService.rankByStructuralFilter`: при `hasStructuralFilter` — полный точный скан WHERE-фильтрованного пула с `ORDER BY score DESC` (вычисляемый алиас cosine), **НЕ** HNSW `embedding<=>qvec LIMIT`. Предикаты (`buildStructuralPredicates`): дата по `IdeaBlockEvidence.sourceTimestamp`, signalType, entity (EXISTS по `IdeaBlockEntity`), тема (`ThemeIdeaBlock`+`Theme.branch`), bitemporal `validUntil IS NULL`. Graph-расширение при фильтрации пропускается; нефильтрованный путь байт-в-байт прежний (R9). qvec нет (эмбеддинг упал) → recency-fallback с теми же предикатами.
- **Ф4 (`929308d9`) — честный пустой ответ.** Применён фильтр + пустой пул → «По заданным условиям (…) в памяти ничего не нашлось» без LLM-синтеза (хелпер `describeStructuralFilters`, R10). Тест `chat-v2-empty-pool-message.spec.ts`.
- **Ф5 (метрики, pending) — наблюдаемость.** `z_query_plan_extraction_total{result}`, `z_query_plan_retrieval_filtered_total{filtered}`, `z_query_plan_empty_pool_total{result}`.
- **Флаг** `QUERY_PLAN_EXTRACTION_ENABLED` (kill-switch ON, Ship-On — строка в `docs/operations/feature-flags.md`). Маршрут засеян `seed-llm-task-routes-dialog-extract-plan.ts` (в `apply-prod-deploy.ts` STEPS).

## Что вышло

- `bun run typecheck` и `bun run build` — зелёные.
- vitest по фазам зелёные: резолвер периода (границы недель/месяцев, `last_n_days`, фикс. UTC+3), санитизация плана (битый JSON / невалидные enum / low-confidence → fail-open), `hasStructuralFilter`, честный пустой ответ (`chat-v2-empty-pool-message.spec.ts`).
- Без миграций БД, без новых очередей — извлечение синхронно в пути чат-запроса.

## Чему научился

- **Recall-safe = `ORDER BY` вычисляемого score, а НЕ HNSW `... LIMIT`.** Жёсткий pre-filter на HNSW-пробе роняет recall на узком окне (период/отдел); полный точный скан WHERE-фильтрованного пула с `ORDER BY cosine` — нет. Org-пул Коры мал (≤тысяч блоков, capped), скан дёшев. Донор уже был в коде — `SearchService.runHybridQuery` (`/search`).
- **Детерминированный резолвер периода вместо «доверять датам LLM».** LLM возвращает символический токен (this_week/…), границы считает чистая функция на `Date.UTC` — нет date-библиотек, нет недетерминизма, тесты тривиальны. «Сегодня» приходит параметром (чистота).
- **personScope «я» сворачивается в entity-фильтр через `Person.entityId`.** «Я/мой/мне» — это не текст, а userId из сессии → `Person.entityId` → попадает в тот же `entityIds`-фильтр. Никакого отдельного person-канала в retrieval.
- **Fail-open на каждом шаге — дешёвая страховка.** Ошибка LLM, битый JSON, низкая уверенность, ошибка БД при резолве — везде «вернуть пустой план / null, поиск как раньше». Лучше «не сузить», чем «потерять релевантное»; цена тихой ошибки для не-разработчика максимальна.
