---
type: tz
status: ready-to-implement
feature: task-extraction-pipeline-unification
date: 2026-06-29
owner: владелец
relates_to:
  - plans/architecture/2026-06-29-task-extraction-pipeline-unification.md
  - plans/analysis/2026-06-29-task-extraction-pipeline-unification.md
  - plans/analysis/2026-06-29-commitment-task-unification.md
  - plans/architecture/2026-06-29-commitment-task-unification.md
  - plans/architecture/2026-06-30-extraction-layer-rewrite.md   # зонтик (вариант А) — перебивает Ф5/Ф6, см. AMENDMENT
  - plans/tz/2026-06-30-extraction-layer-rewrite.md             # rewrite-ТЗ: combo эмитит tasks[] (Ф7), вывод meeting-extract (Ф11г)
  - plans/analysis/2026-06-30-extraction-change-map-pre-tz.md   # §5 — граница потоков, координация router.service.ts
---

> Архитектура (одобрена владельцем): `plans/architecture/2026-06-29-task-extraction-pipeline-unification.md` (status: approved, 2026-06-29) · Анализ: `plans/analysis/2026-06-29-task-extraction-pipeline-unification.md` · Статус согласования: 2026-06-29.

> **⚠️ AMENDMENT 2026-06-30 — вариант А (задачи внутри общего агента). Перебивает Ф5/Ф6.**
> Владелец решил (2026-06-30): задачи достаёт **общий разборщик** ([карта изменений](../analysis/2026-06-30-extraction-change-map-pre-tz.md) · [blueprint, approved](../architecture/2026-06-30-extraction-layer-rewrite.md)) тем же проходом, что и граф, из **уже разобранного полного разговора** (не из сырого суточного текста) — **отдельного задачного движка и суточного крона НЕТ**. Что меняется в фазах ниже:
> - **Ф5 (`ConversationTaskExtractorService`) и Ф6 (суточный крон) — ОТМЕНЕНЫ.** Их роль выполняет общий агент: он уже запускается на разговор/встречу и канало-агностичен (WP-A переписывания), per-channel суточные адаптеры и cron не нужны. Снимается и watch-item «полный сырой текст ×3.5»: общий агент читает разобранный (не сырой) полный разговор.
> - **Ф1 (контракт `subtasks[]`) и Ф3 (промпт «обещание=задача») — это КОНТРАКТ черновика задачи, который обязан выдавать общий агент.** Текст промпта/схемы переезжает в общего агента (рейтрайт-ТЗ), семантика (ВР2/ВР3) — отсюда.
> - **Ф2 (`checklistJson` + материализация), Ф4 (`TaskDraftMaterializerService`), Ф7 (вывод per-block спайна), дедуп — ОСТАЮТСЯ.** Это **трекер-сторона**: общий агент отдаёт task-черновики в `TaskDraftMaterializerService`, дальше всё как описано.
> - **`MeetingExtractActionsService` (задачи из встреч, `analyze.worker.ts:399-404`) под вариантом А убирается** — его роль закрывает combo (единственный движок задач). **Снос — rewrite-ТЗ Ф11(г), СРАЗУ после combo-задач (Ф7), БЕЗ A/B** (владелец не может сравнивать — ВР8 rewrite; страховка — рубильник + метрики + разовая проверка глазами). **НЕ рефакторить meeting-extract на материализатор** (Б1/Ф4 в этой части не выполняем — combo его заменяет).
> - **Все ссылки НИЖЕ на Ф5/Ф6 читать через эту отмену:** граф зависимостей (Ф1→Ф5, Ф4→Ф5, Ф2→Ф5, Ф5→Ф6, (Ф5,Ф6)→Ф7), гейт Ф7 «только после Ф5+Ф6» (вкл. контракт-first «Вывод спайна» и pre-mortem), флаг `tasks.conversationDailyEnabled`, cron-smoke `conversation-tasks-daily`, тесты «e2e по каналам Ф5» — **НЕ применяются**. Гейт вывода спайна Ф7 = **rewrite Ф7 (combo эмитит `tasks[]`) + Ф2 (канало-агностичность)**; суточный флаг/крон не нужны — combo идёт под рубильником `specialistsCombinedEnabled` (rewrite Ф1).
> **Итог:** этот файл — владелец **трекер-стороны** задач (материализация · чек-лист · дедуп · входящие · снос per-block спайна 3-15) + **контракт черновика**; **извлечение** задач (вкл. встречи) делает общий агент; **вывод meeting-extract — rewrite Ф11(г), сразу после Ф7, без A/B** (ВР8). Координация `router.service.ts` (`action_item→TASKS` ↔ WP-B) — §5 [карты изменений](../analysis/2026-06-30-extraction-change-map-pre-tz.md).

# ТЗ: Единый движок задач из разговора (унификация извлечения «вверх»)

**Принцип.** Задачи извлекаются из **полного сырого текста разговора за сутки** (как из транскрипта встречи), одним движком для всех каналов. Нарезчик (`block-ingest`) — универсальный понимающий слой графа (память/клон/решения/цели) — **не трогается**: один и тот же дневной текст читают двое (нарезчик для памяти + задачный движок целиком для задач). Per-block задачный спайн (`specialist-3-15-tasks`) выводится из роли источника задач.

**Вне scope / отложено владельцем:** соц-слой обещаний и дашборды (см. [[2026-06-29-commitment-task-unification]]); связь «обещание↔цель» (`commitment`→GOALS остаётся для целей/памяти, не трогаем — `second-brain/04_не-сделано/README.md:42`); ручное «вынести пункт в задачу» (vNext); подзадачи с отдельным исполнителем/сроком (сознательно нет).

## Цель + Зачем

**Болезненное состояние (по факту кода).** Из встреч задачи извлекаются хорошо (полный транскрипт), а из переписки — куце:
- «Я сделаю X к пятнице» в чате классифицируется как `commitment` и роутится в Цели (`router.service.ts:426`), где `goal-extract` отбрасывает → **в трекер не попадает**.
- Несколько пунктов одного дела режутся нарезчиком на разные блоки, а `specialist-3-15-tasks` обрабатывает блоки **поодиночке** → либо россыпь карточек, либо ни одной (порог confidence 0.45 не пройден по отдельному обрывку).

**Что решение даёт (числа/исходы):** обещание из переписки за сутки → задача себе со сроком; N пунктов одному человеку → **1 карточка + чек-лист на N пунктов** (не N карточек); одно дело со встречи + повтор в чате → 1 артефакт (не дубль).

## REALITY-CHECK (фактическое состояние кода на 2026-06-29)

- **Движок встреч жив и зрелый.** `MeetingExtractActionsService.extract({tenantId, meetingId})` ([meeting-extract-actions.service.ts:129](../../backend/src/modules/tracker/services/meeting-extract-actions.service.ts#L129)) читает полный транскрипт (`transcript.turns`/`roomChat`), строит `PromptInput` (`:195-208`), зовёт LLM `taskType:'meeting-extract-actions'`, валидирует `TASKS_SCHEMA`, создаёт `IntakeIssue` в цикле (`:322-512`).
- **Промпт уже generic.** `buildMeetingExtractActionsPrompt` → `buildTasksPromptUnified` ([tasks-unified.ts](../../backend/src/modules/ai/services/prompts/tasks-unified.ts)) принимает `dialog/participants/orgContext/roomChat`. Схема ответа **плоская, без подзадач**.
- **Схема одной задачи описана в 3+ местах синхронно** (см. Контракт-first). Все `.strict()` — лишнее поле в ответе LLM роняет валидацию.
- **Трекер уже умеет:** `Issue.parentId` + `IssueChecklist`/`IssueChecklistItem` (текст+галочка, без исполнителя/срока, счётчики `checklistTotalCount/DoneCount` — [schema.prisma:9567](../../backend/prisma/schema.prisma#L9567)); `ChecklistsService.createChecklist/bulkCreateItems` (recountCounters встроена в bulk); **эталон материализации `Issue + чек-листы` уже есть** — `IssueMaterializeService.materialize()` ([issue-materialize.service.ts:18-61](../../backend/src/modules/tracker/services/issue-materialize.service.ts#L18)).
- **`IntakeIssue` НЕ имеет поля для подзадач** ([schema.prisma:10221-10288](../../backend/prisma/schema.prisma#L10221)) — нужна новая nullable-колонка `checklistJson Json?`.
- **Per-block спайн** `specialist-3-15-tasks`: единственный роут `action_item→TASKS` — [router.service.ts:430-432](../../backend/src/modules/knowledge-core/services/router.service.ts#L430); `commitment→GOALS` — `:426`. **Единственный потребитель `action_item` для создания задач** (проверено: `day-report-collector.service.ts:43` лишь читает граф — не ломается).
- **Каналы кормят хаб:** messaging `chat-ingest` (per-message), conversational adapter (per-event), bitrix daily-cron, chatbox session. **Эталон «разговор целиком одним RawEvent»** — `ChatboxIngestService.ingestSession` ([chatbox-ingest.service.ts:204](../../backend/src/modules/chatbox/chatbox-ingest.service.ts#L204)), `renderTranscript`/`TranscriptMessage` экспортированы (`:58-75`).
- **Крон-эталон:** `@Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)` + per-tenant sweep + очередь с идемпотентным jobId — `bitrix-analyze.cron.ts:26`; утилиты окна — `operations/utils/local-date.ts` (`localDayWindowUtc/getLocalDate`, `DEFAULT_TIMEZONE='Europe/Moscow'`).
- **Дедуп готов к переиспользованию:** `TaskDedupService.evaluate({tenantId,title,description?,excludeIssueId?})` ([task-dedup.service.ts:94](../../backend/src/modules/tracker/services/task-dedup.service.ts#L94)) — никогда не бросает, NIL при сбое, kill-switch `taskDedup.enabled`.

## Принятые решения владельца (не пересматривать)

| # | Решение | Обоснование |
|---|---|---|
| ВР1 | Задачи из переписки — из **полного суточного текста разговора**, не из блоков | Одобренная архитектура; обе боли — про межблоковый контекст |
| ВР2 | Обещание (твёрдое, с действием) = самоназначенная задача; мягкое — нет | Одобрено 2026-06-29; как на встречах |
| ВР3 | Подзадачи = чек-лист пунктов в одной карточке, **один исполнитель** | Одобрено; не плодить карточки; модель уже есть |
| ВР4 | Единица = **суточное окно по одному разговору** (тред/диалог), по локальной TZ | Одобрено; переписку забираем раз в сутки |
| ВР5 | Per-block спайн выводится из источника задач; нарезчик и прочие специалисты — не трогаем | Одобрено; нарезчик кормит память |
| ВР6 | Встречи — тот же движок (частный случай), не второй источник | Одобрено |
| ВР7 | Задача из переписки → во «Входящие»; уверенные — авто-приём как сейчас | Не заваливать трекер сырьём |

**Доказательство выбора** (4 варианта, состязательно) — в анализе `plans/analysis/2026-06-29-task-extraction-pipeline-unification.md` (вариант «унификация вверх» — единственный решает обе цели чисто и симметрично, не трогая граф).

## Принятые технические решения (Б — мои, с обоснованием)

| # | Решение | Почему |
|---|---|---|
| Б1 | Вынести цикл материализации drafts→IntakeIssue из `meeting-extract` в общий `TaskDraftMaterializerService`; и встречи, и новый движок зовут его | «Один движок» (ВР6); один путь дедупа/чек-листа/idempotency; убирает дублирование |
| Б2 | Подзадачи хранить до промоута в `IntakeIssue.checklistJson Json?` (форма `{title?, items:{text}[]}[]` как `IssueTemplateConfig.checklist`) | Карточка intake живёт между извлечением и accept; ручной триаж должен видеть пункты; материализация одним кодом в обоих accept-местах |
| Б3 | Новый движок читает текст и ловит И поручения, И обещания напрямую из промпта (не зависит от `signalType`) | Унификация вверх: создание задач больше не зависит от роутинга нарезчика |
| Б4 | Per-block спайн вывести **полностью** (убрать роут + регистрацию + провайдеры), не «оставить мёртвым» | Принцип «нет склада выключенного»; Ship-On |
| Б5 | conversational-канал (бот): «разговор» = синтетический `(tenantId, userId, сутки)` — у него нет треда | По коду нет родительской сущности; группируем по автору за день |
| Б6 | Дедуп при создании из переписки — переиспользуем `TaskDedupService.evaluate` (как в спайне сейчас) | Готов, best-effort, suggest без авто-merge (R13 дедупа) |

## Scope

**Входит:** подзадачи-чек-лист в контракте извлечения и материализации (все каналы, включая встречи); усиление промпта «обещание=задача себе»; общий материализатор drafts; новый `ConversationTaskExtractorService` + per-channel адаптеры суточного окна; суточный крон+очередь с kill-switch; вывод per-block задачного спайна; метрики/тесты/прод-шаги.

**Не входит** (каждый — с судьбой): соц-слой/дашборды обещаний → [[2026-06-29-commitment-task-unification]]; `commitment`→GOALS-маршрут (остаётся) → отдельный анализ `04_не-сделано:42`; «вынести пункт в задачу» вручную → vNext; подзадачи с отдельным исполнителем/сроком → сознательно нет; полное удаление кода `MeetingExtractActionsService` → не нужно (он становится тонким caller'ом общего материализатора, не сносится).

## Граничные контракты с другими подсистемами

- **block-ingest / нарезчик / остальные специалисты** — НЕ трогать. `action_item`-блоки продолжают создаваться и читаться графом (поиск, `day-report-collector`). Меняем только: убрать роут `action_item→TASKS`.
- **`commitment`→GOALS** (`router.service.ts:426`) — оставить как есть (цели/память). Новый движок ловит обещания из текста сам, не через этот роут.
- **TaskDedupService** — вызывать как есть, не менять контракт.
- **IntakeAutoTriageWorker / IntakeService.triage** — точки accept, куда добавляем материализацию чек-листа; логику авто-приёма по confidence не меняем.

## Контракт-first (канон для копипасты)

### Схема ответа LLM — добавить `subtasks[]` СИНХРОННО во все места
`subtasks` — массив строк-пунктов одной задачи (текст шага). Форма в ответе модели:
```
"subtasks": [ { "title": "написать текст" }, { "title": "согласовать макет" } ]   // или null/отсутствует
```
Точки синхронного изменения (все обязательны — иначе `.strict()` уронит валидный ответ):
1. `common.ts:247-258` — `TaskItemSchema` (Zod `.strict`): добавить `subtasks: z.array(z.object({ title: z.string().min(1) }).strict()).nullable().optional()`.
2. `meeting-extract-actions.service.ts:240-269` — inline JSON-schema `responseFormat` (properties.tasks.items.properties): добавить `subtasks`.
3. `meeting-extract-actions.service.ts:210-226` — TS-тип `parsedTasks` (добавить `subtasks?`).
4. `tasks-unified.ts:47-85` — `buildTaskItemSchemaUnified` (Zod-builder, под флагом `withSubtasks`).
5. `tasks-unified.ts:92-171` — `buildTasksToolUnified` (JSON-tool-builder).
6. `tasks-unified.ts:25-37` + `:223-249` — опция `withSubtasks` в `TasksPromptOptions` + новый `SUBTASKS_BLOCK` в `buildSystemUnified`.
7. `tasks.ts:30-45` — `buildMeetingExtractActionsPrompt` включает `withSubtasks:true`.
8. Цикл создания `:322-512` (после рефактора — общий материализатор) — читает `t.subtasks` → `IntakeIssue.checklistJson`.

Текст `SUBTASKS_BLOCK` (промпт, человеческим языком для модели): «Если одно поручение явно состоит из нескольких шагов одного исполнителя — верни их в `subtasks` (список коротких формулировок-шагов), а саму задачу одной записью. НЕ дроби на отдельные задачи то, что является шагами одного дела одного человека. Если задача атомарная — `subtasks` пустой/отсутствует.»

### Новая колонка (Prisma)
```prisma
// model IntakeIssue (schema.prisma:10221+) — добавить:
checklistJson Json?   /// AI-предложенные подзадачи-пункты до промоута: [{ title?, items:[{text}] }]; материализуются в IssueChecklist при accept
```
Миграция: `bun run prisma:migrate` (push-режим запрещён в коммит). Триггер prod-deploy-log Шаг 4. Прод почти пуст — nullable безопасно.

### Материализация чек-листа (эталон — `IssueMaterializeService:41-58`)
```ts
const issue = await this.issues.create(projectId, dto, tenantId, createdById);
for (const cl of intake.checklistJson ?? []) {
  const items = (cl.items ?? []).map(i => i.text.trim().slice(0, 500)).filter(Boolean).slice(0, 50);
  if (items.length === 0) continue;
  const created = await this.checklists.createChecklist(issue.id, { title: cl.title ?? 'Чек-лист' }, tenantId);
  await this.checklists.bulkCreateItems(created.id, { checklistId: created.id, lines: items }, tenantId);
}
// recountCounters НЕ звать — встроена в bulkCreateItems
```
Сигнатуры (дословно, `checklists.service.ts`): `createChecklist(issueId, {title?}, tenantId)` `:47`; `bulkCreateItems(checklistId, {checklistId, lines:string[]}, tenantId)` `:190` (lines: 1..50, каждая 1..500).
Точки вставки: `intake-auto-triage.worker.ts` сразу после `created = await this.issues.create(...)` `:524`; `intake.service.ts` сразу после `createdIssue = await this.issues.create(...)` `:731`. Обернуть в try/catch (best-effort, как соседние блоки).

### Выбор «сутки по одному разговору» (per-channel)
| Канал | «Один разговор» | Выборка за сутки D (локальная TZ → `localDayWindowUtc`) |
|---|---|---|
| messaging | `Conversation.id` (`feedsGraph=true`) | `Message` where `conversationId`, `createdAt ∈ [from,to)`, `deletedAt=null`, `authorType!='system'`; текст — `CryptoService.decrypt(content)`; автор — `authorUserId` (person резолвить через user→person) |
| bitrix | `BitrixDialogSession.id` | `BitrixMessage` where `sessionId`, `externalCreatedAt ∈ [from,to)` |
| chatbox | `ChatboxChatSession.id` | реюз `ingestSession`-сборки turns |
| conversational (бот) | синтетика `(tenantId, userId)` (Б5) | `RawEvent` источника `conversational` за сутки по `payload.userId` |
Turns строить в формате `TranscriptMessage`/`DialogTurn` (реюз `renderTranscript`/`TranscriptMessage` из `chatbox-ingest.service.ts:58-75`).

### Суточный крон + очередь (эталон bitrix)
```ts
@Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { name: 'conversation-tasks-daily' })
// под kill-switch AdminSetting 'tasks.conversationDailyEnabled' (default ON, Ship-On)
// per-tenant → перебор разговоров с сообщениями за прошедшие локальные сутки → enqueue
// jobId = `convo-tasks-${channel}-${conversationKey}-${YYYY-MM-DD}` (идемпотентность BullMQ)
```
Idempotency задачи: `IntakeIssue.externalId = sha1(channel + conversationKey + dayLocal + (sourceQuote||title))[:24]` (зеркало `makeExternalId` `meeting-extract:535`) — повторный прогон не плодит дубль.

### Дедуп (реюз)
`TaskDedupService.evaluate({tenantId, title, description})` → `{verdict:'same'|'different'|'nil', matchedIssueId, ...}`; на `'same'` → пометить `suggestedDuplicateOfIssueId`/LINK (как `specialist-3-15-tasks.service.ts:166-178`), без авто-merge.

### Вывод per-block спайна
Убрать `case 'action_item': targets.add(RouterService.SPECIALIST.TASKS); break;` (`router.service.ts:430-432`); убедиться, что LLM-fallback (`:480-498`) не возвращает TASKS для `action_item` (иначе исключить). Убрать регистрацию `Specialist315TasksWorker` в `specialist-routing-dispatcher.worker.ts:103` + провайдеры/импорт в `workers.module.ts:184-185,:16,:53` + файлы спайна. **Только после Ф5+Ф6 (новый движок покрывает action_item на всех каналах)** — иначе регресс.

## Границы фичи

- ✅ **Always:** новый движок и материализатор переиспользуют существующее (prompt builders, dedup, checklist, intake); idempotency на каждом проходе; tenantId во всех запросах; метрики prom-client + логи pino.
- ⚠️ **Ask first:** менять контракт `IssuesService.create` / `TaskDedupService` / схему `IssueChecklist`; трогать `block-ingest`/нарезчик/др. специалистов.
- 🚫 **Never:** `process.env.*` мимо `TypedConfigService`; `prisma migrate`-обход (только `prisma:migrate` файл-миграция); `new PrismaClient()` в скриптах; авто-merge дублей; авто-приём обещаний без порога; трогать соц-слой обещаний/Цели.

## Фазы

Граф зависимостей: **Ф1 → Ф2**; **Ф1 → Ф5**; **Ф3** независима; **Ф4 → Ф5**; **Ф2 → Ф5**; **Ф5 → Ф6**; **(Ф5,Ф6) → Ф7**; всё → **Ф8**. Параллелятся: Ф3 с Ф1/Ф2/Ф4.

### [ ] Ф1 — Подзадачи в контракте извлечения (схема + промпт)
**Ценность:** как руководитель на встрече, получаю задачу с подзадачами-чек-листом вместо россыпи, потому что движок теперь умеет вернуть шаги одной задачи.
Картография: см. «Контракт-first», 8 точек синхронного добавления `subtasks[]`.
Что входит: добавить `subtasks` во все 8 мест; `withSubtasks`-флаг + `SUBTASKS_BLOCK`; `buildMeetingExtractActionsPrompt(withSubtasks:true)`.
Что НЕ входит: материализация (Ф2), новый движок (Ф5).
Acceptance: `bun run typecheck`/`lint`/`build` зелёные; `bunx vitest run` по затронутым prompt-спекам; юнит: ответ LLM с `subtasks` проходит `TASKS_SCHEMA.safeParse` (раньше падал на `.strict()`); grep `subtasks` присутствует во всех 8 файлах-якорях.
Закрывает: R3, R4 (контракт).

### [ ] Ф2 — `IntakeIssue.checklistJson` + материализация чек-листа в accept
**Ценность:** как исполнитель, вижу одну карточку с чек-листом «0 из N», а не N карточек, потому что подзадачи материализуются при приёме.
Картография: миграция `checklistJson`; `intake-auto-triage.worker.ts:524`; `intake.service.ts:731`; реюз `IssueMaterializeService:41-58`; `ChecklistsService` DI в оба класса (`tracker.module`).
Что входит: колонка + Prisma generate; запись `checklistJson` при создании IntakeIssue (meeting-extract цикл уже пишет subtasks → в checklistJson); материализация в обоих accept-местах (try/catch best-effort); `meeting-extract` начинает писать subtasks.
Что НЕ входит: новый движок (Ф5), крон (Ф6).
Acceptance: миграция применяется и откатываемо-безопасна (nullable); e2e: IntakeIssue с `checklistJson` из 3 пунктов → после авто-приёма у Issue `checklistTotalCount=3`, `checklistDoneCount=0`, 1 `IssueChecklist` + 3 `IssueChecklistItem`; пустой `checklistJson` → задача без чек-листа, без ошибок; повторный прогон не плодит чек-листы (idempotent по externalId). `typecheck/lint/build` зелёные.
Закрывает: R3, R4.

### [ ] Ф3 — Усилить промпт «обещание = задача себе»
**Ценность:** как сотрудник, моё «я сделаю X к пятнице» становится задачей на мне со сроком, потому что промпт явно трактует обещание как самоназначение.
Картография: `tasks-unified.ts:175-199` (BASE_SYSTEM/STRUCTURED_BASE_SYSTEM), `SELF_ASSIGNMENT_RULE:173`, примеры.
Что входит: усилить формулировку «твёрдое обязательство с действием = задача себе (исполнитель=автор реплики, срок=названный); мягкое пожелание — НЕ задача» + 2-3 few-shot примера (хорошо/плохо). Совместимость с prompt caching: правки только в стабильном SYSTEM (не в конце user) — кэш не ломается.
Что НЕ входит: routing commitment (не трогаем), новый движок.
Acceptance: golden-фикстуры: «ок, я к пятнице докручу лендинг» → задача, assignee=говорящий, due=пятница; «надо бы как-нибудь обновить прайс» → НЕ задача; `bunx vitest run` по prompt-спекам зелёный.
Закрывает: R2.

### [ ] Ф4 — Общий `TaskDraftMaterializerService` (вынести из meeting-extract)
**Ценность:** как воркер задач любого канала, использую один материализатор drafts→IntakeIssue (дедуп+чек-лист+idempotency), чтобы встречи и переписка шли одним кодом.
Картография: цикл `meeting-extract-actions.service.ts:322-512` (резолв исполнителя :342-384, externalId :327/535, IntakeIssue.create :425-454, probe :464-492, enqueue auto-triage :496-511).
Что входит: вынести материализацию в `TaskDraftMaterializerService.materialize({tenantId, channel, sourceRef, drafts, participants, orgContext})`; `meeting-extract` рефакторится на вызов (паритет поведения — тесты до/после); включить запись `checklistJson` из `draft.subtasks`.
Что НЕ входит: новый источник (Ф5).
Acceptance: существующие спеки `meeting-extract-actions*.spec.ts` зелёные без изменения ожиданий (паритет); новый юнит на материализатор (создание/идемпотентность/дедуп-suggest/чек-лист). `typecheck/lint/build` зелёные.
Закрывает: R6 (часть), R11.

### [⛔ ОТМЕНЕНА — вариант А] Ф5 — `ConversationTaskExtractorService` + per-channel адаптеры суточного окна
> Заменена: задачи достаёт общий разборщик (см. AMENDMENT вверху). Отдельный движок не создаём. Ниже — для истории.
**Ценность:** как руководитель, мои поручения и обещания из переписки за день становятся задачами (с подзадачами), потому что Кора читает дневной разговор целиком, как встречу.
Картография: `PromptInput`-сборка `meeting-extract:195-208`; `orgContext.load`; turns-формат `renderTranscript`/`TranscriptMessage` (chatbox `:58-75`); per-channel выборки (см. таблицу); `TaskDraftMaterializerService` (Ф4); `TaskDedupService.evaluate`.
Что входит: `extractForConversationDay({tenantId, channel, conversationKey, dayLocal})` → собрать turns+participants+orgContext → `buildMeetingExtractActionsPrompt` (псевдотип встречи «Переписка за DD.MM») → LLM → материализатор (с subtasks) → дедуп; per-channel адаптеры (messaging/bitrix/chatbox/conversational) строят turns из суточного окна; self-assign по автору turn (резолв userId/person).
Что НЕ входит: крон-триггер (Ф6); вывод спайна (Ф7).
Acceptance: e2e на messaging-разговоре: день с «я докручу лендинг к пятнице» + 3 проговорённых шага → 1 IntakeIssue, assignee=автор, due=пятница, `checklistJson`=3 пункта; повтор того же дела, что уже есть открытой задачей → `verdict='same'` → suggest, не дубль; conversational синтетика по userId+день работает. `typecheck/lint/build` зелёные.
Закрывает: R1, R2, R5, R9.

### [⛔ ОТМЕНЕНА — вариант А] Ф6 — Суточный крон + очередь (kill-switch)
> Заменена: общий разборщик уже запускается на разговор/встречу — отдельный суточный крон не нужен (см. AMENDMENT вверху). Ниже — для истории.
**Ценность:** как компания, задачи из переписки появляются раз в сутки автоматически по каждому разговору, потому что есть суточный проход.
Картография: эталон `bitrix-analyze.cron.ts:26` + `local-date.ts` (`localDayWindowUtc`); очередь по образцу `bitrix-analyze.queue.service.ts` (jobId-идемпотентность); AdminSetting-флаг.
Что входит: `@Cron(EVERY_DAY_AT_MIDNIGHT)` per-tenant → перебор разговоров с сообщениями за прошедшие локальные сутки → enqueue `extractForConversationDay` с `jobId=convo-tasks-${channel}-${key}-${date}`; kill-switch `tasks.conversationDailyEnabled` (AdminSetting, default ON, реестр `feature-flags.md`); регистрация очереди/воркера в WorkersModule.
Что НЕ входит: вывод спайна (Ф7).
Acceptance: повторный прогон крона за те же сутки = no-op (jobId + externalId — 0 новых задач); флаг OFF → проход не запускается (лог); метрика «обработано разговоров/создано задач за проход». `typecheck/lint/build` зелёные; smoke: очередь и cron видны в grep WorkersModule.
Закрывает: R6, R12, R13.

### [ ] Ф7 — Вывод per-block задачного спайна
**Ценность:** как система, имею один источник задач (разговор целиком), без дублирующего per-block пути, потому что спайн `3-15-tasks` выведен.
Картография: `router.service.ts:430-432` (роут), `:480-498` (LLM-fallback), `specialist-routing-dispatcher.worker.ts:103`, `workers.module.ts:184-185,:16,:53`, файлы спайна.
Что входит: убрать роут `action_item→TASKS`; проверить, что fallback не возвращает TASKS (иначе исключить `action_item`); убрать регистрацию/провайдеры/импорт спайна и файлы `specialist-3-15-tasks.{worker,service}.ts`.
Что НЕ входит: трогать другие специалисты, `commitment`→GOALS, нарезчик.
Acceptance: `action_item`-блок более не создаёт IntakeIssue через спайн (e2e/grep: нет вызова `Specialist315Tasks*`); `day-report-collector` по-прежнему читает `action_item` из графа (спек зелёный); поиск/память по `action_item` целы; `typecheck/lint/build` зелёные; grep: 0 ссылок на удалённый спайн.
Закрывает: R7, R8.

### [ ] Ф8 — Observability, e2e, прод-шаги, second-brain
**Ценность:** как оператор, вижу метрики/логи нового прохода и уверен в выкате.
Что входит: метрики prom-client (разговоров обработано, задач создано, дублей-suggest, ошибок) + логи pino с `SystemLogPipeline`; e2e по каналам; обновить `second-brain/01_projects/tracker.md` + `ai-jobs.md`/`workers-queues.md`; `docs/operations/prod-deploy-log.md` (Шаг 4 миграция, Шаг 12 smoke cron/queue); `docs/operations/feature-flags.md` (новый kill-switch); `04_не-сделано` (закрыть строки 42-43 в части action_item/commitment-из-переписки).
Acceptance: метрики экспонируются на `/metrics`; e2e зелёные; second-brain/prod-deploy-log/flags обновлены.
Закрывает: R14.

## Сквозные аспекты (чек анти-забывания)
- **RBAC/tenant:** все выборки/создания — с `tenantId`; задача создаётся системным user'ом во «Входящие», доступ — как у текущих intake. ✅ в каждой фазе.
- **Observability:** Ф8 (метрики+логи). Новый воркер/cron без метрик — нарушение.
- **Errors+idempotency:** externalId + jobId; материализация best-effort try/catch; дедуп best-effort. Ф2/Ф5/Ф6.
- **Миграция данных:** только новая nullable-колонка; backfill не нужен `[N/A: историческую переписку не доразбираем — суточный проход идёт вперёд]`.
- **Rollout/флаг:** kill-switch `tasks.conversationDailyEnabled` (Ship-On, ON) — Ф6.
- **Тесты:** golden-фикстуры промпта (Ф3), материализатор (Ф4), e2e по каналам (Ф5/Ф8).

## Pre-mortem / Риски
- **Регресс при выводе спайна раньше времени.** Митигейт: Ф7 строго после Ф5+Ф6 (граф зависимостей); до Ф7 оба пути сосуществуют, но дубли гасит `TaskDedupService` (suggest).
- **`.strict()` рассинхрон схемы.** Митигейт: Ф1 меняет все 8 точек разом; acceptance грепает наличие.
- **Шифрованный `Message.content`.** Митигейт: `CryptoService.decrypt` при сборке turns (как chat-ingest `resolveText:78`).
- **`Message` без `authorPersonId`.** Митигейт: резолв user→person в адаптере; self-assign по `authorUserId`.
- **conversational без треда.** Митигейт: синтетика `(userId, день)` (Б5); если шумно — порог/группировка как ASSUMPTION, ревизия по данным.
- **Стоимость LLM.** Один проход на разговор/сутки — дешевле текущего per-block (N вызовов). Не оптимизировать преждевременно.
- **Ревью-аспекты (`strict-production-review-gate`):** tenant-изоляция выборок; идемпотентность крона; отсутствие авто-merge; отсутствие `process.env`/`migrate`/`new PrismaClient`.

## Idempotency / feature-flag / prod-deploy
- **Idempotency:** cron jobId `convo-tasks-${channel}-${key}-${date}` + IntakeIssue `externalId` (sha1). Повтор = no-op (acceptance Ф6).
- **Флаг:** `tasks.conversationDailyEnabled` (AdminSetting, kill-switch, ON) → строка в `docs/operations/feature-flags.md`.
- **prod-deploy-log:** Шаг 4 (колонка `IntakeIssue.checklistJson` + миграция), Шаг 12 (smoke: cron `conversation-tasks-daily` + новая очередь). Миграция применяется автоматически `migrate deploy`.

## DoD
- `bun run typecheck` (вкл. `.spec`), `lint`, `build` зелёные; `bunx vitest run` затронутых — зелёные.
- second-brain обновлён по таблице производных заметок (tracker.md, ai-jobs.md, workers-queues.md).
- prod-deploy-log + feature-flags обновлены; `04_не-сделано` строки 42-43 актуализированы.
- Рефлексия после push.

## Итог
_(заполнит tz-orchestrator по завершении: что реализовано целиком, что осталось.)_
