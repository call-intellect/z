---
date: 2026-06-08
title: Доделать остаток цепочки агентов встречи — без golden (выкат + наблюдение прода)
tags: [knowledge-core, ai, tracker, goals, llm-router, vox, оркестрация]
distilled: false
---

# Остаток цепочки агентов встречи — реализация без golden

## Что было поставлено
ТЗ [`plans/tz/2026-06-08-agent-chain-remaining-no-golden.md`](../../plans/tz/2026-06-08-agent-chain-remaining-no-golden.md) — доделать 7 пунктов, отложенных в батче retest2 «до golden-прогона». **Решение владельца: golden НЕ делаем** ([[feedback_no_golden_ship_and_observe_prod]]) — реализуем → выкатываем → смотрим прод напрямую (diag + метрики Ф0). Жёсткий гейт только инженерный: `typecheck`+`build` зелёные. Рискованное/недетерминированное — за feature-flag с безопасным дефолтом. Вёл как `tz-orchestrator` (картография реального кода → самодостаточные промпты кодерам → независимая приёмка САМ → коммит по пунктам). Порядок: 7→2→1→4→3→6→5.

## Как решал (по пунктам, коммиты)
- **Item 7 — TZ B Фаза 4 хвост** (`c457403d`): Express 5 named-wildcard `forRoutes('{*path}')`/`'api/v1/{*path}'` (убрал boot-WARN `LegacyRouteConverter`; рантайм идентичен — доказано чтением `node_modules/@nestjs/core/router/legacy-route-converter.js`); JSON-резилиенс (`tryParseJson`+ретрай×2+`validate`) в `intake-auto-triage.worker` & `meeting-speaker-analyzer.worker` по эталону entity-graph. ollama-401/forced-tool_choice — ops/наблюдение (владелец).
- **Item 2 — Ф1 idea direct-path** (`7430162e`): `block-ingest.worker` материализует тонкую Idea из `signalType='idea'` (за `knowledge.ideaDirectPathEnabled`, default ON, переиспользует embedding блока) + БЕЗУСЛОВНЫЙ guard в `specialist-3-6-ideas` по `sourceBlockId` (обогащает, не дублирует). Анти-дубль решён детерминированно, не KNN.
- **Item 1 — Ф2 C2–C8 промпты** (`0c283e60`+`6dd216f5`+`0dfe170f`): ASR/calibration/анти-галлюцинация имён/meetingDateIso/C8/C3 — разнёс на 3 непересекающихся по файлам кодера (meeting-context / экстракторы / булев гейт). Калибровку добавлял ТОЛЬКО где есть числовой `confidence` (иначе мёртвый текст). C3 гейт — только decision/idea (у них fallback), regulation/insight не трогал (нет fallback → recall-риск).
- **Item 4 — Ф5 Р2 task-dedupe** (`a933138e`): `MeetingTaskDedupeService` — embedding KNN in-memory (одним батчем) + LLM-арбитр `task-dedupe` серой зоны, non-lossy (удаляет только fast-черновик при наличии canonical). Флаг `meetings.taskDedupeEnabled` **default OFF** (data-affecting).
- **Item 3 — Ф4.1 goal-task-link** (`e174baaa`): `GoalTaskLinkerService` + cron (клон goal-theme-linker) + on-event в specialist-3-14. goal→sourceBlockIds→`IdeaBlockEvidence.rawEventId`→RawEvent→meetingId→ungoaled Issues → LLM-арбитр → `Issue.goalId` (non-destructive, race-safe `updateMany where goalId:null`). Флаг **default OFF**.
- **Item 6 — Ф6 smoke cache-WARN** (`f28200cb`): `z_llm_calls_total{provider}` (знаменатель) + `getLlmCacheHitRatio` + `checkCacheHitRatio` в provider-smoke-cron. **Решение Б (shared-prefix) осознанно отложено** — router-wide реструктуризация (роль SYSTEM→хвост USER), нужен прод-замер прокси cache_control + риск регрессии per-agent SYSTEM; зонтичное ТЗ само вынесло в отдельное `cache-prefix-everywhere`. Smoke-метрика — инструмент будущего замера.
- **Item 5 — TZ D Vox word-timings** (`accdfe7b`): прод-чтение `vox.no_words` (владелец дал «можно в прод», diag read-only) показало у `v3_e2e_rnnt` ключ **`extendedResult`** (нет segments/words). Расширил `parseVoxResult` на extendedResult (исход «а», безопасно) + диагностику +`extendedResultKeys`/`taskParamsKeys` (PII-safe) для решения б/в на след. встрече — без угадывания submit-параметра (прецедент `language→400`).

## Что вышло (верификация — приёмка САМ по каждому пункту)
- Каждый пункт: `git status` (только нужные файлы) + греп маркеров + re-Read критичной логики + **сам** прогонял `bun run typecheck` + `bun run build` + затронутые спеки. Все зелёные. Build (DI) критичен для item 3/4 (новые сервисы в @Global-модулях) — прошёл.
- Суб-агенты иногда корректировали ТЗ по факту схемы (rawEventId на `IdeaBlockEvidence`, не IdeaBlock; getter `knowledgeCore` не `knowledge`; calibration не нужна где confidence enum) — фактчек выявил, всё консистентно.
- Все 7 пунктов закрыты; частичные/отложенные честно в реестре «не-сделано» (Решение Б, C4-широкий few-shot, C3 regulation/insight, Vox б/в, ops-хвост, флипы флагов).

## Чему научился
- **No-golden ≠ безответственно.** Замена golden — прод-наблюдаемость (Ф0 уже на месте) + feature-flag с безопасным дефолтом + сам инженерный гейт. Для data-affecting (task-dedupe удаляет, goal-task пишет goalId) дефолт OFF, владелец флипает+смотрит; для recall-фиксов дефолт ON (idea direct-path).
- **Анти-дубль детерминированно, не вероятностно.** idea direct-path: guard по `sourceBlockId` (точный) надёжнее KNN — KNN-merge не сработает, если у direct-path идеи ещё нет embedding. Урок: дедуп двух путей материализации делай по стабильному ключу, не по сходству.
- **`tsc` (build) не валидирует DI-граф рантайма** — build зелёный ≠ DI резолвится. Митигировал клонированием доказанного паттерна (goal-theme-linker в том же модуле). Финальная DI-проверка — на бутстрапе прода.
- **Прод-чтение раньше угадывания.** Vox: вместо угадывания submit-параметра (риск 400) — прочитал прод-форму ответа, нашёл `extendedResult`, сделал безопасный парсер + усилил диагностику, чтобы СЛЕДУЮЩЕЕ чтение дало точный ответ для б/в. [[feedback_verify_framework_behavior_empirically]] распространяется и на форму ответа внешнего ASR.
- **Параллельная сессия в общем рабочем каталоге — реальный риск.** Docs-коммиты второй сессии (`f17f8fd9`/`aa8893b5`) оказались в предках моего HEAD (делим git HEAD). Спасло строгое явное стейджинг-перечисление путей в каждом коммите — чужие файлы не попали. На будущее: параллельные сессии — в отдельных worktree.
