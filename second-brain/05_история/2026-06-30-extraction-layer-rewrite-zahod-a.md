---
date: 2026-06-30
type: reflection
feature: extraction-layer-rewrite
branch: work/2026-06-29
distilled: false
---

# Рефлексия — переписывание извлекающего слоя, заход A (Ф1–Ф10 + Ф12a, оркестрация)

## Что было поставлено

ТЗ `plans/tz/2026-06-30-extraction-layer-rewrite.md` — заход A: превратить объединённый разборщик `specialists-combined` из A/B-эксперимента в **связный общий агент** разбора разговора. Тонкая «приёмная» (нарезка по репликам + сшивка нити) → один связный проход по полному разговору достаёт массу сущностей графа → несколько глубоких узких дериверов. Принцип **build-then-delete**: новое строим сразу включённым, старое сносим только после доказанного паритета (снос отложен в пост-прод).

10 фаз + Ф12a:
- **Ф1** — рубильник combo в AdminSetting + `zBool`-фикс + крутилки нарезки на `resolveSync` + 5 новых крутилок + регистрация taskType `meeting-skeleton`.
- **Ф2** — канало-агностичный combo (chat/chatbox/Bitrix, контекст из `RawEvent`).
- **Ф3** — combo воспроизводит 4 побочки (rebuild профиля/навыков, гигиена решений, ProcessTemplate через раздельный process-detector).
- **Ф4** — few-shot реестр определений всех 57 `signalType` (43 немых обучены, friction team/process) + страж enum↔реестр.
- **Ф5** — нахлёст окон + позиция «фрагмент N из M» + gleaning + дедуп на стыке.
- **Ф6** — `MeetingSkeletonService` → «Карта встречи» в шапку окна.
- **Ф7б** — привязка регламентов/инструкций в combo (scope роли + владелец) + backfill.
- **Ф8** — хроносверка: `sourceTimestamp` во вход арбитра фактов/решений.
- **Ф9** — граф-детектор конфликтов «автор↔стороны» + пороги в AdminSetting.
- **Ф10** — тесты дедуп-guard me-tasks + метрика.
- **Ф12a** — метрики наблюдения нового пути.

Отложено: Ф7 (combo эмитит `tasks[]` — заход B, зависит от ТЗ задач), Ф11 (снос обходчиков — пост-прод после прод-паритета).

## Как решал

Оркестратор + суб-агенты по фазам с независимой приёмкой. Ключевые развилки решены ДО кода в ТЗ:
- **Вариант A по Opus (решение владельца):** постановка Claude Opus primary на `block-ingest` ОТМЕНЕНА. Движок остаётся `deepseek-v4-pro`. Причины: (1) инфра-стандарт «DeepSeek primary везде, НЕ anthropic»; (2) `anthropic.maxDataClass='sensitive'`(2) < `private`(3) → на private-данных Opus молча отфильтровывается в `llm-router.service.ts` (dataClass-фильтр); (3) block-ingest — самый частый LLM-вызов (дорого). Качество дала модель-агностичная связка Ф4+Ф5+Ф6.
- **Отложенные сносы без A/B:** владельцу недоступно параллельное A/B → старое не сносим вслепую. Страховка = рубильник + метрики + разовая проверка глазами (Ф10, прод-шаг). Раздельные специалисты и regex-крон конфликтов = активный фолбэк до доказательства паритета.

Коммиты (ветка `work/2026-06-29`):
- Ф1 `41736929`, Ф2 `4ef38e72`, Ф3 `396c7fdd`, Ф4 `eb7278fc`, Ф5 `abd365d1`, Ф6 `fd7b6d9b`, Ф7б `013f5f0e`, Ф8 `33fadd36`, Ф9 `ef1e2f50`, Ф10 `99c910b6`, Ф12a `c8fef016`; ТЗ-amendment `e3140609`.

## Что вышло

- Все 10 фаз + Ф12a реализованы и закоммичены; типичные прогоны тестов зелёные (typecheck/lint/build + затронутые vitest).
- Combo — основной путь (ВКЛ по дефолту через AdminSetting `knowledge.specialists_combined_enabled`).
- **Миграций БД НЕТ** (enum `SignalType` не трогали, скелет in-memory, scope-колонки регламентов уже были).
- 10 новых AdminSetting-крутилок (3 kill-switch тип A + 7 knob) + маршрут `meeting-skeleton` (дешёвая модель, НЕ anthropic) + 1 идемпотентный backfill `backfill-regulation-scope-normalize.ts`.
- Новые метрики: `kc_meeting_skeleton_total{outcome}`, `kc_block_gleaning_rounds_total`, `kc_block_gleaning_blocks_total`, `kc_block_overlap_dedup_total` (+ существующие `task_dedup_suggested_total`, `regulation_scope_*_unresolved_total`, `personal_relation_builder_runs_total{source}`).
- Документация: `second-brain/02_architecture/knowledge-core.md` (новая секция + исправлено устаревшее «combined не включён»), `01_projects/ai-jobs.md` + `workers-queues.md`, `module-map.md`, `docs/operations/prod-deploy-log.md` (новый блок), `docs/operations/feature-flags.md`, `04_не-сделано/README.md` (отложенные сносы + заход B + EXPLAIN fact-supersede).

## Чему научился

- **dataClass-фильтр анти-anthropic.** `anthropic.maxDataClass='sensitive'` < `private` → любой Opus/Claude-маршрут на private-данных молча выпадает на фолбэк. Ставить Claude primary на private-горячий путь бессмысленно — он не доедет. Это инфра-инвариант, не предпочтение.
- **`DashboardModule` не `@Global`.** Чтобы combo (knowledge-core) дёргал `enqueueDecisionHygiene` из `DashboardQueueService`, пришлось добавить `DashboardModule` в `imports` `KnowledgeCoreModule` — DI не подтянул бы сервис иначе.
- **persist без идемпотентности на стыке окон → нужен in-memory дедуп.** Нахлёст окон (Ф5) плодит дубли блоков на стыке; дедуп по `(signalType + evidenceQuote/startMs)` делаем в памяти после `extractFull`, до записи — дешевле и не требует уникального индекса в БД.
- **FK `IdeaBlockEvidence.blockId`.** Хроносверка Ф8 читает `sourceTimestamp` через `IdeaBlockEvidence` (LATERAL) — стоит проверить EXPLAIN на реальных данных (отложено в `04_не-сделано`), новый LATERAL по evidence может деградировать с ростом истории.
- **`z.coerce.boolean` — ловушка для off-флагов.** `z.coerce.boolean('false')` даёт `true` (непустая строка). ENV-рубильники с дефолтом ON, которые «нельзя выключить через .env», почти всегда из-за `z.coerce` вместо `zBool`. Проверять при любом «флаг не выключается».
- **Ключи AdminSetting смешанные (snake_case + camelCase).** В одном заходе соседствуют `knowledge.skeleton_pass_enabled` (snake) и `knowledge.skeletonMinSegments` (camel) — это исторический разнобой реестра, не баг; при доках сверяться с фактическим registry, а не угадывать.
