---
type: tz
status: ready-to-implement
feature: chatbox-memory-finishing-and-tasks-from-chat
date: 2026-06-11
owner: Сергей (sergrv80@gmail.com)
relates_to:
  - plans/tz/2026-06-05-chatbox-integration.md
  - plans/tz/2026-06-10-cabinet-fixes-master.md (§5)
  - plans/analysis/2026-06-10-chatbox-svmazur-analysis.md
  - plans/analysis/2026-06-11-finishable-now-roadmap.md (ТЗ-5)
---

> ЕДИНЫЙ файл-контракт (2026-06-11). Сводит в одно ТЗ: доводку Чат-бокса как источника памяти
> (хвосты §5) + НОВОЕ — задачи из переписки и единую защиту от дублей задач между всеми источниками.
> **Группа 3 (авто-ответ клиента, support-клон Ф5) в это ТЗ НЕ входит** — отложена решением владельца
> (юр-риск раскрытия ИИ; код support Ф1–Ф4 уже готов отдельно).
>
> Документ самодостаточен: REALITY-CHECK и якоря `path:line` проверены по реальному коду на 2026-06-11.
> Перед правкой исполнитель перечитывает якоря (номера строк дрейфуют) — внизу раздел «Картография».

# ТЗ: Чат-бокс как полноценный источник памяти + задачи из переписки + единый дедуп задач

## Принцип
Переписка из Чат-бокса должна работать как ещё один входящий канал — **как встреча**: забрали → нарезали
на сессии → прогнали через тот же конвейер знаний (память/граф/клоны) → **и поставили задачи**. Новое
здесь ровно: (а) довести сопоставление людей и наблюдаемость, (б) научить переписку рождать задачи тем же
разборщиком, что и встреча, (в) ввести **единую** защиту от дублей задач между источниками (встреча ↔
переписка ↔ уже существующие). «Оптимизировать по-своему» запрещено — переиспользуем готовые кирпичи
(`TaskExtractionService`, `ChatboxIngestService`, `chatbox-analyze.worker`, `MeetingTaskDedupeService`,
`EntityResolutionService.resolvePersonByHint`).

## Решения владельца (2026-06-11) — не пересматривать
| # | Решение | Почему |
|---|---|---|
| Р-1 | Задачи из переписки извлекаются **тем же разборщиком, что и у встречи** («всё как у встречи») — он сам решает, что является поручением. | Максимальный охват; не плодим вторую логику; переиспользуем `TaskExtractionService`. |
| Р-2 | При совпадении задачи с уже существующей (из ЛЮБОГО источника) — **новую НЕ создавать, а привязать переписку как ещё один источник** к существующей задаче. | Не засоряем трекер; «решаем корень» — единый межисточниковый дедуп, а не дедуп внутри одного источника. |
| Р-3 | Группа 3 (авто-ответ клиента, support-клон Ф5) — **НЕ в этом ТЗ**. | Юр-риск (раскрытие ИИ) — отдельное согласование. |
| Р-4 | Задачи из переписки **нельзя выкатывать без межисточникового дедупа** (Ф6) — это одна волна. | Иначе дубли пойдут сразу: нынешний дедуп работает только внутри одной встречи и выключен. |

### Открытое решение владельца (НЕ блокирует это ТЗ)
- **Сопоставление по телефону невозможно без новой колонки `Person.phone`** (её сейчас нет — проверено). Клиенты/менеджеры
  Чат-бокса частью имеют телефон, но сопоставлять его не с чем. Каскад Ф1 реализуем как **email → имя (fuzzy)**.
  Если владелец захочет телефон-ступень — это отдельное решение: добавить `Person.phone` + кампанию его заполнения
  (без заполнения колонка даёт нулевой эффект). В этом ТЗ телефон-матчинг НЕ делаем.

---

## REALITY-CHECK (факт по коду на 2026-06-11 — проверено чтением)

**Готово и переиспользуется (не переделывать):**
- Модуль `backend/src/modules/chatbox/*` влит в ветку и работает на проде. Синк → сессии → мост в knowledge-core
  (`chatbox-ingest.service.ts` строит `RawEvent(sourceType='chatbox')` с `transcript.turns` per-message и
  `authorPersonId` менеджера) → `block-ingest.worker` строит память/граф. Часть «как встреча» по ПАМЯТИ — уже так.
- `chatbox-analyze.worker.ts` `process()`: один job = одна закрытая сессия → `analyzing` → best-effort summary →
  `ingestSession` → `done`. **Сюда добавляем шаг задач (Ф5)** — после `ingestSession`.
- Сопоставление менеджеров: `chatbox-sync.service.ts` `autoLinkMembers` — **только по email** (case-insensitive),
  `linkMode='auto'`. Ручной экран менеджеров: `chatbox-members.service.ts` (`linkMember`/`createPersonAndLink`/`listMembers`)
  + `chatbox-members.controller.ts` (GET `/members`, PUT `/members/:id/link`, POST `/members/:id/create-person`) +
  фронт `frontend/app/(authenticated)/chats/integrations/chatbox/managers/*`. **Это образец для аналогичного экрана клиентов.**
- `chatbox-integration.service.ts` — `analysisEnabled ?? true` (анализ ON при подключении) + `patch-enable-chatbox-analysis.ts`
  для уже подключённых. **На проде патч для «Ооо луа» (tenant `cmpndk2tw…`) НЕ накатан** → флаг OFF, анализ не идёт
  (подтверждено логами: `analyze-sweep pending=0`, 0 запусков `ChatboxAnalyze` для этого tenant). Синк при этом работает.
- `chatbox-chats.service.ts` `sendMessage` — уже не падает при ответе ChatBox без `id` (синтетический ключ `kora-out-…` + WARN-лог формы `keys`).
- Задачи: `TaskExtractionService.extractTasks({meetingId, tenantId, meeting:{id,type,title}, dialog: DialogTurn[], participants?})`
  (`task-extraction.service.ts:56`) — извлекает action items, НЕ пишет в БД. Пишет `tasks-extract.worker.ts` — жёстко завязан
  на `Meeting` + `meeting.transcript.turns`, делает `prisma.task.createMany`.
- Дедуп задач: `MeetingTaskDedupeService.dedupeForMeeting({meetingId})` (`meeting-task-dedupe.service.ts`) — **только внутри одной
  встречи** (fast-черновик против canonical той же встречи), embed заголовков + cosine + порог `knowledgeCore.taskDedupeThreshold`
  (0.85) + серая зона 0.07 + LLM-арбитр `task-dedupe`; за флагом `knowledgeCore.taskDedupeEnabled` (дефолт **OFF**).
  **Межисточникового дедупа НЕТ.**
- Fuzzy-резолв имени → Person: `EntityResolutionService.resolvePersonByHint(tenantId, hint)` (`entity-resolution.service.ts:653`)
  — exact по нормализованному имени + ILIKE-подстрока; неоднозначность → null. **Переиспользуем для имя-ступени каскада.**

**Контракт-факт (важно для Ф1/Ф5/Ф6) — проверено:**
- `model Task` (schema.prisma:1712): `meetingId String` (**NOT NULL**, FK→Meeting, onDelete Cascade), `tenantId String?`,
  `userId String`, `assigneeUserId String?` (→User, onDelete SetNull), `assigneeRaw String?`, `evidenceBlockIds String[]`,
  `extractorVersion String?`, `sourceStartMs/EndMs Int?`, `sourceQuote String?`, `confidence Float?`.
  → Для задачи из переписки `meetingId` сделать **nullable** + добавить тип/ссылку источника.
- `model Person` (schema.prisma:4726): `name VarChar(200)`, `email VarChar(320)` (**обязательный**), `userId String?` (NULL до
  accept приглашения), `entityId String?`. **Поля `phone` НЕТ** → телефон-матчинг к Person невозможен (см. «Открытое решение»).
- `ChatboxMember` (schema.prisma:11256): `email?`, `name?`, `role?`, `linkedPersonId?`, `linkMode ChatboxMemberLinkMode`. **phone НЕТ.**
- `ChatboxCustomer` (schema.prisma:11208): `name?`, `phone?`, `email?`, `externalCrmId?`. **Нет** `linkedPersonId/linkMode`.
- `ChatboxChannelClient` (schema.prisma:11229): `name?`, `phone?`, `email?`, `messengerUserId?`, `customerId?`. **Нет** `linkedPersonId/linkMode`.
- `enum ChatboxMemberLinkMode { auto | manual | none }` — **переиспользуем** для клиентов (не плодим новый enum).
- `ChatboxMember.linkedPersonId` → `Person.id` (НЕ `User.id`). Для `Task.assigneeUserId` нужен резолв `Person.userId`
  (best-effort; если `userId=null` — задача без ответственного, `assigneeRaw` хранит имя).
- RBAC-ресурс `chatbox` уже есть (используется `chatbox-members.controller`: `obj:'chatbox'`, act `read`/`manage`).
  Новые эндпоинты клиентов его переиспользуют — **новая политика не нужна**.
- `chatbox.module.ts` — `imports:[PersonsModule]`, перечислены controllers/providers (куда регистрировать новый customers-сервис/контроллер).

**Чего НЕТ — строим:** имя-ступень каскада + связка клиента (миграция + сервис/контроллер + экран); виджет «Чаты в памяти»;
метрики/алерт Чат-бокса; задачи из переписки; единый межисточниковый дедуп задач.

---

## Scope
**Входит:** Ф0 (прод-включение анализа «Ооо луа») · Ф1 (матчинг: имя-каскад + связка клиента) · Ф2 (виджет «Чаты в памяти») ·
Ф3 (метрики синка/анализа + алерт) · Ф4 (разбор WARN sendMessage) · Ф5 (задачи из переписки) · Ф6 (единый дедуп задач) · Ф7 (выкат+доки).

**НЕ входит:** support-клон Ф5 (авто-ответ клиенту) — Группа 3, отдельное согласование; тон-адаптер; телефон-матчинг (нет `Person.phone`);
создание чата из Коры, медиа в S3, двусторонний PATCH клиентов — vNext базового Чат-бокс-ТЗ.

**Граничные контракты (НЕ менять без Ask first):** `IngestService.ingest`; `block-ingest.worker`; сигнатура `TaskExtractionService.extractTasks`
(переиспользуем как есть: для чата `meeting`-дескриптор обобщаем до `{id: chatId, type:'chatbox', title}`); `clone-respond`/Concierge;
нынешний внутривстречный `MeetingTaskDedupeService` (расширяем НОВЫМ сервисом, не ломаем старый).

---

## Контракт данных (Prisma — ФАЙЛОВЫЕ миграции `prisma:migrate`, НЕ db push)

```prisma
// 1) Task (schema.prisma:1712) — источник теперь не только встреча.
//    meetingId → nullable; добавить тип/ссылку источника. Backfill: существующие → sourceType='meeting'.
//    meetingId НЕ удалять; FK остаётся (теперь nullable).
  meetingId           String?   // было String (NOT NULL) → nullable (задача может быть из чата)
  sourceType          String    @default("meeting") /// meeting | chatbox (расширяемо строкой, не enum)
  sourceChatSessionId String?   /// ChatboxChatSession.id — если задача из переписки
  sourceChatId        String?   /// ChatboxChat.id (денорм, для drill-down/ссылки на чат)
// + индексы:
  @@index([tenantId, sourceType])
  @@index([sourceChatSessionId])

// 2) НОВАЯ: дополнительные источники задачи (Р-2 «привязать к существующей»).
//    Первичный источник остаётся на Task.*; сюда пишем КАЖДУЮ привязку при дедупе (след не теряем).
model TaskSource {
  id          String   @id @default(cuid())
  tenantId    String
  taskId      String
  task        Task     @relation(fields: [taskId], references: [id], onDelete: Cascade)
  sourceType  String   /// meeting | chatbox
  sourceRefId String   /// meetingId | chatSessionId
  chatId      String?  /// ChatboxChat.id (денорм, опц.)
  quote       String?  @db.Text /// фрагмент-доказательство из источника
  createdAt   DateTime @default(now())
  @@unique([taskId, sourceType, sourceRefId]) /// идемпотентность привязки
  @@index([tenantId, sourceType, sourceRefId])
}
// → к model Task добавить обратную связь: sources TaskSource[]

// 3) ChatboxCustomer (schema.prisma:11208) и ChatboxChannelClient (schema.prisma:11229) — связка клиента с Person (Ф1).
  linkedPersonId String?               /// → Person.id (в Person не пишем; как у ChatboxMember)
  linkMode       ChatboxMemberLinkMode @default(none) /// reuse существующего enum
// + индекс [tenantId, linkedPersonId] на обе модели.
```
> Миграция Task — опасное изменение core-таблицы: только nullable-добавление, **без drop**, `meetingId` не удаляем.
> Backfill `backend/scripts/backfill-task-source-type.ts` (через `createPrismaClient()`): всем существующим `Task` проставить
> `sourceType='meeting'`. Зарегистрировать в `apply-prod-deploy.ts STEPS` (phase backfill, `skipBootstrap`).

## AdminSetting (пороги — не ENV/код)
- `chatbox.match.name_fuzzy_enabled` (bool, default true) — ступень fuzzy-сопоставления по имени (телефон-ступени нет: Person без phone).
- `tasks.cross_source_dedupe_threshold` (number, default 0.85) — порог семантической близости задач для межисточникового дедупа.

## Флаги (Ship-On → docs/operations/feature-flags.md)
- `chatbox.taskExtraction.enabled` — **kill-switch (ON)**: извлечение задач из переписки. Выкатывается ВКЛючённым ВМЕСТЕ с Ф6.
- `tasks.crossSourceDedupe.enabled` — **kill-switch (ON)**: единый межисточниковый дедуп. Неотделим от Ф5 (Р-4).
- (существующий) `knowledgeCore.taskDedupeEnabled` — оставить как есть (внутривстречный дедуп); НЕ переиспользуем для межисточникового.

---

## Фазы (dependency-ordered)
**Граф:** Ф0 (прод, независим) · Ф1 ∥ Ф3 ∥ Ф4 (независимы) · Ф2 (после Ф0 — нужны данные анализа) · **Ф5→Ф6 одна волна**
(задачи из чата нельзя без дедупа, Р-4) · Ф7 (выкат/доки). Ф1 усиливает Ф5 (резолв ответственного), но не блокирует.

### Ф0 — Прод: включить анализ для «Ооо луа» (не код, операция владельца)
- **Цель:** анализ переписки реально идёт у подключённой компании.
- **Действие:** на проде прогнать `patch-enable-chatbox-analysis.ts` (`docker compose exec backend bun run scripts/patch-enable-chatbox-analysis.ts`)
  — включает `analysisEnabled=true` у уже подключённых интеграций; ИЛИ владелец включает тумблер AI-анализа в кабинете «Ооо луа».
- **Acceptance:** в логах `ChatboxAnalyze старт/готово` для tenant `cmpndk2tw…`; `analyze-sweep` показывает `pending>0→enqueued>0`;
  статус сессий → `done`; `RawEvent(sourceType='chatbox')` для tenant существуют.

### Ф1 — Матчинг людей: имя-каскад + связка клиента (§5 Ф2)
- **Цель:** связывать собеседников с карточками людей надёжнее, чем только по email; связывать и клиента, не только менеджера.
- **Входит:**
  - `chatbox-sync.service.ts` `autoLinkMembers` — после email-ступени добавить **имя-ступень** для несвязанных
    (`linkMode != 'manual'`, `linkedPersonId=null`): `resolvePersonByHint(tenantId, member.name)` → при однозначном хите
    `linkedPersonId`+`linkMode='auto'`. Ступень за `AdminSetting chatbox.match.name_fuzzy_enabled` (code-fallback true). Ручную связку не трогаем.
  - Миграция: `linkedPersonId`+`linkMode` (reuse enum `ChatboxMemberLinkMode`) на `ChatboxCustomer` и `ChatboxChannelClient` + индексы.
  - Новый `autoLinkCustomers(tenantId)` (для Customer и ChannelClient): email (case-insensitive) → имя-fuzzy. Вызывать из `syncCustomers`/`syncChannelClients` (или после них во `fullSync`/`incrementalSync`).
  - Новый `ChatboxCustomersService` + `ChatboxCustomersController` — клон `chatbox-members.*`:
    GET `/api/v1/chatbox/customers` (список с резолвом Person), PUT `/api/v1/chatbox/customers/:id/link {personId|null}`,
    POST `/api/v1/chatbox/customers/:id/create-person`. RBAC obj `chatbox` (read/manage). Зарегистрировать в `chatbox.module.ts`.
- **Что НЕ входит:** телефон-матчинг (нет `Person.phone`).
- **Acceptance:** менеджер/клиент без email, но с однозначно совпавшим именем → `linkedPersonId` заполнен, `linkMode='auto'`;
  PUT link ставит `manual`/`none`; повтор синка не перетирает `manual`; неоднозначное имя → не связывает (null). typecheck/lint/build + spec.
- **Тесты:** автосвязка по имени (хит/неоднозначность/manual-не-трогаем), customers link/create-person.

### Ф2 — Виджет «Чаты в памяти» (§5 Ф3)
- **Цель:** наглядная сводка «забрали N диалогов → проанализировали M → породили K карточек/задач».
- **Входит:** агрегатный эндпоинт (счётчики `ChatboxChat`/`ChatboxChatSession` по `analysisStatus` + блоки/задачи источника `chatbox`) +
  виджет на странице интеграции (`ChatboxIntegrationClient.tsx`) и/или в разделе «Чаты». Парные цветовые токены, только русский.
- **Acceptance:** виджет показывает забрано/проанализировано/в работе/ошибки + ссылки на карточки; цифры сходятся с `/chatbox/integration/sync/status`.

### Ф3 — Метрики синка/анализа + алерт (§5 Ф4)
- **Цель:** система сама ловит «копим, но не анализируем» / «синк отстал» / «сессии висят в pending».
- **Входит:** prom-метрики в воркерах chatbox (через `BusinessMetricsService`): счётчик синков, счётчик анализов, gauge pending-сессий,
  возраст последнего синка; правило алерта «`analysisEnabled=false`, а чаты копятся» и «pending растёт».
- **Acceptance:** новые метрики видны в `/metrics`; алерт-правило задокументировано; unit на инкременты.

### Ф4 — Разбор WARN sendMessage без id (§5 Ф5)
- **Цель:** убедиться, что исходящие ответы не теряются; понять реальную форму ответа ChatBox POST.
- **Входит:** по залогированной форме (`keys`) поправить парсер ответа в `chatbox-chats.service.sendMessage`; убрать синтетический ключ,
  если реальный `id` лежит под известным полем.
- **Прод-вход (владелец):** нужна 1 реальная отправка живому клиенту — снять форму ответа. До неё парсер правится по логам best-effort.
- **Acceptance:** реальная отправка → сообщение сохраняется по настоящему `externalId` (не `kora-out-…`), WARN не появляется.

### Ф5 — Задачи из переписки (Р-1) — ОДНА ВОЛНА с Ф6
- **Цель:** закрытая сессия чата рождает задачи тем же разборщиком, что и встреча.
- **Входит:**
  - Миграция Task (`meetingId` nullable + `sourceType`/`sourceChatSessionId`/`sourceChatId`) + backfill `sourceType='meeting'`.
  - В `chatbox-analyze.worker` после `ingestSession` (за флагом `chatbox.taskExtraction.enabled`): построить `dialog: DialogTurn[]`
    из сообщений сессии (клиент/менеджер — как в `chatbox-ingest.ts`/`transcript.turns`), вызвать `TaskExtractionService.extractTasks`
    с источником `{id: chatId, type:'chatbox', title:<тема/имя клиента>}`; резолв ответственного: `responsible.linkedPersonId`→`Person.userId`.
  - Запись задач — **через Ф6-дедуп** (см. ниже). Прямой `Task(sourceType='chatbox', meetingId=null, sourceChatSessionId, sourceChatId,
    assigneeUserId?, assigneeRaw, sourceQuote, confidence)` только для НЕ-дублей.
  - Реплики клиента → НЕ ответственный (клиент не сотрудник). Идемпотентность по `sessionId` (повторный анализ не плодит задачи —
    проверять существующие `Task.sourceChatSessionId` + `TaskSource`).
  - Kill-switch `chatbox.taskExtraction.enabled` (ON).
- **Acceptance:** анализ закрытой сессии с явным поручением → ≥1 `Task(sourceType='chatbox')` с `sourceChatSessionId` и (если есть) ответственным;
  повторный анализ той же сессии не плодит задачи; реплики клиента не назначаются. typecheck/lint/build + spec.

### Ф6 — Единый межисточниковый дедуп задач (Р-2) — с Ф5
- **Цель:** задача-кандидат, совпавшая с уже существующей (из ЛЮБОГО источника), НЕ создаётся повторно — переписка привязывается к существующей.
- **Входит:**
  - Новый `CrossSourceTaskDedupeService` (по образцу `MeetingTaskDedupeService`, старый НЕ сносить): вход — кандидаты задач сессии + tenantId;
    эмбеддинг заголовков; сравнение с **открытыми задачами всего tenant** (`status=open`, не одной встречи); порог
    `tasks.cross_source_dedupe_threshold`; серая зона → LLM-арбитр `task-dedupe` (переиспользуем промпт).
  - На совпадение: задачу НЕ создаём, пишем `TaskSource(taskId=существующая, sourceType='chatbox', sourceRefId=sessionId, chatId, quote)`
    идемпотентно (`@@unique`) + (best-effort) дописываем `evidenceBlockIds` существующей задачи.
  - НЕ-LOSSY: существующую задачу никогда не удаляем/не переписываем; сомнение арбитра → создаём новую.
  - Kill-switch `tasks.crossSourceDedupe.enabled` (ON). Метрика результата (`created|linked|kept`) через `BusinessMetricsService`.
- **Acceptance:** сессия с поручением, дублирующим уже стоящую задачу → новой задачи НЕТ, есть `TaskSource`-привязка к существующей;
  не-дубль → создаётся новая; арбитр на сомнении → создаёт (non-lossy); идемпотентность привязки (повтор = no-op). spec.

### Ф7 — Прод-выкат, second-brain, рефлексия
- Регистрация `backfill-task-source-type.ts` (+ при необходимости `seed-admin-setting-*`) в `apply-prod-deploy.ts STEPS`;
  обновить `docs/operations/prod-deploy-log.md` (Шаг 1 флаги/AdminSetting, Шаг 4 schema Task+TaskSource+chatbox-поля, Шаг 8 backfill, Шаг 12 smoke);
  обновить second-brain (`02_architecture/data-model.md`, `module-map.md`, `01_projects/ai-jobs.md`/`workers-queues.md`/`api-layer.md`/`frontend-pages.md`,
  реестр `04_не-сделано` — убрать §5-хвосты, добавить Группу 3 как отложенную);
  обновить `docs/operations/feature-flags.md` (2 новых kill-switch); рефлексия в `second-brain/05_история/`.

---

## Требования (трассировка)
- **R1** Когда закрыта сессия чата у интеграции с `analysisEnabled=true`, система shall прогнать её через тот же конвейер знаний, что и встречу (память — есть; задачи — Ф5).
- **R2** Когда из сессии извлечена задача, дублирующая существующую задачу tenant, система shall НЕ создавать новую, а привязать сессию к существующей (`TaskSource`), идемпотентно (Р-2).
- **R3** Если `chatbox.taskExtraction.enabled=false`, система shall не создавать задачи из переписки.
- **R4** Когда синкаются менеджеры/клиенты, система shall связывать с Person по каскаду email→имя(fuzzy) и давать ручной экран; `manual`-связку не перетирать.
- **R5** Система shall показывать владельцу сводку «забрано/проанализировано/карточки/задачи» по переписке (Ф2) и поднимать алерт «копим, но не анализируем» (Ф3).
- **R6** Система shall не назначать ответственным клиента (только сотрудника-менеджера через `linkedPersonId→Person.userId`).
- **R7** Миграция Task shall быть обратимо-безопасной: `meetingId` становится nullable, существующие задачи backfill `sourceType='meeting'`, поле `meetingId` не удаляется.

## Границы фичи
- ✅ Always: tenant-scope; идемпотентность анализа/привязок/backfill; non-lossy дедуп (существующую задачу не трогаем); цитаты-источники; русский UI; парные цветовые токены `bg-*/text-*-fg`.
- ⚠️ Ask first: менять сигнатуру `TaskExtractionService`/`IngestService`; трогать `block-ingest.worker`; менять внутривстречный `MeetingTaskDedupeService`; любой новый ENV вместо AdminSetting; добавлять `Person.phone`.
- 🚫 Never: выкатывать Ф5 без Ф6 (Р-4); удалять/переписывать существующие задачи при дедупе; авто-ответ клиенту (Группа 3); `process.env.*`; `new PrismaClient()` в скриптах (только `createPrismaClient()`); `prisma db push` для коммита; `git add -A`.

## DoD
typecheck (вкл. `.spec`)/lint/build зелёные (back+front); vitest по новым spec; миграции применяются идемпотентно; скрипты в `apply-prod-deploy.ts STEPS`;
`prod-deploy-log.md` и `feature-flags.md` обновлены; second-brain обновлён по таблице производных заметок; рефлексия после push.

---

## Картография (проверенные якоря path:line — перечитать перед правкой, номера дрейфуют)
- `backend/prisma/schema.prisma`: `model Task` :1712 · `model Person` :4726 (нет phone) · `model ChatboxCustomer` :11208 (есть phone, нет linkedPersonId) · `model ChatboxChannelClient` :11229 · `model ChatboxMember` :11256 · `enum ChatboxMemberLinkMode {auto|manual|none}`.
- `backend/src/modules/chatbox/chatbox-sync.service.ts`: `syncMembers` ~258 · `autoLinkMembers` (email-only) ~303 · `syncCustomers`/`syncChannelClients` (пишут phone) ~150/~220 · `fullSync` ~524 · `incrementalSync` ~556 · `syncByScope` ~600.
- `backend/src/modules/chatbox/chatbox-members.service.ts` (образец) и `chatbox-members.controller.ts` (GET/PUT link/POST create-person; RBAC `chatbox`).
- `backend/src/modules/chatbox/chatbox.module.ts` (imports PersonsModule; список controllers/providers).
- `backend/src/modules/chatbox/chatbox-analyze.worker.ts` `process()` — точка вставки шага задач (после `ingestSession`).
- `backend/src/modules/chatbox/chatbox-ingest.service.ts` — `renderTranscript` / построение `transcript.turns` / резолв `responsible.personId`.
- `backend/src/modules/knowledge-core/services/entity-resolution.service.ts:653` — `resolvePersonByHint` (exact+ILIKE).
- `backend/src/modules/ai/services/task-extraction.service.ts:56` — `extractTasks(input)` (вход `dialog: DialogTurn[]`, не пишет в БД).
- `backend/src/modules/ai/workers/tasks-extract.worker.ts` — образец записи `Task` (createMany), вызов дедупа.
- `backend/src/modules/meetings/meeting-task-dedupe.service.ts` — образец дедупа (embed+cosine+LLM-арбитр `task-dedupe`); порог `knowledgeCore.taskDedupeThreshold`.
- `frontend/app/(authenticated)/chats/integrations/chatbox/managers/*` — образец экрана связки; `frontend/src/api/chatbox.api.ts` + `frontend/src/domain/chatbox.ts` — слой API/домена.

## Итог
Реализация НЕ начата — это документ-контракт. Заполнить после прогона фаз.
