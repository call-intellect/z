---
title: Умные таблицы — оживить, выкатить промпты 9 июня, авто-наполнить все 10 шаблонов
date: 2026-06-21
revised: 2026-07-03
type: tz
status: revised-under-current-code
area: smart-tables
source_analysis:
  - plans/analysis/2026-06-20-smart-tables-live-audit/README.md
  - plans/analysis/2026-06-09-prompt-rewrites/12b-smart-tables.md
  - "картография текущего кода таблиц 2026-07-03 (4 read-only агента: tables-модуль, chat-v2↔tables, промпты/фронт, git-дельта)"
related_projects:
  - second-brain/01_projects/smart-tables.md
relates_to:
  - plans/analysis/2026-07-03-recall-to-99-MASTER-roadmap.md
  - plans/tz/2026-07-03-extraction-consolidation-fixes.md
owner_decisions:
  - "Р-1 ✅: место в меню — подгруппа «Справочник» (подтверждено владельцем 2026-06-21)"
  - "Р-2 ✅: объём авто-наполнения — все 10 шаблонов, 3 группы по источнику (владелец 2026-06-21)"
  - "Р-3 ✅ (решено оркестратором 2026-07-03): спорные строки — БЕЗ очереди подтверждений; v1 создаёт только высокоуверенные, черновой TTL-пул — под-фаза Ф4.6"
  - "Р-4 ✅ (решено оркестратором 2026-07-03): ускорение — entity-check детерминированный + DRAFT→Flash; это латентность/стоимость, не recall → после Ф4"
---

# ТЗ: Умные таблицы — оживить + промпты + авто-наполнение

## Зачем (одним абзацем)

Движок умных таблиц построен (фазы 0–5) и **уже прошит в чат** (`runTableBranch` в knowledge-core тянет строки таблиц в ответ параллельно с графом), но **6 из 10 категорий знаний пусты**: авто-наполнение работает только для 4 «связанных» таблиц через `entitySync`, а мост «граф→строки» (`graphSync`) для мягких таблиц (Идеи/Цели/Гипотезы/Обещания) и Рисков **не реализован вообще**. Плюс операционные хвосты: нет пункта меню, промпты 9 июня не выкачены, агент тормозит. Это ТЗ сводит всё в один трек: **достроить авто-наполнение (recall-рычаг)**, затем поднять качество промптов, ускорить агента, вернуть видимость. Полный аудит — [smart-tables-live-audit](../analysis/2026-06-20-smart-tables-live-audit/README.md).

---

## РЕВИЗИЯ 2026-07-03 (под текущий код + после консолидации)

### Почему пересмотрено
ТЗ от 21 июня писалось до части реализации. Картография текущего кода (4 read-only агента) показала: часть уже сделана (R1–R4, файлы промптов, связка с чатом, авто-наполнение Группы A), а «Итог» ТЗ («Реализовано: —, осталось всё») устарел. Ниже — фактическое состояние и переупорядочивание под цель **recall 77→99** (Шаг 2 MASTER-роадмапа).

### Связка таблиц с чатом — УЖЕ РАБОТАЕТ (не переписывать)
Ключевой факт: таблицы архитектурно **полностью прошиты** в синтез ответа chat-v2.
- `chat-v2.service.ts:385-387` → `synthesis.service.ts:165-167` → `knowledge-core/chat-v2.service.ts` — `tableEntityHints/tableEntityIds/tableAggregation` прокидываются dialog→synthesis→ask().
- `knowledge-core/chat-v2.service.ts:953-996` — `Promise.allSettled([graphRetrieval, runTableBranch, …])` — ветка таблиц идёт параллельно графу.
- `knowledge-core/chat-v2.service.ts:1737-1764` — `runTableBranch()` активна при `entityIds/hints/queries`.
- `chat-v2-table-context.service.ts:40-80` — `fetchTableContext()` двухступенчато: `fetchByEntityBridge` (граф) + `fetchByKeywordTables` (NL-семантика).
- `chat-v2.service.ts:1029-1034` — гейт: если `tableRows=[]` **и** `contextBlocks=[]` → заглушка; если таблицы дали строки — отвечаем (граф пуст ≠ заглушка).
- `chat-v2.service.ts:2350-2358` — `buildUserMessage()` рендерит строки в USER-промпт: `[ТАБЛИЦА: name] cell=val; …`.

**Вывод:** труба готова. Не хватает ТОЛЬКО содержимого — строк в 6 пустых таблицах. Отсюда recall-рычаг = **Ф4 (создание строк из графа)**, а не переделка связки.

### Почему таблицы пустые — 3 слоя (диагноз)
1. **Понимание запроса (dialog-layer):** LLM извлекает `entityHints` вероятностно. Слабое извлечение → пустой `tableRows`. Детерминизм: НИЗКИЙ.
2. **Резолв сущности (граф-мост):** `entityHints`→`Entity.id`, `TableRow.entityId` матчится к `input.entityIds`. Детерминизм: СРЕДНИЙ. **Блокер был:** граф плохо родит `customer`/`vendor`, `person.canonicalName` сырой.
3. **Создание строк (авто-наполнение graphSync):** мост граф→новые `TableRow` **НЕ реализован** (Ф4). Без него таблицы Группы B пусты, пока не заполнить руками.

### Синергия с консолидацией извлечения (фикс от 2026-07-03)
Фикс-агент только что закрыл консолидацию сущностей (кросс-типовой мёрж + канонический тип + `client→customer`, коммиты `b132d8ab`/`d556f11a`/`5e0fc5c5`). Это **прямо чинит Слой 2**: чище `customer`/`vendor`-сущности → лучше entity-bridge таблиц. То есть Ф4 ложится поверх УЖЕ улучшенного графа — двойная ценность. `person.canonicalName` сырой — отдельный knowledge-core-трек (не в scope таблиц; строка-указатель в реестр не-сделано).

### Порядок реализации ПО RECALL-ЦЕННОСТИ (переопределяет исходный «Ф0→Ф5»)
Цель — поднять recall, поэтому сначала то, что даёт данные в ответ:
1. **Ф4 — авто-наполнение graphSync (recall-рычаг).** Данные появляются в 6 пустых таблицах → чат отвечает на «какие обещания дали / риски / цели / идеи».
2. **Ф2 — промпты 12b** (качество извлечения строк — `table-extract-rows` косвенно улучшает recall).
3. **Ф3 — латентность** (entity-check детерминированный + DRAFT→Flash) — скорость/стоимость, не recall.
4. **Ф1 — пункт меню** — видимость/UX.
5. **Ф5 — приёмка** (частью под стенд).
Ф0 (редеплой) — прод-операция, **owner-gate**, вне автономного кода.

### Границы автономной работы (ветка/стенд)
- **Всё в ветке `work/2026-07-02`.** Новую ветку НЕ создавать, ничего не сливать. Фикс не трогал `schema.prisma`/миграции → моя миграция таблиц не конфликтует.
- **Стенд занят** (клон-стенд) → пишу код + unit + read-only; **живое наполнение таблиц данными «Стрелы» и замер recall — под стенд** (как у фикс-агента). Миграцию локально применять аккуратно: `migrate dev --create-only` (файл без применения) + `prisma generate` (типы клиента) — не мутировать общую dev-БД, пока стенд занят.
- **Прод-выкат/backfill — owner-gate.**

---

## REALITY-CHECK (что уже в коде — НЕ переписывать; path:line на 2026-07-03)

- ✅ Модуль `backend/src/modules/tables/` целиком: CRUD, импорт, семантический фильтр, enrich.
- ✅ **Связка chat-v2↔таблицы прошита** (см. блок «Связка … УЖЕ РАБОТАЕТ» выше).
- ✅ Пост-пассы качества R1–R4 (retry DRAFT def 3/300мс, union опций, Jaccard-dedup 0.6, type-guard) — `table-agent.service.ts:1-668`, коммит `e84d8ace`.
- ✅ Фикс краша деталки (`useShallow` + порядок контроллеров) — коммит `26219233`; `TableClient.tsx:8` `useShallow` уже применён.
- ✅ Файлы 6 промптов существуют (`backend/src/modules/ai/services/prompts/table-*.prompt.ts`) — **НО это СТАРЫЕ версии, не 12b** (нет «## Роль», нет правил допущений/последнего значения/запрета угадывать ISO).
- ✅ Промпты вызываются напрямую из кода (`table-agent.service.ts:158-159`), НЕ из админ-реестра. Выкат новых = правка `.prompt.ts` + редеплой.
- ✅ Авто-наполнение **Группы A** (4 таблицы `entitySync`+`autoCreate`): `clients_deals/team/vendors/regulations`, `table-enrich.service.ts:550-566` `findAutoSyncTables`, работает на встречах через `enrichFromEvent`.
- ✅ `TableCellProvenance`, `TableCellPendingPatch` (`schema.prisma:11980-12007`), порог `table.agent.confirmation_threshold` (0.85, `table-enrich.service.ts:718-726`) — переиспользуем.
- ✅ Граф уже извлекает: IdeaBlock, Goal, Experiment, action-item/Issue.
- ✅ Иконка `Table2` импортирована в `nav-config.ts:32` (осиротевшая — пункт меню удалён).
- ⚠️ `enrichFromEvent` (`table-enrich.service.ts:99-109`) **ТОЛЬКО патчит ячейки существующих строк** (находит по `entityId`), **новые строки НЕ создаёт**.
- ⚠️ 4 «мягких» шаблона (`ideas/okr/hypotheses/promises`) — `entitySync: null`, `graphSync` отсутствует, источника нет.
- ❌ `Table` (`schema.prisma:11749-11791`) — есть `entitySync Json?`, **НЕТ `graphSync`**.
- ❌ `SystemTableTemplate` (`system-tables.catalog.ts:18-23`) — **НЕТ поля `graphSync`** в интерфейсе.
- ❌ Pass-3 entity-check (`table-agent.service.ts:208-227`) — **всё ещё LLM-вызов**, не детерминированный.
- ❌ `table-infer-schema` маршрут (`seed-llm-task-routes-smart-tables.ts:31`) — **CAPABLE_CHAIN (deepseek-v4-pro)**, не Flash.
- ❌ `wrapUserData` в call-site'ах (`table-agent.service.ts`, `table-enrich.service.ts extractFacts`) — **не применён**; `meetingDateIso` не прокинут.
- ❌ Пункт меню `/tables` — **не добавлен** в `nav-config.ts` (`Table2` импортирован осиротело).

---

## Решения владельца

| # | Решение | Итог | Почему |
|---|---|---|---|
| Р-1 ✅ | Куда в меню | **Подгруппа «Справочник»** (секция «Система») — подтверждено 2026-06-21 | Курс «сокращаем меню → второй слой». Когда Ф4 оживит — можно поднять в «Работа». |
| Р-2 ✅ | Объём авто-наполнения | **Все 10 шаблонов, 3 группы**: A) 4 связанные (граф-сущности, есть); B) 4 мягкие (мост graphSync); C) Риски (новый извлекатель) + Контент-план (ручной) — 2026-06-21 | «10 живых»: 9 авто + Контент-план как доска планирования вперёд. |
| Р-3 ✅ | Спорные строки | **Тихий фон с TTL, без очереди подтверждений.** v1 (Ф4-core) создаёт ТОЛЬКО высокоуверенные (≥порог); черновой TTL-пул — под-фаза **Ф4.6** (решено оркестратором: recall-рычаг — сам факт данных, дозревание спорных вторично) | Курс «без human-in-loop, гейт = рубильник»; не плодить «Подтверждения 47». Реализация — `TableRow.status='draft' + draftExpiresAt`, а не новая таблица (минимальная схема). |
| Р-4 ✅ | Ускорение (45с→) | **Pass-3 entity-check → детерминированный код + DRAFT→Flash.** Приоритет — ПОСЛЕ Ф4 (латентность, не recall) | entity-check ≈ «тип ∈ списка иначе null» (уже дублируется в коде); Flash+12b быстрее/дешевле. |

---

## Фаза 4 — Авто-наполнение (recall-рычаг, ДЕЛАЕМ ПЕРВОЙ) `[ ]`

**Цель:** данные сами текут в 6 пустых таблиц → чат отвечает на структурные вопросы. Труба в чат готова (см. REALITY-CHECK), не хватает строк.

### Ф4.1 — Канал `graphSync` на шаблоне + схема `[x]`
- `SystemTableTemplate` (`system-tables.catalog.ts:18-23`): добавить опц.
  ```ts
  graphSync?: { source: 'idea_block' | 'goal' | 'experiment' | 'action_item'; fieldMap: Record<string,string>; autoCreate: boolean };
  ```
- Проставить (Р-2): `ideas`→`idea_block`, `okr`→`goal`, `hypotheses`→`experiment`, `promises`→`action_item`. `risks`/`content_plan` — `null`.
- Prisma `Table`: поле `graphSync Json?` (**миграция**, additive nullable). Backfill проставляет `graphSync` системным таблицам по `systemKey` (существующие Org).
- **Локально:** `prisma migrate dev --create-only --name table_graphsync_and_draft` + `prisma generate` (типы) — файл миграции без применения к общей БД, пока стенд занят.

### Ф4.2 — Row-extractor в enrich-пайплайне `[x]`
- `table-enrich.service.ts`: помимо ветки «патч ячеек sync-таблиц» — новая ветка `findGraphSyncTables` + «создать строку в graphSync-таблице».
- Вход: графовый объект (Goal/Experiment/IdeaBlock/action-item) → `fieldMap`→ячейки. Свободные формулировки → LLM `table-extract-rows` (уже есть) по схеме колонок.
- **Дедуп строк** по primary-колонке — переиспользовать Jaccard/embedding из R3 (`findSimilarTables`); не плодить дубли при повторных событиях.
- Строки из графа помечать `TableCellProvenance` (источник + deep-link на объект/тайминг).

### Ф4.3 — Гейт уверенности (v1: только высокоуверенные) `[x]`
- `confidence ≥ table.agent.confirmation_threshold (0.85)` → строка создаётся сразу (`status='active'`) + provenance.
- `confidence < порога` → **v1: не создаём** (пропуск; никаких пушей владельцу). TTL-пул спорных — Ф4.6.
- Ручные правки пользователя НЕ перетирать (анти-самоотравление): при обновлении из графа не трогать ячейки с `provenance='manual'`.

### Ф4.4 — Триггеры (reconcile-крон вместо событий) `[x]`
- `meeting.ai_ready` (эмитится) — action_item/idea из встреч.
- Расширить `entity.created/updated` на Goal/Experiment/IdeaBlock (шина knowledge-core) — новая цель/эксперимент сразу строкой.
- Throttle на Org (`table:enrich:jobs:${tenantId}`) и бюджет (`max_daily_tokens`) — уже есть.

### Ф4.5 — Риски (Группа C, новый извлекатель) `[ ]`
- В графе нет объекта «риск». Лёгкий извлекатель риск-сигналов поверх блоков встреч/решений/инсайтов — ветка в `table-extract-rows` со схемой «Реестр рисков» (Описание/Вероятность/Влияние/Митигация/Статус/Владелец) ИЛИ новый cache-friendly промпт `table-extract-risks`. Через тот же гейт + дедуп. Источник — `meeting.ai_ready` + decision/insight-апдейты.
- **Контент-план:** авто-извлечение НЕ делаем (план вперёд). `graphSync: null`, ручная таблица.

### Ф4.6 — Черновой TTL-пул спорных (Р-3, под-фаза после core) `[ ]`
- `TableRow`: `status` (`active|draft`) + `draftExpiresAt DateTime?` (в той же миграции Ф4.1).
- `confidence < порога` → строка `status='draft'`, `draftExpiresAt = now + table.agent.draft_ttl_days`. Дозревает (→`active`) при повторном подтверждении из другого источника; иначе cron-истечение.
- **Чат читает только `status='active'`** — `chat-v2-table-context.service.ts` фильтрует драфты (не засорять recall низкоуверенным).
- AdminSetting `table.agent.draft_ttl_days` (14) + `table.graphsync.enabled` (true, kill-switch) → `admin-setting-schema-registry.ts` + сид + UI.

### Приёмка Ф4
- Юнит: создание строки из Goal/Experiment/IdeaBlock/action-item/риск-сигнала; дедуп (повтор = no-op); гейт (≥порог→active, <порог→v1 пропуск / Ф4.6 draft); не перетирает `manual`; TTL-истечение (Ф4.6); чат-контекст не отдаёт драфты.
- Группа A смоук: строки sync-таблиц привязаны к Entity, `canonicalName` ≠ сырой id; мусор-имена → указатель в реестр не-сделано (knowledge-core, не чиним здесь).
- **Под стенд (owner-gate):** живое наполнение «Стрелы» новым кодом в fresh-тенант → строки в 6 таблицах → прогон линейки (подъём recall на структурных вопросах).

---

## Фаза 2 — Промпты 9 июня (батч 12b) `[ ]` (после Ф4)

Источник — [12b-smart-tables.md](../analysis/2026-06-09-prompt-rewrites/12b-smart-tables.md) (раздел СТАЛО). A/B подтвердил превосходство (parsed 7/8 vs 5/8; на коротких допущение 3/3 vs 0/3; быстрее). Контракт не меняется.

Перенести СТАЛО в 6 файлов `backend/src/modules/ai/services/prompts/`:
1. `table-infer-schema.prompt.ts` — роль «черновик для оптимизации» + допущение в `description`.
2. `table-architect-pass.prompt.ts` — нумерованные действия + «что НЕ трогать».
3. `table-entity-check.prompt.ts` — «сторожевой шаг» + edge-case. *(Если делаем Р-4 — удаляется вместе с LLM-пассом, см. Ф3.)*
4. `table-extract-rows.prompt.ts` — «последнее значение при нескольких упоминаниях» + запрет угадывать ISO без якоря. **(влияет на качество строк Ф4)**
5. `table-semantic-filter.prompt.ts` — роль + edge-case «неоднозначно → []».
6. `table-auto-fill.prompt.ts` — шкала confidence + «контекст строки справочно».

Закрыть call-site (из 12b §«Пробелы»):
- `table-agent.service.ts runThreePassPipeline`: обернуть `userPrompt` в `wrapUserData` перед `buildTableInferSchemaPrompt`.
- `table-enrich.service.ts extractFacts`: обернуть `transcriptChunk` в `wrapUserData`; прокинуть `meetingDateIso` в USER.

Cache-friendly: SYSTEM стабилен (каталоги/правила), переменные — в конце USER. Один разовый сдвиг префикса сейчас — ок.
Проверка: `table-agent.service.spec.ts` + `table-enrich.service.spec` зелёные; typecheck+build; A/B (`scripts/eval/ab-table-infer-schema.ts`) ≥ старого.

## Фаза 3 — Латентность 45с → ~15–20с `[ ]` (после Ф2)

- **Pass-3 entity-check → детерминированный код.** Логика ≈ вся в `normalize()` (`entitySync.type ∉ availableSyncTypes → null`). Убрать LLM-вызов (`table-agent.service.ts:208-227`), заменить кодом. Минус заход к ИИ.
- **DRAFT (`table-infer-schema`) → DeepSeek V4 Flash** (промпт 12b устойчив на Flash), ARCHITECT — на Pro. Маршрут `seed-llm-task-routes-smart-tables.ts:31` → CHEAP_CHAIN.
- (Опц. vNext) стрим превью DRAFT.
- Проверка: живой `infer-schema` < 20с; качество (A/B) не просело.

## Фаза 1 — Вернуть «Таблицы» в меню `[x]`

- `nav-config.ts`: `NavConfigItem` в `REFERENCE_SUBGROUP` (подгруппа «Справочник»):
  ```ts
  { href: "/tables", label: "Таблицы", icon: Table2, matchPrefix: "/tables" },
  ```
  `Table2` уже импортирован.
- Проверка: пункт виден, ведёт на `/tables`, подсветка; `nav-subset.spec.ts` зелёный; Playwright — открывается.

## Фаза 0 — Редеплой (owner-gate, прод-операция) `[ ]`

Прод собран до `26219233` → крашится деталка + нет R1–R4. Свежий билд чинит бесплатно. **Не автономный код — прод-операция владельца.**
- `docker compose up -d --build backend frontend` (медиа-стек не трогать).
- Проверка: `/tables/<id>` рендерится, нет React #185; живой `import/analyze` находит merge-кандидата (R3).

## Фаза 5 — Приёмка на проде `[ ]` (под стенд / owner)
- Playwright: меню→Таблицы→открыть каждую системную, грид рендерится.
- `infer-schema` < 20с, качество ок.
- Создать цель/эксперимент → авто-строка с provenance (rows-API + глазами).
- Линейка: подъём recall на структурных вопросах (кто-по-роли/когда/сколько/обещания/риски/цели).
- diag/логи: нет ERROR в `tables.enrich`/`tables.sync`.

---

## Прод-деплой (владелец отслеживает; полная инструкция — `docs/operations/prod-deploy-log.md`)

- **Ф0:** `docker compose up -d --build backend frontend`.
- **Ф4 — миграция Prisma** (`Table.graphSync Json?` + `status`/`draftExpiresAt`): авто на `up` (`migrate deploy`). Шаг 4.
- **Ф4 — backfill** `backfill-table-graphsync.ts` (проставить graphSync системным таблицам Org): в `apply-prod-deploy.ts` STEPS (`phase: backfill`, `skipBootstrap`). Шаг 8.
- **Ф4 — AdminSettings сид** (`draft_ttl_days`, `graphsync.enabled`): Шаг 7.
- **Ф3 — маршрут DRAFT→Flash** (`seed-llm-task-routes-smart-tables.ts`): Шаг 7.
- Промпты (Ф2), меню (Ф1) — чистый код, только редеплой.

## Acceptance (весь релиз)
- [ ] **Ф4:** 9/10 шаблонов наполняются авто (4 граф-сущности + Идеи/Цели/Гипотезы/Обещания + Риски); Контент-план — ручная доска. Новая цель/эксперимент/обещание/риск → авто-строка с provenance; спорное — v1 пропуск / Ф4.6 фон, НЕ в «Подтверждения». Чат видит только active-строки.
- [ ] Группа A смоук: строки sync-таблиц привязаны к Entity; мусор-имена → указатель в реестр (knowledge-core).
- [ ] Ф2: промпты 12b в коде; A/B ≥ старого; call-site обёртки закрыты.
- [ ] Ф3: `infer-schema` < 20с; entity-check детерминированный.
- [ ] Ф1: Таблицы видны в меню и открываются (грид, нет #185).
- [ ] typecheck + lint + build + table-тесты зелёные.
- [ ] Линейка: подъём recall на структурных вопросах (под стенд).

## Порядок и зависимости (по recall-ценности)
**Ф4 (данные) → Ф2 (качество промптов) → Ф3 (латентность) → Ф1 (меню) → Ф5 (приёмка).** Ф0 (редеплой) и живые замеры — owner-gate / под стенд. Ф4 — главный recall-рычаг; остальное — качество/скорость/видимость.

## Итог
**Реализовано (на 2026-07-04):** модуль tables целиком; связка chat-v2↔таблицы (прошита); R1–R4; авто-наполнение Группы A (`entitySync`). **+ НОВОЕ (эта сессия):** **Ф4.1-4.4** — graphSync авто-создание строк 4 категорий (Идеи/Обещания/Цели/Гипотезы) из графа (Goal/Experiment/IdeaBlock): `TableGraphSyncService` (гейт confidence≥0.5, детерминированный дедуп по `sourceObjectId` + `@@unique`, fill-empty анти-clobber, provenance) + reconcile-крон `table-graphsync-reconcile` (@Cron 3ч, Ship-On) + backfill-скрипт + AdminSettings (`table.graphsync.enabled`/`min_confidence`) + миграция; **Ф1** — пункт меню «Таблицы» (Справочник). Всё зелёное (typecheck+build+vitest 136), коммиты `bab90b22`/`098eda68`/`7d42144e` (ревизия ТЗ `158b60af`). Ревью адверсариальным агентом — 2 HIGH (backfill no-op DbNull/JsonNull, дедуп без unique) + 3 MEDIUM (enum, порог, N+1) починены. **Осталось (отложено до стенд-замера — см. реестр не-сделано):** Ф4.5 риски (LLM-классификатор), Ф4.6 черновой TTL-пул + чат-фильтр `status='active'`, Ф2 промпты 12b (A/B под стенд), Ф3 латентность, Ф0/Ф5 (редеплой + приёмка — owner/стенд), мгновенная пост-встреча свежесть. **Живой замер recall** (backfill на fresh-тенанте «Стрелы» + линейка) — под стенд/owner-gate. Дисциплина роадмапа: полировочные фазы приоритизируются ПО ЦИФРАМ линейки после замера.
