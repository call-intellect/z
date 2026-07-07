---
date: 2026-07-04
title: Умные таблицы — восстановление связного слоя (строка↔граф) + гейтед извлечение
type: session-reflection
area: smart-tables
distilled: false
---

# Умные таблицы: из «плоского» graphSync в связный слой + починка доставки в ответ

## Что было поставлено
Владелец: «то, что сделано с умными таблицами — тупо и неправильно; восстанови исходный замысел; они должны быть реально умными как у конкурентов — хранить, связывать, идентифицировать к случаю. Двойная цель: (1) паритет с конкурентами, (2) улучшать ответ AI, подтягиваясь через поиск — но только релевантным. Сейчас маленький кусок кода наоборот рушит правильность ответа». Автономно: исследовать → доказать → написать ТЗ → код → коммит, «ко мне не приходишь».

## Как решал
1. **Восстановил замысел** из первого ТЗ [`plans/archive/2026-05-31-smart-tables.md`](../../plans/archive/2026-05-31-smart-tables.md): суть «умной» таблицы = решение **A5** «каждая строка привязана к Entity графа» (главный отличитель от Teamly), а не набор колонок.
2. **Диагноз по коду:** `TableGraphSyncService` создавал строку с `entityId: null` (жёстко), `sourceLink: null`, `fieldMap` копировал только `name`. Из-за `entityId=null` точный путь `fetchByEntityBridge` НИКОГДА не возвращал graphSync-строки → они шли в чат только сломанным keyword-путём (перехват колонкой «Что», нет морфологии, залив 20). Один корень (`entityId`) ломал обе цели.
3. **Research (2 workflow'а) + adversarial challenge (3 прохода):** конкуренты (Teamly/Attio/Notion/Dust/Hebbia) + как структурные данные грунтят ответ. Вердикт: СНАЧАЛА чинить модель данных (строка→Entity, строка→встреча), потом gating; не соревноваться в ширине конструктора БД (relation/rollup — у всех вручную, 0 вклада в recall), бить в связку граф+AI+провенанс. **Challenge поймал 4 фактические ошибки моего первого дизайна** (`mentionsCount` не на `IdeaBlockEntity`; `commitmentRecipient` fuzzy vs `Author` детерминирован; `RawEvent` без `meetingId`; `person`-ячейка ждёт `User.id`, не `Person.id`).
4. **Анализ** [`plans/analysis/2026-07-04-smart-tables-relational-restore.md`](../../plans/analysis/2026-07-04-smart-tables-relational-restore.md) + **ТЗ** [`plans/tz/2026-07-04-smart-tables-relational-and-gated-retrieval.md`](../../plans/tz/2026-07-04-smart-tables-relational-and-gated-retrieval.md) (3 фазы, детерминированные правила).
5. **Код (3 фазы, ветка `work/2026-07-02`):**
   - **Ф1** `chat-v2-table-context.service.ts` (переписан: gating-флаг `structuralIntent`, скоринг по name+description без generic-колонок + стоп-слова + морфология prefix-stem, cap-per-(entity,table), row-relevance, `sourceObjectId` для дедупа) + `chat-v2.service.ts` (`runTableBranch` fail-closed gating + `isStructuralTableIntent`; дедуп tableRows по source-block против contextBlocks) + `table-semantic-filter.service.ts` (select sourceObjectId). Топик-описания 10 таблиц в `system-tables.catalog.ts`. Крутилки + реестр + сид.
   - **Ф2** `table-graph-sync.service.ts`: `pickPrimaryEntity` (type>role>mentionsCount>entity.id ASC), `resolveEntityIds` (batch IdeaBlockEntity/Person/Goal/Experiment), `entityId` на create + `fillExisting` (null→value, human-provenance guard), `preferredEntityTypes` в каталог.
   - **Ф3** `loadBlockSources` (IdeaBlockEvidence→meeting deep-link через `buildProvenanceDeepLink`), `sourceLink`+`sourceLabel` в провенанс, ячейка «Источник» для «Обещаний».

## Что вышло (верификация)
- **typecheck + lint + build (heap 8GB) + 168 тестов зелёные** (добавил тесты pickPrimaryEntity, entityId-на-create, reconcile-fill, human-guard, sourceLink, gating, морфология, дедуп).
- **Живьём на «Стреле» (dev):**
  - `entityId` покрытие: **risks 27/27, ideas 17/17, promises 43/43 = 100%** (87 idea-строк связаны с Entity → entity-bridge зажёгся). hypotheses/okr null — у Goal/Experiment нет entity в графе (валидный null).
  - Проба выбора таблиц `_probe-table-context.ts`: **17/21 правильные** (было 4/21, почти все — не той таблицы). «Обещания» больше НЕ перехватывает риск/blocker-вопросы; blockers→«Реестр рисков», goals→«Цели и метрики»; вагые/фактовые → пусто (fail-closed).
  - sourceLink на 23 meeting-ячейках (deep-link `/meetings/.../result?t=`).
- **Остаток (owner-gate):** стенд-A/B recall (Проба B, статзначимость) для снятия прод-гейта; прод-backfill+seed; relation/rollup/views/мульти-person — отдельная волна.

## Чему научился
- **Adversarial challenge на СВОЙ дизайн до кода окупается кратно.** 3 плоских-текст агента поймали 4 фактические ошибки схемы (`mentionsCount`, `commitmentRecipient` fuzzy, `RawEvent.meetingId`, `person`=User.id) — каждая была бы новым багом «тупой» реализации. Плоский текст надёжнее ригидной JSON-схемы (competitorsGlobal + 3 challenge-агента упали на schema-retry-cap; плоские — прошли).
- **Один корень чинит оба слоя.** Владелец видел «таблицы вредят ответу»; я нашёл, что `entityId=null` одновременно (а) лишает строки связности/идентичности (замысел A5), и (б) убивает точный entity-bridge. Не два фикса — один.
- **Топик-описания = половина recall выбора таблицы.** Проба с одними именами таблиц: 4/21. С описаниями-синонимами: 17/21. Без «что мешает/блокирует/стопорит» в описании «Реестра рисков» blocker-вопросы не доходят.
- **Детерминизм в резолве обязателен.** Без финального тай-брейка `entity.id ASC` `entityId` строки прыгал бы между прогонами reconcile → ответ чата плавал бы. Стабильный порядок — не мелочь.
- **Порог score≥1 (не ≥2) для выбора таблицы** после очистки haystack от generic-колонок/стоп-слов: ≥2 душит короткие структурные вопросы (ровно те risks/goals, что хотим поднять). Морфология и gating калибруются вместе.
- **Ship-On, но метрикой, а не «залить всё».** Прод-гейт держим до стенд-A/B; проба A (детерминированная) — dev-гейт, проба B (LLM-судья, шумная) — стенд/владелец.
