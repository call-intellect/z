---
type: tz
status: ready-to-implement
feature: unified-task-extraction
date: 2026-06-23
owner: Сергей (владелец продукта Кора)
relates_to:
  - plans/analysis/2026-06-22-unified-extraction-spine-and-modular-extractors.md
  - plans/analysis/2026-06-22-ingestion-spine-unification-audit.md
  - plans/analysis/2026-06-22-tasks-lifecycle-deep-audit.md
  - plans/tz/2026-06-22-meeting-to-tracker-and-models-unified-fix.md
---
> Анализ: `plans/analysis/2026-06-22-unified-extraction-spine-and-modular-extractors.md` (research-complete) · Статус согласования развилок: 2026-06-23 (Р-1…Р-5 закрыты владельцем)

# ТЗ: Унификация извлечения ЗАДАЧ на общий спайн (strangler-fig)

**Принцип.** Приём всех каналов уже единый (`IngestService.ingest`→`RawEvent`→`block-ingest`→`IdeaBlock`→`RouterService` по `signalType`→специалисты). Решения/идеи/цели достаются **модульно** (специалист над `IdeaBlock`). **Задачи — нет:** их нет на спайне `signalType`, они извлекаются 5 кустарными путями, живут в 2 моделях (`Issue`/`IntakeIssue` vs legacy `Task`/`TaskSource`), резолвятся 4 резолверами, дедупятся 2 копиями. Это ТЗ доводит задачи до того же модульного спайна **инкрементально (strangler-fig), без необратимых ломающих изменений** — по решениям владельца Р-1…Р-5.

---

## 1. Цель + Зачем

**Цель.** Сделать извлечение задач **модульным над общим спайном**: один спайн-экстрактор задач (для всех каналов, кроме встреч, где зрелый транскрипт-экстрактор оправдан), **один** резолвер исполнителя, **один** дедуп, **один** видимый пункт назначения (`Issue`), с `Task` как явным пред-слоем «AI-кандидат». Тогда новый канал даёт задачи **без отдельного воркера**, а одна задача из встречи+чата = **один** артефакт.

**Зачем (болезненное состояние, доказано в анализе/аудитах).** Задача из чата живёт в legacy `Task`, невидимой трекеру; одна и та же задача из встречи и чата двоится (дедупы видят только `Task`, не `Issue`); 4 резолвера ведут себя по-разному; новый канал даёт решения «бесплатно», а задачи — нет (задач **нет** на `signalType`-спайне). Метрика «решено»: (а) задача из не-meeting канала проходит спайн-экстрактором в `Issue`; (б) одна задача из 2 источников = один `Issue` со связью `TaskSource`; (в) все текстовые каналы зовут один резолвер; (г) новый канал (generic `POST /api/v1/ingest`) с action-формулировкой даёт `Issue` без нового кода.

---

## 2. REALITY-CHECK (фактический статус по коду dev, verified)

> `path:line` — на момент написания; **перед правкой перечитать** (оркестратор верифицирует по якорю-символу).

- **Реестр специалистов УЖЕ есть** `[verified]`: `RouterService.SPECIALIST` (const, `router.service.ts:52-80`), `PRIORITY` (`:104-131`), `matchSpecialists` switch (`:251-496`), `COMBINED_COVERED` (`:82-97`). Диспетчер — `SpecialistRoutingDispatcherWorker` с `Map<jobName,handler>` + `register(NAME,handler)` (`specialist-routing-dispatcher.worker.ts:43,80-101,145-162`). **Цена нового специалиста = ~6 механических точек** (новый ключ в `SPECIALIST` + строка в `PRIORITY` + ветка в `matchSpecialists` + Worker+Service + `register()`/inject + провайдер в `workers.module`).
- **Контракт специалиста ЕДИНЫЙ** `[verified]`: `static SPECIALIST_NAME` + `async handle(job)` (guard'ы block_not_found/tenant_mismatch/not_canonical/signal_out_of_scope) → `svc.processBlock({tenantId, blockId})` (`specialist-3-14-goals.worker.ts:14-89`, `:processBlock` в `specialist-3-14-goals.service.ts:192`). Provenance — `sourceBlockIds: string[]` с guard `{has: block.id}` против дублей при ретраях.
- **signalType `task_*` СУЩЕСТВУЮТ, но это эхо-события трекера, НЕ извлечение** `[verified]`: `schema.prisma:463-470` (`task_created/task_status_changed/task_blocked/task_completed/...`) заполняются `tracker.adapter` из lifecycle-событий issue (`SIGNAL_TYPE_MAP['issue.created']='task_created'`, `tracker.adapter.ts:54-58`) — это «issue изменился → в граф», обратное направление. `commitment`/`plan_item`→`3-14-goals` (ЦЕЛИ). **Task-sink (извлечение «надо сделать X» из транскрипта/чата в задачу) в `RouterService` НЕТ.** → нужен НОВЫЙ signalType для извлечения (Р-4).
- **Богатый единый резолвер УЖЕ есть** `[verified]`: `tracker/AssigneeResolverService` с контрактом `AssigneeResolution = resolved|not_found|ambiguous|collective` (`assignee-resolver.service.ts:8-12`), 4-tier матч + `SubjectMemory` + `detectCollective`. **`me-tasks` БОЛЬШЕ НЕ бросает 404** (`me-tasks.service.ts:121-159`, с A2 `df071d7a`). Дубли-резолверы под удаление: `knowledge-core/TaskAssigneeResolverService` (участники встречи), substring в `telegram-task-parser.resolveAssigneeId` (`:556-589`), `intake-auto-triage.resolveAssigneeUserId` (`:728-746`).
- **Канонический единый дедуп УЖЕ есть на `Issue`** `[verified]`: `tracker/TaskDedupService` (`task-dedup.service.ts:22-55`, suggest-not-merge, калибровка). 2 Task-дедупа — буквальный копипаст одной KNN+gray-band(0.07)+LLM машины с **разной финальной семантикой**: `meeting-task-dedupe` → `deleteMany` (delete), `cross-source-task-dedupe` → `link` через `TaskSource` (`@@unique([taskId,sourceType,sourceRefId])`).
- **`Task` несёт поля, которых НЕТ на `Issue`** `[verified]`: `sourceStartMs/sourceEndMs` (deep-link по таймкоду записи), `assigneeRaw`, `sourceQuote`, `confidence`, `extractorVersion` (`schema.prisma:1779-1800`). → дроп `Task` необратим (Р-1: НЕ дропаем).
- **Предусловие безопасности ВКЛЮЧЕНО** `[verified]`: `tracker.meetingTasksAlwaysPromote` (A2) ON на dev (`df071d7a`) — meeting→`Issue` всегда (иначе промоут обнажил бы пустую вкладку).
- **chatbox-Task уже всплывает в `/intake`** `[verified]` (`intake.service.ts:507-574`, read-union) — Фаза 4 промоут опирается на это.

**Вывод REALITY-CHECK:** ~50% целевых абстракций (резолвер-контракт, канонический дедуп на Issue, read-union chatbox, A2-промоут, реестр специалистов) **уже существуют**. Это **достройка спайна + доуказание на существующее**, а не постройка с нуля. Главная новизна — task-`signalType` + спайн-специалист (Фаза 1).

---

## 3. Принятые решения владельца (2026-06-23, НЕ пересматривать)

| # | Решение | Обоснование |
|---|---|---|
| Р-1 | `Task` — явный пред-слой «AI-кандидат», `Issue` — канон трекера; однонаправленный промоут `Task→Issue`. **НЕ** дропать `Task` сейчас | Дроп необратим (теряются `sourceStartMs`/`assigneeRaw`/`sourceQuote`/`confidence`/`extractorVersion`), ломает 15+ читателей вкл. дашборд директора и **публичное API**. Strangler-fig: обратимо, не ломает контракты. Полный дроп — отдельным ТЗ позже |
| Р-2 | Единый дедуп — семантика **LINK** через `TaskSource`; `delete` — опция только для дублей внутри одной встречи | «Одна задача — N источников» = суть «памяти компании»; провенанс ценнее для графа/клона |
| Р-3 | `SpecialistsCombined`-fast-path остаётся **meeting-only** (не обобщать) | Это перф-фича батча транскрипта; обобщение = риск регресса качества/стоимости ради редкого кейса |
| Р-4 | Ввести **новый** task-`signalType` (`action_item`) + case в `RouterService`; новый `SourceType` НЕ плодить (переиспользовать `external`) | Существующие `task_*` — эхо-события трекера (обратное направление). Без сигнала-извлечения спайн-экстрактор невозможен. Новый `SourceType` на каждый канал = лишние миграции |
| Р-5 | Модульный реестр экстракторов под будущие сущности (EntityHandler/DiscoveryService) — **ОТДЕЛЬНЫМ ТЗ позже**, в этот объём НЕ включать | Это quality-улучшение под N+1-ю сущность, не лекарство от фрагментации задач; рефактор работающих специалистов ради симметрии — карго-культ для масштаба Z (red-team) |

**Решение проектировщика (Б-1, не развилка владельца): meeting-extract-actions ОСТАЁТСЯ транскрипт-экстрактором встреч.** Спайн-специалист покрывает **не-meeting** каналы (chat/bitrix/telegram/generic-API/будущие), заменяя их слабые legacy-`Task`-пути. **Почему:** `meeting-extract-actions` зрелый и roomChat-aware (`meeting-extract-actions.service.ts:120-479`); переписывать его на `IdeaBlock` = риск регресса качества ради симметрии (challenge-loop «не код ради кода / не регресс»). Унификация достигается тем, что **ВСЕ** каналы (и встреча, и спайн-специалист) сходятся на `IntakeIssue` → единый резолвер (Фаза 2) → единый дедуп (Фаза 3) → `Issue`. Полное слияние в один экстрактор — vNext, не в этом ТЗ.

---

## 4. Доказательство выбора

Полная матрица вариантов (A статус-кво+ / **B strangler-fig (выбран)** / C big-bang registry+дроп Task) с критериями и источниками — в анализе §6. Кратко: **B** решает корень при **среднем обратимом** blast-radius, не ломает публичный контракт, переиспользует существующие `AssigneeResolverService`/`TaskDedupService`/`TaskSource`; **C** забракован (необратим, ломает 15+ читателей + public-api, карго-культ для масштаба Z — red-team с независимым retrieval: strangler-fig > big-bang, 60-80% переписываний не окупаются); **A** недостаточен (не убирает 2 модели/4 резолвера/2 дедупа).

---

## 5. Scope

**Входит:**
- Ф1: task-`signalType` `action_item` (миграция enum) + case в `RouterService` + спайн-специалист задач (Worker+Service над `IdeaBlock`, материализует `IntakeIssue`) для не-meeting каналов; kill-switch режима.
- Ф2: доуказание meeting/chatbox/telegram-путей на единый `AssigneeResolverService`; удаление дубль-резолвера + substring.
- Ф3: сведение 2 Task-дедупов в `TaskDedupService` (link-семантика на `TaskSource`) + конкурентный guard.
- Ф4: `Task` как явный пред-слой + однонаправленный промоут `Task→Issue`.

**НЕ входит (с судьбой):**
- Дроп таблицы `Task` + переписывание 15+ прямых `prisma.task.*` читателей → **vNext-ТЗ** `plans/tz/<later>-drop-legacy-task-model.md` (Р-1).
- Модульный реестр экстракторов под новые сущности (EntityHandler/DiscoveryService) → **vNext-ТЗ** трек B (Р-5).
- `ChannelAdapter`-registry для приёма (≈20% из анализа §4.1) → vNext, не блокер.
- Адресация задачи на отдел/роль (collective→несколько исполнителей; `Issue` хранит только `userId`) → продуктовая развилка вне этого ТЗ (tasks-lifecycle-audit §8); резолвер уже возвращает `collective`, материализация на отдел — не здесь.
- Полное слияние meeting-extract-actions в спайн-специалист (Б-1) → vNext.

---

## 6. Граничные контракты с другими ТЗ

- **A2 (`tracker.meetingTasksAlwaysPromote`)** — реализован (`df071d7a`), **предусловие**, здесь НЕ трогаем, считаем ON.
- **Probe-дозапрос исполнителя/срока** (`task.assignee_unresolved`/`task.due_date_missing`) — реализован в meeting-to-tracker-fix; спайн-специалист при `not_found` адресата **переиспользует** существующий probe-вызов (`meeting-extract-actions.service.ts:415-440` как образец), не вводит новый.
- **`IntakeAutoTriageWorker`** — целевой общий хвост: спайн-специалист пишет `IntakeIssue(source=<канал>)`, дальше существующий авто-триаж промоутит в `Issue` (как для meeting). Здесь НЕ переписываем триаж, только подаём в него.

---

## 7. Контракты (канон для копипасты)

### 7.1 Миграция enum (Ф1)
```prisma
// schema.prisma enum SignalType — добавить значение (рядом с task_discussion:63 / commitment:427)
enum SignalType {
  // ... существующие ...
  action_item   /// «надо сделать X» — извлечённое поручение/задача из транскрипта/чата/текста
                /// (направление ИЗВЛЕЧЕНИЯ; в отличие от task_created — эхо-события трекера).
}
```
> `prisma:migrate -- --name add_signaltype_action_item`; зарегистрировать в `apply-prod-deploy.ts` (миграция доезжает `migrate deploy`). Шаг 4 prod-deploy-log.

### 7.2 RouterService — case + реестр (Ф1)
```ts
// router.service.ts — SPECIALIST const (:52-80): добавить
TASKS: '3-15-tasks',          // jobName консумера; менять = breaking change
// PRIORITY (:104-131): добавить строку 3-15-tasks с приоритетом (ниже decisions/goals)
// matchSpecialists (:251-496): новый case
case 'action_item':
  targets.add(RouterService.SPECIALIST.TASKS);
  break;
// COMBINED_COVERED (:82-97): НЕ добавлять (Р-3 — задачи вне combined)
```

### 7.3 Спайн-специалист (Ф1) — контракт по образцу specialist-3-14
```ts
// specialist-3-15-tasks.worker.ts
export class Specialist315TasksWorker implements SpecialistHandler {
  static readonly SPECIALIST_NAME = RouterService.SPECIALIST.TASKS;
  async handle(job: Job<SpecialistRoutingJobData>): Promise<void> {
    // guard'ы block_not_found/tenant_mismatch/not_canonical/signal_out_of_scope (как 3-14:26-89)
    await this.svc.processBlock({ tenantId, blockId });
  }
}
// specialist-3-15-tasks.service.ts
async processBlock(args: { tenantId: string; blockId: string }): Promise<void> {
  // 1) читает IdeaBlock (canonical, signalType=action_item)
  // 2) формирует кандидата задачи (title/sourceQuote/dueHint из блока)
  // 3) резолвит исполнителя через ЕДИНЫЙ AssigneeResolverService (Ф2)
  // 4) единый дедуп TaskDedupService (Ф3) ПЕРЕД записью
  // 5) пишет IntakeIssue(source=<канал блока>, sourceBlockIds:[blockId], meetingId? из provenance)
  //    → существующий IntakeAutoTriageWorker промоутит в Issue
}
```
> Регистрация: `register(Specialist315TasksWorker.SPECIALIST_NAME, this.tasks)` + inject в `specialist-routing-dispatcher.worker.ts`; провайдер в `workers.module.ts`.

### 7.4 Единый резолвер (Ф2) — контракт уже существует
```ts
// assignee-resolver.service.ts:8-12 (НЕ менять контракт)
export type AssigneeResolution =
  | { kind:'resolved'; userId:string; name:string; via:'name'|'memory' }
  | { kind:'not_found' }
  | { kind:'ambiguous'; candidates:{userId:string;name:string}[] }
  | { kind:'collective'; label:string; departmentId?:string; roleId?:string };
```
**Режимы (red-team):** каналы с готовой identity (встреча `participantUserId`, помощник `говорящий`, внешний `responsibleExternalId`) резолвер **НЕ вызывают** — identity уже известна; fuzzy-резолв (через `AssigneeResolverService`) — **только** для текстовых каналов (имя строкой).

### 7.5 Единый дедуп (Ф3)
- Целевой сервис — `tracker/TaskDedupService` (на `Issue`/`IntakeIssue`). Семантика **LINK** через `TaskSource` (Р-2): дубль не удаляется, а связывается (`upsert TaskSource{taskId/issueId, sourceType, sourceRefId}`); `delete`-режим — только для дублей-черновиков внутри одной встречи (meeting-task-dedupe legacy-кейс).
- **Конкурентный guard (обязателен):** BullMQ сам не идемпотентен — два канала об одной задаче параллельно проходят «open tasks» и оба создают. Guard: `@@unique` на семантическом ключе ИЛИ Postgres advisory-lock по `(tenantId, нормализованный_title_hash)` вокруг evaluate→create. `[verified: bullmq docs — repeating jobs не дедупят сами]`.

### 7.6 Крутилки/флаги (AdminSetting, Ship-On)
| Ключ | Тип | Дефолт | Назначение |
|---|---|---|---|
| `tracker.taskExtractionMode` | kill-switch | `spine` (ON) | `spine`=спайн-специалист авторитетен для не-meeting каналов; `legacy`=аварийный откат на старые пути при инциденте |
| `tracker.taskDedupLinkSemantics` | kill-switch | `link` (ON) | link через TaskSource (Р-2); откат на per-meeting delete только аварийно |
> Реестр + сид + строка в `feature-flags.md`. Старые legacy-`Task`-экстракторы (chatbox task-extraction, telegram-task-parser) при `spine` — **bypass** (не плодят дубль), при `legacy` — возвращаются. Ship-On: новое ON сразу, kill-switch только для инцидента.

---

## 8. Фазы (dependency-ordered)

Граф: **Ф1 → Ф2 → Ф3 → Ф4** строго последовательно (Ф2 единый резолвер нужен Ф1-специалисту; Ф3 дедуп — после того как все пишут через резолвер; Ф4 промоут — после единого дедупа). Каждая фаза — отдельный суб-агент за сессию.

### Фаза 1 — Достроить спайн задачами (спайн-специалист)
**Цель.** Не-meeting каналы дают задачи через `signalType=action_item` → спайн-специалист → `IntakeIssue` → существующий авто-триаж → `Issue`.
**Входит:** миграция enum `action_item` (7.1); тегирование блоков `action_item` (в `block-extraction`/`block-distill`: из `signalTypeHint` канала + LLM-детект action-формы — образец `tracker.adapter` signalTypeHint + meeting-extract gate-формы `task-quality-gate.util.ts`); RouterService case+PRIORITY+SPECIALIST.TASKS (7.2, НЕ в COMBINED_COVERED); `Specialist315TasksWorker`+`Service` (7.3) + регистрация; kill-switch `tracker.taskExtractionMode` (7.6); bypass legacy-`Task`-экстракторов при `spine`.
**Не входит:** meeting-extract-actions (остаётся, Б-1); единый резолвер (Ф2 — пока специалист зовёт существующий `AssigneeResolverService` напрямую); дедуп (Ф3).
**Файлы:** `schema.prisma` (enum), `router.service.ts`, `specialist-routing-dispatcher.worker.ts`, `workers.module.ts`, новые `specialist-3-15-tasks.{worker,service}.ts`, `block-extraction`/`block-distill` (тег action_item), `chatbox-analyze.worker.ts`/`telegram-task-parser.service.ts` (bypass при spine), registry+seed+typed-config (kill-switch).
**Acceptance (машинно):**
- grep `action_item` в `SignalType` enum + `prisma migrate` создал файл; `bun run prisma:generate` зелёный.
- grep `TASKS: '3-15-tasks'` в `router.service.ts`; `action_item`→`SPECIALIST.TASKS` в matchSpecialists; `3-15-tasks` НЕ в `COMBINED_COVERED`.
- unit: `IdeaBlock(signalType=action_item, source=chatbox, canonical)` → `processBlock` создаёт `IntakeIssue(source=chatbox, sourceBlockIds=[blockId])`; повтор того же блока (ретрай) → не дублирует (guard `sourceBlockIds:{has}`).
- unit: kill-switch `legacy` → спайн-специалист bypass, старый путь активен; `spine` → старый legacy-`Task` путь bypass.
- интеграц: блок из generic-API канала с action-формой → `IntakeIssue` (новый канал даёт задачи без нового кода).
- `bun run typecheck`(вкл .spec)/`lint`/`build` зелёные.
**Закрывает:** корень «задачи не на спайне» (анализ §3); метрика (а),(г).

### Фаза 2 — Единый резолвер исполнителя
**Цель.** Все текстовые task-пути зовут один `AssigneeResolverService`; каналы с готовой identity его не зовут; дубль-резолвер удалён.
**Входит:** спайн-специалист (Ф1) и `chatbox`/`telegram`-пути переключены на `tracker/AssigneeResolverService` (контракт 7.4); каналы с `participantUserId`/`responsibleExternalId`/`говорящий` — прямой путь без fuzzy; удалить `knowledge-core/TaskAssigneeResolverService` (или сделать тонким адаптером, поставляющим участников как кандидатов в единый резолвер) + substring `telegram-task-parser.resolveAssigneeId:556-589`.
**Не входит:** дедуп (Ф3); meeting-extract-actions внутренняя логика (он уже отдаёт participants identity).
**Файлы:** `specialist-3-15-tasks.service.ts`, `telegram-task-parser.service.ts`, `chatbox-analyze.worker.ts`, `task-assignee-resolver.service.ts` (удаление/адаптер), потребители удаляемого резолвера (греп импортов).
**Acceptance:**
- grep: `TaskAssigneeResolverService` больше не импортируется НИГДЕ, кроме (опц.) тонкого адаптера; substring-матч в telegram удалён.
- unit: текстовый канал, имя «Сергею» (склонение) → `resolved` через единый резолвер (4-tier, склонения) — раньше substring давал `not_found`.
- unit: meeting-канал с `participantUserId` → identity взята напрямую, fuzzy-резолвер НЕ вызван (мок: `resolve` не дёрнут).
- unit: «отдел дизайна» без правила → `collective` (единый резолвер), задача создаётся без исполнителя + probe (как A6).
- per-tenant: резолв только в рамках `tenantId`.
- typecheck/lint/build зелёные; тесты затронутых модулей.
**Закрывает:** 4 резолвера → 1; метрика (в).

### Фаза 3 — Единый дедуп (link-семантика + guard гонки)
**Цель.** Один дедуп-сервис на `Issue` с семантикой LINK через `TaskSource`; гонка «встреча+чат» закрыта.
**Входит:** свести `meeting-task-dedupe.service` (delete) и `cross-source-task-dedupe.service` (link) в канонический `tracker/TaskDedupService`; вынести общую KNN+gray-band(0.07)+LLM-арбитр машину в один сервис с параметром политики (`link` дефолт / `delete` опция для within-meeting черновиков); кросс-дедуп против открытых `Issue` (не только `Task`); конкурентный guard (7.5 — `@@unique` на семантическом ключе ИЛИ advisory-lock); kill-switch `tracker.taskDedupLinkSemantics`.
**Не входит:** удаление модели `Task` (Р-1); промоут (Ф4).
**Файлы:** `meeting-task-dedupe.service.ts`, `cross-source-task-dedupe.service.ts`, `task-dedup.service.ts`, общий dedup-util, `schema.prisma` (если `@@unique` для guard'а — миграция), registry+seed (kill-switch).
**Acceptance:**
- unit: задача из встречи + семантически совпадающая из чата → один `Issue` + `TaskSource` со ДВУМЯ источниками (link, не delete); ничего не удалено.
- unit: 2 параллельных кандидата с одинаковым нормализованным title → ровно один `Issue` (guard; второй линкуется/skip, не создаёт дубль).
- unit: within-meeting дубль-черновик при политике `delete` → удалён (обратная совместимость).
- grep: общий KNN/gray-band/LLM-арбитр в ОДНОМ модуле (нет копипаста cosine/judgeSame в двух файлах).
- идемпотентность: повторный прогон дедупа = no-op.
- typecheck/lint/build зелёные.
**Закрывает:** 2 дедупа → 1; метрика (б); гонка.

### Фаза 4 — `Task` как пред-слой + однонаправленный промоут
**Цель.** `Task` — явный слой «AI-кандидат», `Issue` — канон; промоут `Task→Issue`; читатели `Task` НЕ переписываются (не дропаем).
**Входит:** пометить семантику `Task` как пред-слоя (док + поле/коммент по месту, без дропа); реализовать однонаправленный промоут `Task→Issue` (переиспользовать существующий `triageChatboxTask`/`migrate-task-to-issue.ts` как образец — `intake.service.ts:917+`, `migrate-task-to-issue.ts:214-322`); chatbox-Task из read-union `/intake` промоутится в `Issue` на accept (уже частично есть, B2 meeting-to-tracker-fix) — довести до однонаправленного канона; `TaskSource` несёт связь после промоута.
**Не входит:** дроп таблицы `Task`, переписывание 15+ прямых `prisma.task.*` читателей (vNext-ТЗ, Р-1).
**Файлы:** `intake.service.ts`, `migrate-task-to-issue.ts` (образец/переиспользование), `meeting-action-items.service.ts` (уже за флагом), док `second-brain/01_projects/tracker.md`.
**Acceptance:**
- интеграц: chatbox-`Task` → промоут → `Issue` (linkedSource=chatbox), `Task` помечен promoted (не удалён); идемпотентно (повтор не плодит второй `Issue`).
- промоут однонаправленный: нет обратного `Issue→Task`.
- читатели `Task` (daily-brief/dashboard/public-api) продолжают работать (Task не дропнут) — smoke grep, что прямые `prisma.task.*` не тронуты.
- typecheck/lint/build зелёные.
**Закрывает:** Р-1; «задача из чата не видна» окончательно (через Issue).

---

## 9. Pre-mortem / Риски (для strict-production-review-gate)

| Риск | Митигировать | Проверять на ревью |
|---|---|---|
| Гонка дедупа (2 канала об одной задаче параллельно) — BullMQ не идемпотентен `[verified]` | конкурентный guard `@@unique`/advisory-lock (7.5) | есть ли guard вокруг evaluate→create; тест на параллель |
| Тег `action_item` не проставляется на реальных задачных блоках → спайн-специалист молчит | детект формы (signalTypeHint + LLM gate-форма), метрика «блоков с action_item», тест на реальных формулировках | покрытие тегирования; метрика растёт |
| Двойное создание: meeting-extract-actions + спайн-специалист на одном meeting | спайн-специалист покрывает НЕ-meeting (Б-1); дедуп (Ф3) ловит остаток | meeting не идёт через спайн-специалист при дефолте |
| Промоут без A2 → пустая вкладка | A2 ON (предусловие, REALITY-CHECK) | флаг A2 ON |
| Удаление дубль-резолвера сломает потребителей | греп всех импортов перед удалением; адаптер если нужен | 0 битых импортов |
| Регресс качества при замене legacy-путей | kill-switch `taskExtractionMode=legacy` (аварийный откат) | kill-switch работает |
| Задача на отдел/роль (`collective`) — `Issue` хранит только `userId` | вне scope; резолвер вернёт `collective`, материализация без отдела + probe | не падает на collective |

**Совместимость с prompt caching:** спайн-специалист, если делает LLM-вызов извлечения, — стабильный SYSTEM, переменные (блок) в конце user (как существующие специалисты). Тегирование `action_item` переиспользует существующий `block-extraction`/детект-формы — новый SYSTEM не вводить без нужды. Раздел обязателен в реализации.

---

## 10. Idempotency / флаги / prod-deploy

- Миграция enum `action_item` → `prisma:migrate` + регистрация в `apply-prod-deploy.ts` (доезжает `migrate deploy`); **Шаг 4** prod-deploy-log.
- 2 kill-switch (`tracker.taskExtractionMode`, `tracker.taskDedupLinkSemantics`) → registry + сид (идемпотентный) + строки в `feature-flags.md`; **Шаг 7**.
- Если Ф3 вводит `@@unique` для guard'а → миграция, **Шаг 4**.
- Новый специалist/воркер `3-15-tasks` → **Шаг 12** smoke (grep в логах диспетчера; метрика специалиста).
- Новых ENV нет (всё AdminSetting).

---

## 11. DoD

typecheck (вкл. `.spec`)/lint/build зелёные; vitest по затронутым + сценарии Acceptance каждой фазы; second-brain обновлён (`01_projects/tracker.md` — спайн-специалист задач + промоут; `02_architecture/knowledge-core.md` — новый signalType+специалист; `ai-jobs.md`/`workers-queues.md` — `3-15-tasks`); `feature-flags.md` + `prod-deploy-log.md` (миграция enum + kill-switch); `04_не-сделано` — закрыть строку «задачи фрагментированы / не на спайне», открыть строки vNext (дроп Task; реестр экстракторов); рефлексия. Каждая фаза `[ ]`→`[x]` по мере приёмки.

## 12. Итог
_(заполнит tz-orchestrator после реализации)_
