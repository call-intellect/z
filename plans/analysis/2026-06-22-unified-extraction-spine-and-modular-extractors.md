---
type: analysis
status: research-complete
feature: unified-extraction-spine-and-modular-extractors
date: 2026-06-22
snapshot_date: 2026-06-22
owner: Сергей (владелец продукта Кора)
related:
  - plans/analysis/2026-06-22-ingestion-spine-unification-audit.md   # содержит ошибку §5 — исправлено здесь (см. §3-bis)
  - plans/analysis/2026-06-22-tasks-lifecycle-deep-audit.md
  - plans/tz/2026-06-22-meeting-to-tracker-and-models-unified-fix.md
---

> Цель разбора: доказать лучшее решение для **модульного единого слоя извлечения сущностей** Коры — где приём всех каналов уже единый (RawEvent), решения/идеи/цели достаются модульно, а задачи фрагментированы по 5 путям. Поддерживает будущее ТЗ на унификацию задачного извлечения.
> Следующий шаг → ТЗ: plans/tz/2026-06-22-unified-task-extraction-tz.md
> Метод: vexp-baseline (наш код) + внешний fan-out (5 мапперов) + **состязательный red-team с независимым retrieval**. Red-team опроверг 3 утверждения первого прохода — они исправлены ниже.

---

## 1. Рамка проблемы

**Симптом (как видит владелец):** «есть общий роутер, куда со всех каналов приходит контент и оттуда достаются задачи/решения/идеи. Насколько это реализовано? Почему задачи отошли в сторону?»

**Две конкурирующие формулировки корня:**
- **Ф-A (расширяемость каналов):** «достаточно ли модульно подключаются НОВЫЕ каналы (к 20-30)?» → по графу **да** (см. §4); это не главная боль.
- **Ф-B (единство извлечения сущностей) — корень:** «извлечение РАЗНЫХ сущностей неоднородно: решения/идеи/цели — единым модульным конвейером, задачи — 5 кустарными путями. Новая сущность или унификация задач упирается в это». **Это и есть проблема.**

**Кто страдает (роли Z):** сотрудник (задача из чата/встречи не доходит/двоится), руководитель (дашборд считает по двум несведённым моделям), разработчик (новый канал даёт решения «бесплатно», а задачи — нет), владелец (не масштабируется к новым сущностям).

**Метрика «решено»:** новый канал, попавший в граф, даёт задачи без отдельного воркера; одна задача из встречи+чата = один артефакт (не два); один резолвер исполнителя и один дедуп вместо 4 и 2; добавление новой сущности = 1 файл, не правки в 5 местах.

**Iceberg (симптом → корень):** «почему задачи отошли» — не задумка, а **наслоение + смысловая асимметрия**. Смысл: решение = пассивная память (один адрес-хранилище), задача = действие со своим домом-состоянием (трекер: исполнитель/срок/статус) и **разной идентичностью адресата по каналам**. История: `Task` родился первым (AI Meeting Workspace), полноценный трекер `Issue` построен позже отдельным спринтом, миграцию `Task→Issue` начали (флаг `meetingTasksToTrackerOnly`) и не закончили. `[verified: git log — model Task в e85e0ef5; model Issue в 6b854915; флаг в b3c6abc6/0e3b2208]`.

---

## 2. Дерево вопросов (MECE) — каркас фаз будущего ТЗ

Поток сущности: **приём канала → канонический блок → извлечение сущности → резолв атрибутов → дедуп/идемпотентность → материализация в пункт назначения → видимость**.

1. **Приём (channel→spine)** — единый? → ✅ да (`IngestService.ingest`→RawEvent). Не фаза.
2. **Канонический блок** — общий? → ✅ да (`block-ingest`→`IdeaBlock`). Не фаза.
3. **Извлечение задачи** — на спайне? → ❌ **нет** (см. §3). Фаза 1.
4. **Резолв исполнителя** — единый? → ⚠️ наполовину (есть богатый `AssigneeResolverService`, но 2-3 пути мимо). Фаза 2.
5. **Дедуп/идемпотентность** — единый? → ⚠️ 2 копии разной семантики + 1 канонический на Issue. Фаза 3.
6. **Пункт назначения** — Task vs Issue? → развилка владельца Р-1. Фаза 4.
7. **Модульность под новые СУЩНОСТИ** (не каналы) — реестр экстракторов? → отдельный опциональный трек B (§7).

---

## 3. Код-реальность: задачи НЕ на спайне signalType (поправка red-team)

**Главная находка, опровергающая первый проход.** Аудит `ingestion-spine-unification-audit.md §5` утверждал: «канал кладёт `signalTypeHint=commitment/done_item` → `RouterService` по signalType сам диспатчит в задачи». **Код это НЕ подтверждает** `[verified: router.service.ts:52-80, 251-496]`:
- В `RouterService.matchSpecialists` есть case'ы decision/idea/pain/risk/goal/commitment/plan_item, но **`commitment`/`plan_item` → `3-14-goals` (ЦЕЛИ), не задачи**. Task-sink в диспетчере **нет вообще**.
- `task_created`/`task_blocked`/`task_overdue` как маршрут не существуют (падают в default→LLM-fallback); `task_completed`/`done_item` идут в `TaskCompletionHandler` (закрытие петли), но это **закрытие**, а не **извлечение**.

**Следствие для рекомендации:** «оформить task-extractor как ещё один specialist по signalType, КАК решения/идеи» — **ложная аналогия**. Решения работают, потому что у них есть signalType + case в router; для задач этого слоя **нет**. Значит унификация задач = **достроить спайн новым task-signalType + case в router + один task-specialist** — это **правка ядра** (новый сорт сигнала + новое назначение «трекер»), а не «плагин без правок ядра». Честная цена: не запретительная (по §3-bis — 6 механических точек), но это **расширение спайна, а не вставка в готовый слот**.

### Что извлекает задачи СЕЙЧАС (5 путей, не на спайне) `[verified]`
| Путь | Источник | Модель | Резолвер |
|---|---|---|---|
| `meeting-extract-actions.service` | транскрипт встречи | `IntakeIssue` | `TaskAssigneeResolverService` (участники) |
| `meeting-report-fast.worker:425` | тот же транскрипт (за флагом) | legacy `Task` | свой |
| `chatbox-analyze.worker` | чат-сессия | legacy `Task` | `responsibleExternalId` |
| `telegram-task-parser` | текст бота | `IntakeIssue` | substring по имени |
| `me-tasks.service` (помощник) | фраза помощнику | `Issue` напрямую | `AssigneeResolverService` (богатый) |

---

## 3-bis. Механизм модульного извлечения, который УЖЕ есть (для решений/идей/целей)

`[verified: router.service.ts, specialist-routing-dispatcher.worker.ts, specialist-3-*.worker.ts]`

- **Реестр + статическая стратегия:** `RouterService.matchSpecialists` — `switch(signalType)→Set<имя специалиста>` (без LLM в основном пути, LLM лишь fallback). `SpecialistRoutingDispatcherWorker` держит `Map<jobName, handler>` + `register(NAME, handler)` (named-processor, дубль jobName → throw).
- **Единый контракт специалиста:** `static SPECIALIST_NAME` + `async handle(job)` (guard'ы найден/tenant/canonical/signal-in-scope) → `svc.processBlock({tenantId, blockId})`. Provenance стандартизован `sourceBlockIds: string[]` с guard против дублей при ретраях.
- **Цена нового специалиста сегодня = ~6 механических точек** `[inferred]`: ключ в `SPECIALIST`, строка в `PRIORITY`, ветка в `matchSpecialists`, новый Worker+Service, `register()` + inject в диспетчер, провайдер в `workers.module`. БД-enum — только если нужен новый signalType (для задач — **нужен**).
- **Помеха:** `SpecialistsCombined` (1 LLM на 9 сущностей) — **meeting-only** (требует `meetingId`, обходит router). Для задач в `COMBINED_COVERED` **не добавлять** (как goals/project-customer уже вне combined).

**Вывод:** механизм для «задача = специалист над IdeaBlock, материализующий Issue» **реально переиспользуем**, но требует достройки спайна (новый signalType) — честно это правка ядра, а не бесплатный плагин.

---

## 4. Ландшафт: как зрелые системы строят расширяемый приём + извлечение

### 4.1 Каналы как подключаемые коннекторы (приём) — паттерн ПОДТВЕРЖДЁН
**Функционально (простым языком):** все зрелые ELT/automation-системы развязывают «много источников → один сток» типизированным контрактом коннектора + общим конвертом события.

**Технически + маппинг на Z:**
- **Airbyte** (4-метод протокол spec/check/discover/read), **Singer** (taps/targets, 3 типа сообщений в stdout), **Meltano** (реестр коннекторов как данные), **n8n** (`INodeType` description-vs-execute), **Fivetran** (schema+update SDK). `[verified: airbyte/singer/meltano/n8n docs]`
- **Z уже владеет дорогой половиной:** `IngestService.ingest`→`RawEvent` — универсальный конверт с idempotencyKey(unique)+P2002, S3-вынос, dataClass, BullMQ job-per-event. Сильнее, чем у Singer/Fivetran (там идемпотентность на авторе коннектора). `[verified]`
- **Чего не хватает (≈20%):** типизированный `ChannelAdapter{describe, verify?, toRawEvent}` + `ChannelAdapterRegistry` (NestJS DI multi-token/`ModuleRef`) вместо ручной проводки `IngestModule`; структурная типизация ошибок адаптера (config/transient/malformed) — заодно чинит дыру наблюдаемости (тихие пропуски доставки); опц. `adapterVersion` на RawEvent.
- **Явно ОТВЕРГНУТЬ:** тяжёлый транспорт (subprocess-taps, stdout-стриминг, container-per-sync) — дублирует IngestService+BullMQ и ломает единый Node-стек (CLAUDE.md §7). Берём **форму** (DI+registry), не транспорт.

### 4.2 Извлечение сущностей как подключаемые модули — паттерн ПОДТВЕРЖДЁН
**Функционально:** зрелые системы отделяют общий приём от per-entity извлечения **стабильным промежуточным представлением** и добавляют экстрактор как модуль без правок ядра.

**Технически + маппинг на Z:** `[verified: LlamaIndex/Haystack/Unstructured/Onyx docs]`
- **LlamaIndex IngestionPipeline:** экстрактор = `TransformComponent.__call__(nodes)→nodes`; пункт назначения (`vector_store`/`docstore`) — **конфиг пайплайна, не код в экстракторе**; дедуп в `docstore` (hash-map), не в каждом шаге.
- **Haystack 2.x:** `@component` + `@component.output_types` (типизированные сокеты), sink (`DocumentWriter`) — такой же компонент.
- **Unstructured / Onyx:** Ingest→Partition(стабильный element)→Enrich→Store; destination-коннектор отделён от transform.
- **Z уже имеет (а):** `IdeaBlock` = canonical element; и **полу-реестр** (`Map<jobName,handler>`). Но до явного «extractor registry + sink» не хватает: (1) самоописывающего дескриптора специалиста (`consumesSignalTypes+priority+precondition+sink`) вместо 45-веткового switch + рассыпанных `PRIORITY`/`COMBINED_COVERED`; (2) вынесенного `EntitySink`-контракта с единым дедупом вместо индивидуальных upsert/P2002 в каждом воркере; (3) DI-discovery вместо 15 ручных `@Inject`+`register()`.

### 4.3 Реестр в TS и graph-memory OSS
- **NestJS нативный `DiscoveryService.createDecorator()` + `getProviders({metadataKey})`** — идиоматичный auto-registry без сторонних зависимостей. `[verified: nestjs docs + source]`
- **Graphiti/Cognee/Mem0:** Graphiti слил node+edge в **ОДИН** LLM-вызов (дробить = регресс + ломает prompt-caching); Cognee «extractors→typed payloads→generic sink»; Mem0 generic ADD/UPDATE/DELETE/NOOP updater. `[triangulated]`
- **Рекомендованный для Z контракт (если делать трек B):** `EntityHandler{entityType, toolSchemaFragment(), persist()}` + явная `Map` через `DiscoveryService` (не auto-scan, не CQRS EventBus — нужен возврат counts и одна транзакция в одном BullMQ-job). Конфликты/дедуп/curation — общая нижестоящая стадия. Это схлопывает текущую правку в 5 местах (`specialists-combined.service.ts:32-188`, 9 хардкод-persist) в добавление 1 файла.

---

## 5. Gap-таблица «зрелый паттерн × Z»

| Возможность | Лучший аналог (как) | Что у Z сейчас | Дельта/что строить |
|---|---|---|---|
| Канал = подключаемый коннектор | Airbyte/Singer типизир. контракт + реестр | `IngestService.ingest` (funnel есть), но адаптеры проводятся вручную | (опц.) `ChannelAdapter`+registry — ≈20%, не блокер |
| Стабильное промежуточное представление | element/node | ✅ `IdeaBlock` | нет дельты |
| Извлечение решений/идей/целей = модуль | Haystack component / LlamaIndex transform | ✅ specialist по signalType (реестр+switch) | нет дельты (работает) |
| **Извлечение ЗАДАЧ = модуль на спайне** | тот же паттерн | ❌ **5 путей мимо спайна, нет task-signalType** | **Фаза 1: достроить спайн задачами** |
| Единый резолвер атрибута (исполнитель) | entity-matching по доступным признакам | ⚠️ богатый `AssigneeResolverService` есть, 2-3 пути мимо | Фаза 2: доуказать на существующий, удалить дубль |
| Единый дедуп + идемпотентность | docstore hash-map / generic updater | ⚠️ 2 копии (link/delete) + 1 канон на Issue | Фаза 3: один сервис, явная семантика + guard гонки |
| Пункт назначения decoupled | sink как конфиг | ❌ зашит в каждый сервис | (трек B) `EntitySink` |
| Новая СУЩНОСТЬ = 1 файл | registry + descriptor | ❌ правка в 5 местах | (трек B) дескриптор-реестр |

---

## 6. Матрица вариантов (унификация ЗАДАЧ — корень) + доказательство

| Критерий (ограничения Z) | A. Точечный клей (статус-кво+) | B. Strangler-fig унификация (★) | C. Big-bang: registry-рефактор всех + дроп Task |
|---|---|---|---|
| Задачи на едином спайне | нет | **да (новый task-signalType + 1 specialist)** | да |
| Один резолвер исполнителя | нет | **да (доуказать на сущ. `AssigneeResolverService`)** | да |
| Один дедуп | нет | **да (link-семантика на `TaskSource` + guard)** | да |
| Новая сущность = 1 файл | нет | нет (отдельный трек B) | да |
| Blast-radius | мин | **средний (новый сигнал+специалист, читатели не трогаем)** | **очень высокий (15+ читателей, публичное API)** |
| Обратимость | — | **да (Task как пред-слой, промоут)** | **нет (дроп Task: теряются sourceStartMs/Quote/confidence/extractorVersion)** |
| Ломает внешний контракт (public-api) | нет | нет | **да (`meetings.public.controller` читает Task)** |
| Единый стек / prompt-cache | да | да | риск (дробление combined ломает кэш) |
| Карго-культ для масштаба Z (1 команда) | — | нет | **да (рефактор работающих специалистов ради симметрии)** |
| Срок/риск | низкий, но не решает | **средний, решает корень** | высокий, избыточно |

Источник оценок: внутренние мапперы (код, `[verified]`) + red-team (независимый retrieval, strangler-fig/FK-merge/BullMQ-идемпотентность).

**ADR-доказательство (почему B):**
- **Контекст Z:** одна команда, ~100 модулей, спайн графа уже единый, `Task` несёт провенанс встречи (таймкоды), публичное API читает `Task`.
- **Steelman C:** «сделать красиво раз и навсегда — registry + один тип задачи». Отвергнут: blast-radius несоразмерен (15+ читателей, **публичный контракт**), необратимая потеря провенанса, FK-merge в Postgres держит `AccessExclusive`-локи, а graph-spine **уже** расширяем (новый канал = 1 адаптер) — registry решает несуществующую проблему расширяемости графа. 60-80% больших переписываний не окупаются `[verified: microservices.io strangler-fig]`.
- **Steelman A:** «не трогать, латать». Отвергнут как недостаточный: не убирает 2 модели/4 резолвера/2 дедупа, новый канал по-прежнему не даёт задач.
- **B побеждает:** решает корень при среднем обратимом blast-radius, не ломает публичный контракт, идёт strangler-fig'ом (пред-слой→промоут), переиспользует уже существующие `AssigneeResolverService` и `TaskSource`.

---

## 7. Трек B (опциональный, ОТДЕЛЬНОЕ ТЗ позже): модульный реестр экстракторов под новые СУЩНОСТИ

Внешний ресёрч (§4.2/4.3) даёт валидный паттерн `EntityHandler`-registry, который превращает «новая сущность = правка в 5 местах» в «1 файл». **Но red-team прав:** это **quality-улучшение под будущие сущности**, а не лекарство от фрагментации задач, и **рефакторить все работающие специалисты ради симметрии — карго-культ для масштаба Z**. Поэтому: вынести в **отдельный трек/ТЗ**, низкий приоритет, делать **только** когда реально появится N+1-я сущность; начать с самого болезненного места — 9 хардкод-persist в `specialists-combined.service.ts:32-188` (там реальная связанность), не трогая router/специалисты. Не бандлить с унификацией задач.

---

## 8. Рекомендация

**Вариант B (strangler-fig унификация задачного извлечения), порядок фаз:**
1. **Достроить спайн задачами:** ввести task-`signalType` (`task_item`/`action_item`) + case в `RouterService` + один `specialist-task` (поверх `IdeaBlock`, материализует `Issue` с `sourceBlockIds`), постепенно замещая 5 ad-hoc путей. Не в `COMBINED_COVERED`.
2. **Один резолвер:** доуказать `meeting`/`chatbox`/`telegram`-пути на существующий `AssigneeResolverService` (контракт `AssigneeResolution` уже принят в ТЗ 2026-06-22 §2); каналы с готовой identity (встреча `participantUserId`, помощник `говорящий`, внешний `responsibleExternalId`) резолвер **не вызывают** — fuzzy только для текстовых каналов; удалить дубль-класс + substring.
3. **Один дедуп:** свести 2 Task-дедупа в канонический `TaskDedupService` на `Issue`, семантика **link через `TaskSource`** (provenance), + конкурентный guard (advisory-lock/unique на семантический ключ) против гонки «встреча+чат об одной задаче».
4. **Task = пред-слой:** объявить `Task` явным слоем «AI-кандидат», `Issue` — каноном; однонаправленный промоут `Task→Issue`; **не** дропать `Task` сейчас.

Трек B (реестр под новые сущности) — отдельным ТЗ, позже.

---

## 9. Открытые развилки — ВЛАДЕЛЬЦУ (каждая с рекомендацией)

**Р-1. Схлопывать `Task`→`Issue` или оставить пред-слоем с промоутом?**
Необратимо (теряются `sourceStartMs` deep-link по таймкоду записи, `assigneeRaw`, `sourceQuote`, `confidence`, `extractorVersion` A/B-история), ломает 15+ читателей включая **дашборд директора, недельные отчёты и публичное API**.
→ **Рекомендую: НЕ схлопывать. `Task` = явный пред-слой «AI-кандидат», `Issue` = канон, однонаправленный промоут.** Обратимо, не ломает публичный контракт. Полный дроп — отдельным ТЗ, когда промоут обкатан (strangler-fig).

**Р-2. Семантика единого дедупа: `link` (мягкая связь, провенанс) или `delete` (физическое удаление дубля)?**
→ **Рекомендую: `link`-by-default через `TaskSource`** («одна задача — N источников» = суть продукта «память компании»); `delete` оставить опцией только для дублей внутри одной встречи.

**Р-3. Combined-fast-path (1 LLM на 9 сущностей) — оставить meeting-only или обобщить на все каналы?**
→ **Рекомендую: оставить meeting-only.** Для не-meeting каналов поштучный dispatch достаточен; обобщение = риск регресса качества/стоимости ради редкого кейса. Асимметрия — сознательная.

**Р-4. Новый `signalType` для задач (миграция enum) — да, новый `SourceType` на каждый канал — нет?**
→ **Рекомендую: новый task-`signalType` ввести** (без него Фаза 1 невозможна), **новый `SourceType` НЕ плодить** — переиспользовать `external`.

**Р-5. Трек B (реестр экстракторов под новые сущности) — делать сейчас или отложить?**
→ **Рекомендую: отложить** до появления реальной N+1-й сущности; не бандлить с задачами.

---

## 10. Допущения и риски (pre-mortem)

- `[ASSUMPTION feasibility]` Новый task-`signalType` корректно проставится block-ingest'ом из payload-hint (как уже делает tracker.adapter для `signalTypeHint`). Проверить: распознаёт ли `block-extraction` нужный сигнал на задачных формулировках. Критичность high.
- `[RISK]` Гонка «встреча+чат об одной задаче» при едином дедупе без транзакционного guard'а — BullMQ не идемпотентен сам по себе `[verified: bullmq docs]`. Митигировать unique-constraint/advisory-lock.
- `[RISK]` Промоут `Task→Issue` без включённого `tracker.meetingTasksAlwaysPromote` (A2) обнажит пустую вкладку (Issue=0). A2 уже на dev (`df071d7a`) — предусловие.
- `[RISK desirability]` «Задача на отдел/роль» (collective) — резолвер уже умеет `collective`, но `Issue` хранит только `userId`; адресация на отдел = отдельная продуктовая развилка (вне этого анализа, см. tasks-lifecycle-audit §8).

---

## 11. Ограничения и непроверенное

- `[unverified]` Точное число прямых `prisma.task.*` читателей — red-team насчитал «15+», внутренний маппер «11+»; расхождение из-за разных дат среза/глубины grep. Перед ТЗ — точный реестр читателей (это меняет оценку Фазы 4, не вывод).
- `[inferred]` «6 механических точек для нового специалиста» — оценка по структуре, не прогон.
- `[claimed→понижено]` Вендорские описания LlamaIndex/Haystack/Onyx — первоисточники-доки (verified), но «лучшесть» паттерна под Z — `inferred` (наша оценка под ограничения Z, не измерение).
- Внешний fan-out по graph-memory OSS (Graphiti/Cognee/Mem0) — `triangulated`, не глубокий teardown; для архитектурного решения достаточно, для деталей реализации — добрать при ТЗ.

## 12. Конфликт источников (вынесен явно)

**Первый проход (ingestion-spine-audit §5) vs код:** первый проход утверждал «задачи идут через спайн по signalType автоматически». **Код опроверг** (`router.service.ts`: `commitment/plan_item→goals`, task-sink нет) `[verified]`. Сторона кода принята. → `ingestion-spine-unification-audit.md` §5 содержит эту ошибку и помечен на исправление (задачи **не** на signalType-спайне; completion-сигналы — частично).

## Источники
- Z-код (vexp+Read, `[verified]`): `router.service.ts`, `specialist-routing-dispatcher.worker.ts`, `specialist-3-*.worker.ts`, `ingest.service.ts`, `assignee-resolver.service.ts`, `task-assignee-resolver.service.ts`, `meeting-task-dedupe.service.ts`, `cross-source-task-dedupe.service.ts`, `task-dedup.service.ts`, `schema.prisma` (Task:1759/Issue:9256/TaskSource), `migrate-task-to-issue.ts`, `meeting-action-items.service.ts`.
- Внешние `[verified]`: Airbyte/Singer/Meltano/n8n docs; LlamaIndex IngestionPipeline; Haystack 2.x custom-components; Unstructured.io; Onyx data-flows; NestJS DiscoveryService (docs+source).
- Red-team `[verified]`: [microservices.io strangler-fig](https://microservices.io/post/refactoring/2023/06/21/strangler-fig-application-pattern-incremental-modernization-to-services.md.html) · [Azure strangler-fig](https://learn.microsoft.com/en-us/azure/architecture/patterns/strangler-fig) · [BullMQ idempotent-jobs](https://docs.bullmq.io/patterns/idempotent-jobs) · [Skowron: migrating FK Postgres](https://thomas.skowron.eu/blog/migrating-foreign-keys-in-postgresql/) · [GoCardless zero-downtime Postgres](https://gocardless.com/blog/zero-downtime-postgres-migrations-the-hard-parts) · [Entity-matching heterogeneity survey (arXiv)](https://arxiv.org/html/2508.08076v1).
- `[triangulated]`: Graphiti/Zep, Cognee, Mem0, Quivr (обзоры + репозитории).
