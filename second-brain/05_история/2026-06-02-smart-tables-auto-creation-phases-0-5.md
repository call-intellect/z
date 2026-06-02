---
date: 2026-06-02
title: Smart-tables auto-creation — реализация всех фаз (0–5 + eval 1.5) как агент-оркестратор
tags: [smart-tables, knowledge-core, orchestration, llm, document-ingest, privacy]
---

# Smart-tables auto-creation — Фазы 0–5 + Eval (1.5)

## Что было поставлено

Реализовать ТЗ [`plans/tz/2026-06-02-smart-tables-auto-creation.md`](../../plans/tz/2026-06-02-smart-tables-auto-creation.md) целиком, в роли **агента-оркестратора** (промпт `...-orchestrator-prompt.md`): не писать код руками, а вести реализацию через фазы — изучать код, формулировать точные задачи кодящим суб-агентам, верифицировать результат, двигаться дальше. Владелец по ходу снял «остановки между фазами»: коммитить автономно, идти до полного выполнения, развилки решать самому с обоснованием.

## Как решал (фазы → коммиты)

Каждая фаза: `Explore` (карта файлов) → закрытие развилок → промпт кодеру (`general-purpose`) → **личная верификация** (grep маркеров, re-Read, typecheck, тесты) → обновление second-brain + prod-deploy-log → коммит.

- **Фаза 0** `ff7adff` — 10 системных таблиц при `Org.create`: `Table.isSystem/systemKey`, `system-tables.catalog.ts`, `TablesAutoProvisionService` (идемпотентный), hardDelete-guard `403 system_table_hard_delete_forbidden`, backfill, фронт-маркер 🔒.
- **Фаза 1** `ed45aee` — Text-to-Schema через Concierge: 3-pass (`table-infer-schema`→`architect-pass`→`entity-check`, DeepSeek V4 Pro), `/tables/infer-schema` + `/from-schema` за feature-flag `feature.tables_text_to_schema` (default off), concierge-tool + SSE `tool_result.data`, `TableSchemaPreview`.
- **Фаза 2** `a83fe83` — graph-driven rows: завёл шину событий Entity (`entity.created/updated/archived` через EventEmitter2), очередь `tables.sync` + `table-sync.worker`, `entitySync.entityTypes`, read-only attribute-колонки (`config.source='entity'`, guard `422 table_cell_readonly`).
- **Фаза 3** `46153df` — Event-to-Cells: модели `TableCellProvenance`/`TableCellPendingPatch`, событие `meeting.ai_ready` → `tables.enrich` → `table-enrich.worker`, авто-патч пустых ячеек (conf≥0.85) + очередь подтверждений, provenance/undo UI, ProactiveNotification.
- **Фаза 4** `f81684b` — Document-to-Table: **exceljs** (решение владельца — пока Node, не Python-DCS), parser + cosine-dedup + entity-linking + UI «Из файла».
- **Фаза 5** `e2e5339` — NL Saved Views: `table-semantic-filter` (Flash) + Redis-кэш, **впервые применение фильтров** (`applyFilters` клиент-сайд, 10 операторов), `SemanticFilterBar`.
- **Фаза 1.5** `664f3d4` — eval Text-to-Schema: 102 русские фикстуры + метрики (F1/type/entity-binding/hallucination) + 124 offline-теста + runner (прогон против LLM = финальный gate флага).

## Что вышло (верификация)

- Backend: ~97 tables-тестов + 124 eval-теста, оба typecheck зелёные, lint чист в своих файлах.
- **Adversarial multi-agent ревью** (Workflow, ultracode) для Фаз 4 и 5: 6 и 3 измерения → независимая верификация находок → **24 подтверждённых бага закрыто** до коммита (тихая потеря >500 строк при импорте, multer-DoS, обход `TABLE_MAX_ROWS_PER_TABLE`, рассинхрон валидации фильтров фронт↔бэк, N+1, и др.).
- Push: 5 коммитов (Фазы 2,3,4,5,1.5) → origin (Фазы 0,1 уже были на origin через push параллельной сессии).

## Чему научился / грабли

1. **Агенты врут про `[x]` и про «уже сделано».** Кодеры не раз заявляли о правках/тестах, которые надо было перепроверять; 1b-кодер Фазы 1 утверждал, что SSE-поле `data` «уже было» — оказалось правдой, но проверять обязательно. Вывод подтверждает [[feedback_agents_can_lie_about_edits]]: после каждого агента — grep маркеров + личный typecheck/тесты.
2. **Параллельная сессия в общем репо — постоянный фон.** Всю работу шли чужие коммиты (expert-clones, admin-ui localization, goals-okr, action-center) и untracked-файлы. Спасал железный приём: `git status --short | grep -v plans` + явный `git add` только своих путей, проверка `git diff --cached --name-only | grep -c plans == 0` перед каждым коммитом. Ни один чужой файл не утёк. См. [[feedback_parallel_sessions_git_check]], [[feedback_git_index_hygiene]].
3. **Adversarial-ревью Workflow ловит то, что зелёные тесты пропускают.** Контрактные рассинхроны фронт↔бэк (rows≤500, op×type) и security (multer без limits, мёртвый ThrottlerGuard) — не видны юнит-тестами, но фатальны. На больших фичах ревью-воркфлоу окупается.
4. **Архитектурный долг лучше фиксировать явно, чем тихо обходить.** exceljs vs Python-DCS: правильное решение (DCS уже спроектирован в document-ingest ТЗ, smoke-тестирован) владелец отложил → оставили exceljs как **задокументированный stopgap** с долгом, а не «как будто так и надо».
5. **vexp не запущен → grep разрешён.** Хук блокирует grep только при активном демоне; в этой сессии демона не было, исследование шло через Read/Grep/Explore.

## Долг / открытое

- **ThrottlerGuard не зарегистрирован глобально** (HIGH) — все `@Throttle` в проекте инертны, включая защиту login/register от брутфорса. Свой LLM-эндпоинт закрыл точечным guard'ом; общую дыру эскалировал владельцу отдельной задачей.
- Фаза 1 feature-flag **off** до прогона eval (1.5) против LLM-прокси.
- Фаза 4: миграция парсинга на DCS + PDF/сканы/HTML.
- Фаза 5: серверная фильтрация по cells (GIN) для масштаба.
- Поток Privacy (Б13) — research до GTM (выполняется отдельным шагом).
