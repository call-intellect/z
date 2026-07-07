# ПЕРЕДАТОЧНЫЙ ПРОМТ — Умные таблицы (доведение до пользы в recall)

> Самодостаточный брифинг. Прочитав ТОЛЬКО это + указанные файлы, ты можешь продолжить с нуля. Репозиторий Кора/Z, ветка **`work/2026-07-02`** (работать в ней, НЕ плодить ветки, НЕ сливать).

## 0. Твоя роль и цель
Ты — главный разработчик-оркестратор (скилл `tz-orchestrator`). Умные таблицы **построены и наполняются данными**, но замер доказал: **они пока НЕ поднимают recall чата «Мастер»** из-за бага выбора таблицы в чате. Твоя цель — **довести таблицы до реальной пользы в ответе** (чтобы структурные вопросы «кто-по-роли / когда / сколько / риски / обещания / цели» отвечались из таблиц), и **доказать замером**, что стало лучше (а не хуже).

**Жёсткие правила проекта:** читай `CLAUDE.md` + `.claude/CLAUDE.md`. Без комментариев в коде. Крутилки — в `AdminSetting` через `getDynamic`, не в ENV/коде. Ship-On (выкатываем включённым и рабочим). Уточняющие вопросы — на русском с объяснением вариантов и рекомендацией. Push — только с явным «да» владельца (кроме рефлексии). Крупное изменение chat-retrieval → сначала ТЗ + подтверждение владельца.

## 1. Что такое умные таблицы (5 сек)
Системные таблицы-справочники (Идеи / Обещания / Цели / Гипотезы / Реестр рисков / Клиенты / Команда / …), которые **авто-наполняются из графа знаний** и **читаются чатом «Мастер»** параллельно с графом. Идея: детерминированные ответы на структурные вопросы.
- Полная дока: [`second-brain/01_projects/smart-tables.md`](../../second-brain/01_projects/smart-tables.md) (§graphSync + §«Замер recall»).
- Архитектура графа/чата: [`second-brain/02_architecture/knowledge-core.md`](../../second-brain/02_architecture/knowledge-core.md), [`module-map.md`](../../second-brain/02_architecture/module-map.md).

## 2. Что УЖЕ сделано (не переписывать — усиливать)
ТЗ: [`plans/tz/2026-06-21-smart-tables-revive-and-autofill.md`](../tz/2026-06-21-smart-tables-revive-and-autofill.md) (Ф1-Ф4.6 закрыты).

| Часть | Что | Коммит |
|---|---|---|
| Ф4-ядро | канал `graphSync` на шаблонах + `TableGraphSyncService` (Goal→Цели, Experiment→Гипотезы, IdeaBlock signalType=idea→Идеи, commitment→Обещания); гейт confidence, дедуп по `(tableId,sourceObjectType,sourceObjectId)`, fill-empty, provenance | `bab90b22` |
| Ф4.4 | reconcile-крон `TableGraphsyncReconcileCronService` (@Cron '25 */3 * * *') + `expireDrafts` | `098eda68` |
| Ф4.5 | **Реестр рисков** через graphSync по НАБОРУ signalType (`signalTypes[]`: risk/churn_risk/blocker/pain/resource_gap/*_friction → Описание←name) — детерминированно, без нового LLM-извлекателя | `c35eb1ab` |
| Ф4.6 | **draft-пул**: `confidence<min` → `status='draft'`+`draftExpiresAt` (вне чата); промоушен draft→active; истечение TTL на reconcile; чат/фильтр читают только `status='active'`; крутилка `table.agent.draft_ttl_days`=14 | `0a233e9a` |
| Ф2 | промпты таблиц 12b + Flash (`table-*.prompt.ts`, seed маршрута) | `5ae24cfd` |
| Ф3 | entity-check детерминированный (убран LLM-пасс, normalize покрывает) | `ff825619` |
| Ф1 | пункт меню «Таблицы» в подгруппе «Справочник» (`nav-config.ts`) | `7d42144e` |

Ключевые файлы:
- `backend/src/modules/tables/services/table-graph-sync.service.ts` — движок (syncObject, reconcileTenant, applyObject, matchesSource, buildCells, expireDrafts, effectiveSignalTypes).
- `backend/src/modules/tables/templates/system-tables.catalog.ts` — шаблоны + `graphSync`.
- `backend/src/modules/knowledge-core/services/chat-v2-table-context.service.ts` — **ЗДЕСЬ БАГ** (см. §4).
- `backend/src/modules/tables/services/table-semantic-filter.service.ts` — фильтр строк.
- `backend/scripts/backfill-table-graphsync.ts` — прод-backfill (config + reconcile).
- Тесты: `table-graph-sync.service.spec.ts` (17), `table-graphsync-reconcile.cron.spec.ts`.

**Живьём на «Стреле» graphSync создал 99 строк** (Идеи 17 / Обещания 43 / Цели 1 / Гипотезы 11 / Риски 27; 1 черновик).

## 3. КРИТИЧНО: замер показал, что таблицы НЕ помогают (доказано)
A/B на 21 структурном вопросе банка (graph-only vs с таблицами, тот же код/БД):
- **без таблиц: CORRECT 23.8% · с таблицами: 14.3%** — лифта нет, таблицы слегка ВРЕДЯТ.

**Корень (проба `fetchTableContext`):** баг выбора таблицы в чате `ChatV2TableContextService.fetchByKeywordTables` (`chat-v2-table-context.service.ts:121-197`):
1. **Перехват generic-именем колонки:** у «Обещаний» колонка названа «Что» → вопрос «**Что** горит?» матчит её → в контекст льётся **20 нерелевантных промисов** → синтез деградирует.
2. **Нет морфологии:** «риски»≠«рисков», «блокирует»≠«блокер» → «Реестр рисков» не выбирается НИКОГДА для риск/blocker-вопросов.
3. **Залив 20 строк** без ранжирования по релевантности.

Проба показала: из 21 вопроса таблицы «достигли» лишь 10, и почти всегда — НЕ той таблицы («Обещания» вместо «Реестра рисков»).

## 4. ТВОЯ ЗАДАЧА: follow-up ТЗ (готово, реализуй)
[`plans/tz/2026-07-04-chat-table-context-relevance-selection.md`](../tz/2026-07-04-chat-table-context-relevance-selection.md) — 5 фаз:
- **Ф1** убрать перехват generic-именами колонок (скоринг по `name`+`description`, исключить структурные токены; порог score≥2).
- **Ф2** топиковые описания системных таблиц (добавить `description` в шаблон+провижининг+backfill, с синонимами: Реестр рисков = «риски, блокеры, что мешает/блокирует, узкие места, что горит»).
- **Ф3** морфология (prefix-stem ≥4 символа) ИЛИ эмбеддинг-выбор таблицы (по образцу `resolveEntityHintsByEmbedding` в `entity-resolution.service.ts`).
- **Ф4** row-level релевантность + кап (не заливать 20; top-N по совпадению).
- **Ф5** замер (см. §5).

**Валидация выбора — детерминированная (без шумного судьи!):** проба `backend/scripts/_probe-table-context.ts` печатает, какая таблица выбирается на каждом вопросе. После фикса: «Реестр рисков» выбирается для risks/blockers, «Обещания» перестаёт перехватывать. Это проверяется БЕЗ LLM.

## 5. Как поднять стенд и померить (точные команды)
**Окружение:** локальный dev, реальные LLM-ключи в `backend/.env` (реальные ответы). БД — docker-контейнер `z-dev-postgres`, db `z_main`, user `z_app`, pass `z_app_dev_password`, порт `127.0.0.1:55435` (trust). Redis, MinIO — тоже в `docker-compose.dev.yml`.

```bash
# из корня репо — поднять зависимости
docker compose -f docker-compose.dev.yml up -d
cd backend && bun install && bun run prisma:generate   # миграции уже применены на dev
```

**Тенант «Стрела» (эталон):** org `cmr1qbvpx0001pwbwxbgmh1jl`, owner-user `cmqxh4za3000018bwpuy1whg3`, ~299 блоков, 99 строк таблиц.

**Скрипты замера бутят свой AppModule** (`NestFactory.createApplicationContext`) → каждый прогон берёт СВЕЖИЙ код, отдельный backend-сервер поднимать НЕ нужно.
```bash
cd backend
# проба выбора таблиц (детерминированно, быстро, без судьи) — ГЛАВНЫЙ инструмент валидации фикса:
bun run scripts/_probe-table-context.ts        # печатает rows/tables по 21 структурному вопросу
# A/B recall (LLM-судья — ШУМНЫЙ, см. ловушку) — таблицы вкл/выкл через archivedAt:
bun run scripts/_measure-tables-recall.ts       # если удалён — восстанови из git history коммита d02c8fa5
```
Банк вопросов: `docs/testing/strela-recall-questions.json` (111), углы risks/blockers/goals — структурные.

## 6. ЛОВУШКИ (стоили времени — не наступай)
1. **Одиночный LLM-судья ненадёжен** — дефолтит в WRONG, дал 28.8% при реальных 73%. Для recall-числа используй **детерминированную gold-линейку** (`scripts/_measure-gold.ts`, см. второй handoff), НЕ самодельного одиночного судью. Но для ВЫБОРА таблицы (эта задача) судья не нужен — используй пробу.
2. **Шум синтеза ±3 вопроса** — мелкий эффект в нём тонет. Меряй выбор таблиц детерминированно (проба), а не только recall.
3. **Крон-консолидатор/reconcile запускаются in-process** при бутстрапе AppModule (WorkersModule в AppModule) — держи прогоны короткими, не удивляйся фоновым записям.
4. **graphSync-строки имеют `entityId=null`** → в чат идут ТОЛЬКО через keyword-путь (`fetchByKeywordTables`), НЕ через entity-мост. Поэтому баг выбора таблицы = полная блокировка рычага.
5. **@@unique с NULL:** Postgres считает NULL различными → ручные строки (source=null) не конфликтуют с дедупом.
6. **Prisma JSON:** `DbNull` (колонка без DEFAULT) ≠ `JsonNull`. `findGraphSyncTables` использует `{ not: Prisma.JsonNull }` — но backfill грузит ВСЕ isSystem без JSON-фильтра (иначе no-op на проде — была критичная бага H1).
7. Скрипты — в `backend/scripts/` (иначе `reflect-metadata` не резолвится). `createPrismaClient()` из `_lib/prisma.ts`, не `new PrismaClient()`.

## 7. Прод-гейт (ВАЖНО)
Наполнение таблиц активирует чат-ветку, которая СЕЙЧАС деградирует структурные ответы. **Не гнать `backfill-table-graphsync.ts` и не включать reconcile-крон на проде до фикса выбора таблиц** (либо выкатывать код с `table.graphsync.enabled=false` и включить `true` вместе с фиксом). Детали — `docs/operations/prod-deploy-log.md` (блок 2026-07-04, ⚠️ ПРОД-ГЕЙТ) + [`second-brain/04_не-сделано/README.md`](../../second-brain/04_не-сделано/README.md) (строка 2026-07-04).

## 8. Критерий готовности
- Проба: нужные таблицы выбираются (Реестр рисков для рисков, Цели для целей), «Обещания» не перехватывает.
- A/B recall (структурный subset): с таблицами CORRECT+PARTIAL > graph-only (лифт, не шум — усредни ≥2 прогона).
- Перепрогон gold-50 (см. второй handoff): не просели broad/fact/expertise.
- typecheck+lint+build+тесты зелёные; second-brain + prod-deploy-log + не-сделано обновлены; рефлексия; снять прод-гейт.
