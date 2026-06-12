---
type: tz
status: ready-to-implement
feature: support-desk-clone-and-closed-contour
date: 2026-06-09
owner: Сергей (sergrv80@gmail.com)
relates_to:
  - plans/analysis/2026-06-09-support-desk-clone-and-closed-contour.md
  - second-brain/01_projects/conversational-channels.md
  - second-brain/02_architecture/knowledge-core.md
  - docs/operations/feature-flags.md
---
> Анализ: `plans/analysis/2026-06-09-support-desk-clone-and-closed-contour.md` (research-complete) · Статус согласования: 2026-06-09 (Р-1…Р-9 закрыты владельцем)

# ТЗ: Встроенная служба поддержки с AI-клоном и закрытым контуром памяти

## Принцип
Строим вендорскую службу поддержки на существующих кирпичах Z (трекер `Issue`, граф `KnowledgeGroup`, клон `clone-respond`, каналы `Notification`, чат-движок Concierge). Новое — ровно: закрытый контур памяти под поддержку, обучающая петля «черновик→правка», support-слой над трекером, клиентский виджет в отдельном контуре доверия. **Каждый red-team-инвариант (R-INV-1…R-INV-6) — обязателен; «оптимизировать по-своему» запрещено.**

## Вне scope / отложено владельцем
- **Авто-отправка клиенту без человека** — это Ф5, выкатывается отдельно за `SUPPORT_CLONE_AUTOSEND_ENABLED` + порог; в Ф1–Ф4 человек шлёт ВСЕГДА.
- **Раскрытие AI клиенту** — не нужно в Ф1–Ф3 (отвечает человек). Под-вопрос решается на входе в Ф4 (см. Р-5).
- **Ответ сотрудника из Telegram/почты** (входящий внешний reply→тикет) — fast-follow, не v1 (Р-6). В v1 Telegram/почта — только ИСХОДЯЩЕЕ дублирование.
- **Тон-адаптер DPO/LoRA** — Ф6, после накопления чистых классифицированных пар.
- **Мультитенант (клиентские компании ведут СВОЙ деск для СВОИХ клиентов)** — модель данных закладывается расширяемой, но не строится (Р-1).
- **Email/Telegram как КАНАЛ ПРИЁМА от клиента** — v1 приём только виджет (Р-6).

---

## Цель + Зачем
**Цель.** Клиент Коры из своего кабинета задаёт вопрос в поддержку → обращение попадает в наш единый деск → наш сотрудник отвечает → ответы копятся в закрытый контур памяти → из него собирается клон техподдержки, который сначала готовит черновики (человек правит — учимся на правках), а позже отвечает сам за гейтом уверенности.

**Зачем (болезненное состояние).** Сейчас обращений клиентов нет как сущности — теряются, нет очереди/статусов/нескольких отвечающих; знание «как мы отвечаем» живёт в голове одного человека и не масштабируется. Дифференциатор (анализ §4): **обучение на DIFF черновик→финал** — зазор, который лидеры (Intercom, Zendesk, Yandex) осознанно не закрывают.

---

## REALITY-CHECK (что есть по факту, что мёртво/сломано, что строить)
Снято Explore-проходами 2026-06-09 (vexp-демон в сессии недоступен; **перед правкой оркестратор перечитывает якоря — номера строк дрейфуют**).

**Готово и переиспользуется (НЕ переделывать):**
- Трекер: `Issue` (schema.prisma:~8827), `IssueComment` (:~9026, **уже имеет `access` = `"internal"|"external"`**, `parentCommentId` для тредов, `voiceTranscript`), `IssueState` (:~8682, ТАБЛИЦА per-project, поле `category` = backlog|unstarted|started|completed|cancelled), `IssueAssignee` (:~8951, **уже M:M — несколько ответственных без новой модели**), `IssueSubscriber`, `Project` (:~8498, `systemGenerated`, `network`), `IssueActivity` (`actorType` = user|ai_agent|system, `agentName` — годится для лога обещаний клона). Модуль `backend/src/modules/tracker/*` (issues.controller/service, comments, states, projects). `ActivityRecorderService`.
- Граф-доступ: `KnowledgeGroup` (:~2823, enum `KnowledgeGroupKind` = department|leadership|council|personal, `isClosed`), `KnowledgeGroupMember` (groupId, personId, source 'auto'|'manual'), `IdeaBlockAccess` (:~2857, blockId/groupId/via), `BlockAccessDeriverService` (block-access-deriver.service.ts), `KnowledgeAccessResolver.buildAccessWhere` (knowledge-access-resolver.service.ts:137-154).
- **Ретрив клона уже фильтруется ДО выборки:** `clones.service.ts` `loadPersonSubgraph` (:~2216) / `loadRoleSubgraph` (:~2366) применяют `buildAccessWhere(accessCtx)` прямо в Prisma-запросе (:~2255). Векторный KNN `chat-v2-retrieval.service.ts:419` ранжирует **уже отфильтрованный пул** (access-фильтр в `collectPool` :202-240 ДО KNN) → **изоляция контура достигается позитивным pre-filter в пуле, секционирование pgvector НЕ нужно** (R-INV-1).
- Клон: `clone-respond` (taskType), `clone-respond.prompt.ts` (factual/judgmental, `[BLOCK:id]`-цитаты), `ExecutablePersona` build (executable-persona-build.service.ts).
- Обучение: `LlmPreferenceSample` (:~9879, tenantId/taskType/inputContext/modelOutput/label/recordedBy), `ConfidenceCalibrationService` (Platt sigmoid(a·x+b), params в `AdminSetting["confidence_calibration:<taskType>"]`, cron weekly min 30).
- LLM: `llm-router.service.ts` — union `LlmTaskType` (:49-567) + `ALL_LLM_TASK_TYPES` (:575-774); `call(LlmCallParams)→LlmCallResult` (:930+); `DEFAULT_FALLBACK_CHAIN` deepseek→openai-proxy→kie. `LlmTaskRoute` сидируется скриптом.
- Каналы: `Channel/ChannelBinding/Notification/NotificationDelivery` (:~6673), `conversational.service.ts` `sendNotification(SendNotificationInput)` (:210-350) + `EVENT_TYPE_CHANNEL_POLICY` (:90-146). magic-link `link-code.service.ts`.
- Чат-движок: Concierge `process()` (concierge.service.ts:258), `ConciergeConversation/Message` (:~8338), `ToolRouter` (RBAC, whitelist), фронт `ConciergeChat.tsx` / `ConciergeFloatingButton.tsx` (событие `concierge:open`), `Sidebar.tsx` (ME_GROUP :281).
- Настройки: `AdminSetting` (:~9693, JSON-value + history + Redis-кэш 30s), `TypedConfigService.getDynamic`. Entitlements: `OrgEntitlement` (:~4530, `featureOverrides` JSON per-org), `tier-config.ts` (FeatureKey/QuotaKey).

**Чего НЕТ — строим:**
- Вид группы `support` в `KnowledgeGroupKind` (сейчас 4 вида).
- Поля клиента на `Issue` (от какой компании/кто спросил) и SLA-поля; CSAT-модель; провенанс/черновик на `IssueComment`.
- Позитивный фильтр контура в ретриве клона (сейчас фильтр — общий access, не «только контур X»).
- Отдельный critic/groundedness-сервис (его НЕТ; `MultiAgentDebateService` — только vote-арбитр, не проверка правдивости).
- Обучающая петля «черновик→финал→тип правки→сэмпл» (сейчас `LlmPreferenceSample` пишется только из curation-событий).
- Модуль `support` (intake/desk/clone/sla/access), клиентский виджет, раздел деска во фронте.

---

## Принятые решения владельца (НЕ пересматривать)

| # | Решение | Обоснование |
|---|---|---|
| Р-1 | Охват v1 — только наша вендорская поддержка (клиенты Коры пишут нам, единый наш деск, dogfood). Модель расширяемая, чужие дески не строим | Меньше риска, быстрее обкатка; 2026-06-09 |
| Р-2 | Закрытая память поддержки — контур внутри нашей Org; доступ по галочке у сотрудника (Р-7), не роли; на `KnowledgeGroup`+`KnowledgeGroupMember` (как personal/council) | Переиспользует готовый RBAC-фундамент |
| Р-3 | «Тариф собственника» — вендор-эксклюзивный entitlement (не продаётся); деск приёма только нашей Org. Флаг «решение владельца» → `feature-flags.md` | Ship-On: меняет кто что видит |
| Р-4 | Базу контура засеваем вручную (текстовка + синтез Q&A) — холодный старт | Naumen: порог 500-1000 обращений; иначе клон «немой» |
| Р-5 | Клиенту про AI ничего; черновик только сотруднику; человек шлёт всегда (Ф1–Ф3). Раскрытие AI — под-вопрос Ф4 | Юр-риск (EU AI Act, Air Canada) только у авто-отправки |
| Р-6 | Каналы v1: приём — только виджет; дублирование сотруднику в Telegram+почту; ответ — в деске | Минимум поверхности атаки; инфра уведомлений готова |
| Р-7 | Галочка «сотрудник поддержки» = членство в группе-контуре (`KnowledgeGroupMember`); видит деск + отвечает + из него собирается клон | Один источник правды, ноль новых моделей доступа |
| Р-8 | Тикет = `Issue` в нашей Org + поля клиента (Q1 2026-06-09) — переиспользуем трекер | Red-team R3: не плодить новое хранилище |
| Р-9 | Обучение на правках — петля черновик→финал с классификацией ТИПА правки (Q2) | Red-team R2: голый diff хакаем |

**Red-team-инварианты (обязательны, анализ §6/§9):**
- **R-INV-1** Изоляция контура — позитивный pre-retrieval фильтр (`blockAccess.some.groupId = supportGroupId`) в пуле ДО ранжирования, **безусловно** (не зависит от `KNOWLEDGE_ACCESS_ENFORCEMENT`). CI-негатив-тест: ретрив контура поддержки не возвращает НИ ОДНОГО блока вне группы. `text-embedding-3-small` общий и не дообучается — инвариант.
- **R-INV-2** Обучение: классификация типа правки (факт|тон|политика|пустая) дешёвым judge ДО записи сэмпла; «принятые→контур» только за гейтом качества (approve + нет реоткрытия + не-негативный CSAT); провенанс `clone-accepted`, вес ниже человеко-написанного. Без файнтюна (CIPHER-стиль). Python (CIPHER/FIGA) → порт в TS.
- **R-INV-3** Тикеты: `Issue` = хранилище; SLA+эскалация+видимость `internal|customer`+CSAT — достроить. Видимость до первой выкатки.
- **R-INV-4** Клиентский виджет = отдельный bounded context: свой системный промпт, БЕЗ внутренних tool'ов Concierge и БЕЗ графа компании — только контур поддержки + публичная база; deny-by-default tools; identity на краю → ограниченный scope; выход только текст; авто-ответ только за gate+kill-switch.
- **R-INV-5** Анти-галлюцинация (Ф3): отдельный critic-вызов + groundedness-score ДО показа сотруднику; три исхода (ответить/уточнить/эскалировать); цитаты обязательны.
- **R-INV-6** Авто-режим (Ф4): пороги per-категория в AdminSetting; shadow→graduated→cutover; авто-graduation по доказанному качеству (НЕ ручное «одобри»); kill-switch; калибровка на ИСХОДАХ; лог обещаний клона.

---

## Доказательство выбора
Полная матрица вариантов (3 куска × A/B/C) + ADR + состязательный red-team — в анализе §6 (`research-complete`). Здесь — принятые архитектурные решения с «почему»:

| # | Решение | Почему (правило/источник) |
|---|---|---|
| Б1 | Контур = новый вид `KnowledgeGroup(kind=support, isClosed, refId=null)` синглтон per вендор-Org; члены = `KnowledgeGroupMember(source='manual')` | Переиспользует IdeaBlockAccess+Deriver+Resolver (~80% готово); паттерн closed-групп personal/council. Анализ §6 Куск1 вариант C |
| Б2 | Изоляция — позитивный pre-filter в пуле ретрива, не секционирование pgvector | KNN уже ранжирует отфильтрованный пул (chat-v2-retrieval:419 + collectPool:202); секционирование избыточно. R-INV-1 |
| Б3 | Тикет = `Issue` (Support-проект, `systemGenerated`) + поля клиента + support-слой | Р-8; red-team R3; `IssueComment.access` и `IssueAssignee` M:M уже есть |
| Б4 | Галочка поддержки = членство в группе-контуре | Р-7; ноль новых моделей доступа |
| Б5 | Обучение — петля черновик→финал + классификация типа правки → `LlmPreferenceSample` + `SupportDraftOutcome`; few-shot из принятых; без файнтюна | Р-9; R-INV-2; CIPHER (анализ §4); `feedback_no_human_in_loop_for_clone_learning` |
| Б6 | Транспорт чата переиспользуем, но клиентский виджет — отдельный компонент/эндпоинты без tool'ов Concierge | R-INV-4; OWASP LLM01; `feedback_concierge_text_only_output` |
| Б7 | Critic-сервис — новый `SupportAnswerCriticService` (groundedness), не Debate | Debate = vote, не faithfulness (REALITY-CHECK); R-INV-5; DeepEval faithfulness |
| Б8 | Пороги/лимиты — `AdminSetting`; авто-graduation — composite judge+A/B, не ручное одобрение | `feedback_admin_settings_not_env_or_code`; `feedback_no_human_in_loop_for_clone_learning`; PAIR |
| Б9 | Дешёвый judge (классификатор правок, critic) — `deepseek-v4-flash`; capable — DeepSeek V4 Pro | `feedback_ollama_tertiary_only_deepseek_flash_cheap` |

---

## Scope
**Входит (v1, Ф1–Ф3 + каркас Ф4):** виджет приёма у клиента (in-app); тикет=Issue в Support-проекте вендор-Org с полями клиента; support-слой (SLA-таймеры+эскалация, видимость internal/customer, CSAT, провенанс комментария, очереди); дублирование сотруднику в Telegram+почту; закрытый контур памяти + галочка-членство + ручной засев; клон-черновик (RAG из контура + few-shot + critic + три исхода + цитаты) в ленту тикета; приём/правка/отказ черновика; петля обучения (классификация типа правки → сэмпл). Каркас Ф4 (калибровка/shadow) — модели и метрики, но авто-отправка OFF за kill-switch.

**Не входит:** см. «Вне scope» выше.

## Граничные контракты с другими ТЗ / подсистемами
- **Concierge** — НЕ трогаем его tool-router и доступ к графу. Клиентский виджет использует ТОЛЬКО SSE/UI-каркас (импорт компонента треда), свои эндпоинты `/support/*`. Внутренний деск сотрудника МОЖЕТ переиспользовать `ConciergeChat` как есть (доверенный пользователь) — но данные тянет из `/support/*`, не из `/concierge/*`.
- **knowledge-core ingest** — финальные ответы кормят контур через существующий `RawEvent→IdeaBlock`; но с дополнительной привязкой к support-группе (Б1). Не вводим новый `signalType` — используем `expertise`/`reasoning`.
- **tracker** — Support-проект = обычный `Project(systemGenerated=true)`; не ломаем существующий tracker-UI (Support-проект скрыт из обычного списка проектов фильтром `systemGenerated`).

---

## Контракт-first (единый источник правды для копипасты)

### Prisma (миграции — ФАЙЛОВЫЕ `prisma:migrate`, НЕ db push; приоритет CLAUDE.md над устаревшим текстом скилла)

```prisma
// 1) enum KnowledgeGroupKind (schema.prisma:~2818) — добавить значение
enum KnowledgeGroupKind {
  department
  leadership
  council
  personal
  support // закрытый контур техподдержки (синглтон per вендор-Org, refId=null)
}

// 2) Issue (schema.prisma:~8827) — добавить поддержку-поля (все nullable, не ломают существующие задачи)
//    customer* заполняются ТОЛЬКО для тикетов поддержки (cross-tenant: клиент из другой Org)
  supportCustomerOrgId  String?   /// Org клиента, приславшего обращение (его tenant)
  supportCustomerUserId String?   /// User клиента (глобальный User.id)
  supportCustomerContact String?  @db.VarChar(320) /// email/имя для отображения в деске
  firstResponseDueAt    DateTime? /// SLA: дедлайн первого ответа
  resolutionDueAt       DateTime? /// SLA: дедлайн решения
  firstRespondedAt      DateTime? /// факт первого ответа клиенту
  slaBreachedAt         DateTime? /// зафиксированное нарушение SLA (для дашборда «горящих»)
// + индекс:
  @@index([tenantId, supportCustomerUserId])
  @@index([tenantId, firstResponseDueAt])

// 3) IssueComment (schema.prisma:~9026) — провенанс + состояние черновика клона
//    `access` ("internal"|"external") УЖЕ ЕСТЬ — переиспользуем как видимость клиенту (R-INV-3)
  authorType   String  @default("human") /// human | clone | system
  draftState   String? /// null=обычный | pending | accepted | edited | rejected (только для authorType=clone)
  cloneConfidence  Decimal? @db.Decimal(4,3) /// калиброванная уверенность клона (для черновика)
  groundednessScore Decimal? @db.Decimal(4,3) /// результат critic (truthful/total)

// 4) НОВАЯ: SLA-политика (синглтон per вендор-Org для v1)
model SupportSlaPolicy {
  id                  String  @id @default(cuid())
  tenantId            String  @unique /// вендор-Org
  firstResponseMins   Int     @default(60)
  resolutionMins      Int     @default(480)
  businessHoursOnly   Boolean @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

// 5) НОВАЯ: CSAT/оценка (кормит петлю чистым сигналом — R-INV-2/R3)
model IssueRating {
  id          String   @id @default(cuid())
  tenantId    String
  issueId     String   @unique
  score       Int      /// 1..5 или 1/−1 (см. R-DTO ниже)
  comment     String?  @db.Text
  ratedByUserId String? /// клиент (User.id)
  createdAt   DateTime @default(now())
  @@index([tenantId, createdAt])
}

// 6) НОВАЯ: обучающий сигнал (R-INV-2) — пара черновик→финал + тип правки
model SupportDraftOutcome {
  id            String   @id @default(cuid())
  tenantId      String   /// вендор-Org
  issueId       String
  draftCommentId String?
  taskType      String   @default("support-clone-draft")
  draftText     String   @db.Text
  finalText     String?  @db.Text /// что реально ушло клиенту (null если отклонён)
  outcome       String   /// accepted | edited | rejected
  editType      String?  /// factual | tone | policy | empty (классификатор) | null
  cloneConfidence Decimal? @db.Decimal(4,3)
  groundednessScore Decimal? @db.Decimal(4,3)
  promotedToContour Boolean @default(false) /// прошёл ли гейт качества и попал в контур
  createdAt     DateTime @default(now())
  @@index([tenantId, taskType, createdAt])
  @@index([tenantId, issueId])
}
```
> HNSW/GIN — в `postgres-init.sql`, не в schema. Новые индексы выше — обычные btree, идут в миграцию.

### Новые taskType (llm-router.service.ts — добавить в union :567 И в `ALL_LLM_TASK_TYPES` :575-774)
```
'support-clone-draft'    // генерация черновика ответа (RAG контур + few-shot принятых)
'support-answer-critic'  // groundedness-проверка черновика (claims vs контур-блоки)
'support-edit-classify'  // классификация типа правки (factual|tone|policy|empty)
'support-contour-curate' // ночной куратор: решение keep|supersede|merge|fix|archive по блокам контура
```
Маршруты сидировать `seed-support-llm-routes.ts`: draft + curate → DeepSeek V4 Pro primary; critic+classify → `deepseek-v4-flash` primary (Б9); fallback — `DEFAULT_FALLBACK_CHAIN`.

### Системный промпт `support-clone-draft` (стабильный, cache-friendly — согласован владельцем 2026-06-09)
SYSTEM (неизменный): *«Ты — технический специалист службы поддержки нашей компании. Помогаешь клиентам правильно пользоваться нашей системой. Отвечай вежливо и по делу СТРОГО на основе данных базы поддержки ниже. Обязательно прикладывай ссылки на источники `[BLOCK:id]`. Не выдумывай: если в данных нет ответа — честно скажи об этом и предложи передать вопрос специалисту. Отвечай только текстом.»* Переменное (вопрос клиента, контур-блоки, few-shot принятых пар) — в конце user.

### Новые eventType (conversational `EVENT_TYPE_CHANNEL_POLICY` :90-146)
```
'support.ticket_created': ['in_app','telegram_bot','email_smtp'] // дублирование сотруднику (Р-6)
'support.ticket_reply':   ['in_app','telegram_bot','email_smtp'] // клиент ответил → ассайни
```

### REST-контракт (Zod-DTO + Swagger; коды ошибок machine-readable)
```
// Клиент (любой авторизованный, любая Org) — intake в вендор-деск:
POST /api/v1/support/tickets        body: { subject: string(1..200), message: string(1..5000), category?: 'technical' }
                                     → 201 { ticketId, ticketNumber }
                                     errors: SUPPORT_DESK_DISABLED(503), SUPPORT_RATE_LIMIT(429)
GET  /api/v1/support/my-tickets     → { items: [{ ticketId, ticketNumber, subject, status, updatedAt }] }
GET  /api/v1/support/my-tickets/:id → { ...ticket, messages: [только access='external'] }
POST /api/v1/support/my-tickets/:id/messages  body:{ message } → 201
POST /api/v1/support/my-tickets/:id/rate       body:{ score:1..5, comment? } → 200

// Сотрудник поддержки (guard: SupportAccessGuard — член группы-контура):
GET  /api/v1/support/desk/tickets   query:{ view?: 'unassigned'|'mine'|'all'|'closed'|'spam', cursor? }
                                     → { items:[...], nextCursor }
                                     errors: SUPPORT_NOT_AGENT(403)
GET  /api/v1/support/desk/tickets/:id → { ...ticket, messages:[все, internal+external], draft? }
POST /api/v1/support/desk/tickets/:id/reply  body:{ message, fromDraftCommentId? } → 201 // access='external', authorType='human'
POST /api/v1/support/desk/tickets/:id/note   body:{ message } → 201                       // access='internal'
POST /api/v1/support/desk/tickets/:id/assign body:{ userId } → 200
POST /api/v1/support/desk/tickets/:id/transition body:{ stateId } → 200
POST /api/v1/support/desk/tickets/:id/draft  → 202 { draftCommentId } // Ф3: попросить клона черновик
POST /api/v1/support/desk/drafts/:commentId/accept → 200 // шлёт как есть (outcome=accepted)
POST /api/v1/support/desk/drafts/:commentId/reject → 200 // outcome=rejected
// «правка»: сотрудник редактирует текст и шлёт через /reply с fromDraftCommentId → outcome=edited + DIFF

// Админ (super_admin / owner вендор-Org) — галочка поддержки (Р-7) + контур:
GET  /api/v1/support/admin/agents   → { members:[{ personId, name }] }
POST /api/v1/support/admin/agents   body:{ personId } → 200 // добавить в KnowledgeGroupMember(support)
DELETE /api/v1/support/admin/agents/:personId → 204
POST /api/v1/support/admin/contour/seed body:{ items:[{ question, answer }] } → 200 // Р-4 ручной засев
```

### ASCII-поток (Ф1→Ф3)
```
[Клиент:виджет] ──POST /support/tickets──► [Issue в вендор-Org, Support-проект, access ленты=external]
        │                                          │
        │                                          └─► sendNotification('support.ticket_created') ─► Telegram+почта сотрудника
        ▼
[Сотрудник:деск] ──POST .../draft──► [support-clone-draft: RAG из контура(R-INV-1) + few-shot]
        │                                   │
        │                                   ▼
        │                          [support-answer-critic: groundedness] ──< порог? ─► flag/уточнить/эскалация (R-INV-5)
        │                                   │
        │                                   ▼
        │                          [IssueComment authorType=clone, access=internal, draftState=pending]
        ▼
[принять / править+послать / отклонить]
        │
        ├─ accept  ─► reply(access=external, authorType=human=копия) ; outcome=accepted
        ├─ edit    ─► reply(access=external, текст человека)        ; outcome=edited + DIFF
        └─ reject  ─► outcome=rejected
                          │
                          ▼
        [support-edit-classify: factual|tone|policy|empty] ─► SupportDraftOutcome + LlmPreferenceSample (R-INV-2)
                          │
                          ▼  (за гейтом качества: accepted/edited + нет реоткрытия + CSAT≥порог)
        [финал → RawEvent→IdeaBlock(expertise) + IdeaBlockAccess(support-группа) provenance=clone-accepted]
```

---

## Границы фичи
- ✅ Always: tenant-scoping (`@@index([tenantId,...])`); Zod-DTO+Swagger на каждый эндпоинт; видимость `access` проверять на КАЖДОМ чтении ленты клиентом; цитаты в черновике; идемпотентные seed/patch.
- ⚠️ Ask first: менять контракт `clone-respond`/Concierge tool-router; трогать общий `KnowledgeAccessResolver` поведение вне support; любой новый ENV вместо AdminSetting.
- 🚫 Never: клиентскому виджету давать tool'ы Concierge или доступ к графу компании; пост-фильтрация контура (только pre-filter); авто-отправка клиенту в Ф1–Ф3; голый diff как сигнал качества; `process.env.*`, `prisma migrate dev` мимо файловых миграций, `new PrismaClient()` в скриптах.

---

## Фазы (dependency-ordered)

**Граф зависимостей:** Ф1 → Ф2 → Ф3 → Ф4 → Ф5 → Ф6 (строго последовательно: контур (Ф2) нужен клону (Ф3); сигналы Ф3 нужны ночному куратору (Ф4); куратор и калибровка нужны авто-режиму (Ф5); тон-адаптер (Ф6) — последний). Внутри Ф1 back-волна (Prisma+сервис+контроллер) раньше front-волны.

### Ф1 — Деск (приём + тикеты + support-слой + дублирование). Человек отвечает.
**Мини-картография:** `Issue`/`IssueComment`/`IssueState`/`IssueAssignee` (schema.prisma:8682-9059), `tracker/services/issues.service.ts:52`, `conversational.service.ts:210` (sendNotification), `Sidebar.tsx:281`, `ConciergeChat.tsx:36` (UI-каркас треда).
**Цель.** Клиент шлёт обращение из виджета → тикет в нашем деске; сотрудник видит очередь, отвечает (видимость клиенту), статусы, SLA; обращение дублируется сотруднику в Telegram+почту.
**Входит:** Prisma-поля Issue/IssueComment + `SupportSlaPolicy`/`IssueRating` (миграция); модуль `support` (intake/desk/access сервисы+контроллеры, `SupportAccessGuard`); seed Support-проекта (`systemGenerated`, states: Новое/В работе/Ждёт клиента/Решено/Закрыто/Спам с нужными `category`) + `SupportSlaPolicy`; eventType `support.ticket_created` + дублирование; SLA-cron эскалации (BullMQ `@Cron`); entitlement `feature.support_desk` + `SUPPORT_VENDOR_ORG_ID` (AdminSetting) + `SUPPORT_DESK_ENABLED` kill-switch; фронт — виджет клиента (отдельный компонент, R-INV-4: без tool'ов) + раздел «Поддержка» в деске (guard isAgent) + клиентский экран «Мои обращения».
**Что НЕ входит:** клон/черновики (Ф3); закрытый контур памяти (Ф2 — на Ф1 ответы НЕ кормят граф); авто-режим (Ф4); ответ из Telegram/почты.
**Файлы (создать):** `backend/src/modules/support/` (support.module.ts, services: support-intake/support-desk/support-access/support-sla.service.ts, controllers: support-client/support-desk/support-admin.controller.ts, dto/*); `backend/scripts/seed-support-project.ts`; `frontend/app/(authenticated)/support/*`, `frontend/src/ui/support/SupportWidget.tsx` + кнопка; правка `Sidebar.tsx`.
**Acceptance (машинно):**
- `bun run prisma:migrate -- --name support_desk_phase1` создаёт миграцию; `bun run typecheck && bun run build` зелёные.
- `POST /api/v1/support/tickets` от пользователя Org-A создаёт `Issue` с `tenantId=SUPPORT_VENDOR_ORG_ID`, `supportCustomerOrgId='A'`, `supportCustomerUserId=<caller>`, лента `access='external'`; ответ `{ticketId, ticketNumber}` где ticketNumber=`Issue.identifier`.
- При `SUPPORT_DESK_ENABLED=false` → `POST /support/tickets` → 503 `SUPPORT_DESK_DISABLED`.
- `GET /support/desk/tickets` для НЕ-члена группы → 403 `SUPPORT_NOT_AGENT`; для члена → список.
- Клиент `GET /support/my-tickets/:id` видит ТОЛЬКО `access='external'` комменты (negative: internal-заметка НЕ в выдаче — grep-тест).
- Создание тикета шлёт `Notification(eventType='support.ticket_created')` с доставкой в telegram+email binding сотрудника (проверка: запись `NotificationDelivery`).
- SLA: при создании проставлены `firstResponseDueAt/resolutionDueAt` из `SupportSlaPolicy`; cron при просрочке ставит `slaBreachedAt` (unit: 1 просроченный тикет → поле заполнено).
- Idempotency: повторный `seed-support-project.ts` = no-op (тот же проект, без дублей).
**Тесты:** `bunx vitest run backend/src/modules/support/*.spec.ts` (intake cross-tenant, access-фильтр клиента negative, isAgent guard, SLA-проставление).
**Закрывает:** R1, R2, R3, R7, R10, R11, R12, R15.

### Ф2 — Закрытый контур памяти (группа + галочка + изоляция + засев).
**Мини-картография:** `KnowledgeGroup`/`KnowledgeGroupMember`/`IdeaBlockAccess` (schema.prisma:2818-2866), `block-access-deriver.service.ts`, `knowledge-access-resolver.service.ts:137`, `clones.service.ts:2216/2366` (loadXSubgraph), `chat-v2-retrieval.service.ts:202/419` (collectPool/KNN).
**Цель.** Есть закрытый контур поддержки; галочка-членство управляет доступом; ретрив из контура изолирован (R-INV-1); базу можно засеять вручную (Р-4).
**Входит:** `support` в `KnowledgeGroupKind` (миграция); seed синглтон-группы `support` per вендор-Org; админ-API галочки (add/remove `KnowledgeGroupMember(source='manual')`) + `SupportAccessGuard` читает членство; `BlockAccessDeriverService` — при ingest блока из контура поддержки проставлять `IdeaBlockAccess(via='closed', groupId=support)`; **позитивный pre-filter контура** — новый параметр `contourGroupId` в пути ретрива (расширить `KnowledgeAccessResolver`/пул так, чтобы `blockAccess.some.groupId=supportGroupId` добавлялось БЕЗУСЛОВНО); ручной засев `POST /support/admin/contour/seed` (текст/пары → RawEvent→IdeaBlock с привязкой к группе).
**Что НЕ входит:** генерация черновика (Ф3); UI засева сверх простой формы.
**Файлы:** правка `block-access-deriver.service.ts`, `knowledge-access-resolver.service.ts` (или новый `SupportRetrievalScopeService`), `support-admin.controller.ts` (seed+agents); `backend/scripts/seed-support-contour-group.ts`; **CI-тест изоляции**.
**Acceptance (машинно):**
- Миграция enum применяется; `bun run prisma:generate` ок.
- Галочка: `POST /support/admin/agents {personId}` → строка `KnowledgeGroupMember(groupId=support, source='manual')`; `SupportAccessGuard` теперь пускает этого user в деск.
- **R-INV-1 negative-test (обязателен, CI):** засеять 2 блока — один в support-группе, один вне; ретрив с `contourGroupId=support` возвращает ТОЛЬКО support-блок, второй отсутствует. Тест падает, если фильтр пост-, а не pre-. Команда: `bunx vitest run backend/src/modules/support/contour-isolation.spec.ts`.
- Изоляция НЕ зависит от `KNOWLEDGE_ACCESS_ENFORCEMENT` (тест с `enforcement='off'` всё равно изолирует).
- Засев: `POST /support/admin/contour/seed {items:[{question,answer}]}` → создаёт IdeaBlock(и) с `IdeaBlockAccess(groupId=support)`; повторный засев тех же пар = no-op (идемпотентность по хэшу).
**Тесты:** `contour-isolation.spec.ts` (pre-filter, enforcement-independent, negative cross-contour), `support-agents.spec.ts`.
**Закрывает:** R4, R5, R6, R13. (R-INV-1)

### Ф3 — Клон-черновик + петля обучения. Этап assisted.
**Мини-картография:** `clone-respond.prompt.ts`, `clones.service.ts:647`, `llm-router.service.ts:567/930`, `LlmPreferenceSample` (schema:9879), `confidence-calibration.service.ts`, `executable-persona-build.service.ts`.
**Цель.** По кнопке клон готовит черновик ИЗ КОНТУРА (R-INV-1) с critic-проверкой (R-INV-5) и цитатами → сотрудник принимает/правит/отклоняет → снимаем обучающий сигнал с классификацией типа правки (R-INV-2).
**Входит:** taskType `support-clone-draft` (RAG из контура + few-shot топ-N принятых из `SupportDraftOutcome` + support-системный промпт, cache-friendly); `SupportAnswerCriticService` + taskType `support-answer-critic` (извлечь claims → сверить с контур-блоками → groundedness=truthful/total, порог в AdminSetting; три исхода ответить/уточнить/эскалировать); черновик = `IssueComment(authorType='clone', access='internal', draftState='pending', cloneConfidence, groundednessScore)`; accept/edit/reject → `SupportDraftOutcome` + классификатор `support-edit-classify` + запись `LlmPreferenceSample`; гейт качества для промоушена в контур (accepted/edited + нет реоткрытия + CSAT≥порог → RawEvent→IdeaBlock(expertise)+IdeaBlockAccess(support) provenance `clone-accepted`, вес ниже человеческого); холодный старт — few-shot из засеянной базы (Р-4).
**Что НЕ входит:** авто-отправка (Ф4); тон-адаптер (Ф5).
**Файлы:** `support-clone.service.ts`, `support-answer-critic.service.ts`, `support-edit-classify.service.ts`, `support-learning.service.ts`, prompts `support-*.prompt.ts`; `seed-support-llm-routes.ts`; правка `support-desk.controller.ts` (draft/accept/reject).
**Acceptance (машинно):**
- `POST /support/desk/tickets/:id/draft` → создаёт `IssueComment(authorType='clone', draftState='pending')` с непустыми `cloneConfidence`, `groundednessScore` и ≥1 цитатой `[BLOCK:id]`; блоки — только из support-контура (reuse Ф2 negative-test).
- Critic: если groundedness < порога (AdminSetting `support_critic_min_groundedness`) → черновик помечен исходом `clarify`/`escalate` (не «ответить») — unit с подставным низким score.
- accept → `SupportDraftOutcome(outcome='accepted')` + `LlmPreferenceSample(taskType='support-clone-draft', label='correct')`; edit → `outcome='edited'` + `editType∈{factual,tone,policy,empty}` (классификатор вызван) + DIFF сохранён; reject → `outcome='rejected'`+`label='wrong'`.
- Гейт промоушена: reject НЕ попадает в контур; accepted с реоткрытым тикетом НЕ промоутится (unit). Промоутнутый блок имеет `IdeaBlockAccess(groupId=support)` и провенанс `clone-accepted`.
- `bun run typecheck && bun run lint && bun run build` зелёные; промпты — стабильный SYSTEM (раздел prompt caching ниже).
**Тесты:** `support-clone.spec.ts` (контур-only retrieval, цитаты), `support-critic.spec.ts` (порог→исход), `support-learning.spec.ts` (3 исхода→сэмплы, classify, гейт промоушена).
**Закрывает:** R8, R9, R14, R16, R17, R18. (R-INV-1, R-INV-2, R-INV-5)

### Ф4 — Ночной куратор контура (рефлексирующий агент, наводит порядок в базе).
**Мини-картография:** `confidence-calibration.cron.ts` (образец @Cron), `MultiAgentDebateService` (multi-agent-debate.service.ts — vote-судья для supersede), `IdeaBlock` (status draft|canonical|merged_into|archived, `supersededAt`, bi-temporal поля), `decision-supersede-detect` taskType, `SupportDraftOutcome`/`IssueRating`.
**Цель.** Каждый вечер агент-куратор смотрит дневные сигналы (вопросы, ответы, тип правки, отклонения, реоткрытия, CSAT) и САМ наводит порядок в контуре: повышает хорошее в базу, чинит/замещает ошибочное, архивирует устаревшее/противоречивое, объединяет дубли — **автоматически, без ручного «одобри»** (R-INV-6; `feedback_no_human_in_loop`), с защитой от необратимости.
**Входит:** `@Cron` ночной (расписание в `CronSchedule`/AdminSetting); taskType `support-contour-curate` (вход: дневные `SupportDraftOutcome` + контур-блоки + сигналы реоткрытия/CSAT; выход на каждый блок/кандидат: `keep|promote|fix(supersede)|merge|archive` + обоснование); **destructive-операции (fix/merge/archive) — только мягко** (`IdeaBlock.status='archived'` / `supersededAt`, НЕ физическое удаление) и **только после судьи** (reuse `MultiAgentDebateService` family `decision-supersede`); провенанс + аудит каждой операции (запись действия куратора); приоритеты: editType='factual' у правок → кандидат на fix/supersede исходного блока; rejected-паттерны → НЕ в базу; дубли по семантической близости → merge; kill-switch `SUPPORT_CURATOR_ENABLED`.
**Что НЕ входит:** авто-отправка клиенту (Ф5); физическое удаление блоков (только soft-archive); человеческое одобрение каждой правки (запрещено).
**Файлы:** `support-curator.cron.ts`, `support-curator.service.ts`, prompt `support-contour-curate.prompt.ts`; правка `seed-support-llm-routes.ts` (taskType curate).
**Acceptance (машинно):**
- При `SUPPORT_CURATOR_ENABLED=false` cron — no-op (unit).
- Куратор за прогон: для блока с фактической правкой (editType='factual') предлагает `fix/supersede`; перед применением вызывает `MultiAgentDebateService` — при verdict «против» блок НЕ меняется (unit с подставным verdict).
- Удаление = `status='archived'` + `supersededAt`, исходный ряд сохранён (negative: физического `delete` нет — grep отсутствия `prisma.ideaBlock.delete` в curator-сервисе).
- Каждая операция куратора пишет аудит-запись (что/почему/verdict). Идемпотентность: повторный прогон того же дня не дублирует действия.
- Дубли: 2 семантически близких блока → один помечается `merged_into` другого (unit).
**Тесты:** `support-curator.spec.ts` (kill-switch no-op, debate-gate перед supersede, soft-archive only, merge дублей, аудит).
**Закрывает:** R22, R23, R24. (R-INV-2 — гейт качества базы; R-INV-6 — авто без ручного одобрения)

### Ф5 — Авто-режим за гейтом. Этап autonomous (kill-switch).
**Цель.** На покрытых темах с высокой откалиброванной уверенностью И высоким groundedness клон отвечает клиенту сам; иначе человек. Переход — авто-graduation по доказанному качеству, НЕ ручное «одобри» (R-INV-6).
**Входит:** пороги per-категория в AdminSetting (`support_autosend_confidence_min`, `support_autosend_groundedness_min`); reuse `ConfidenceCalibrationService` (taskType `support-clone-draft`, калибровка на ИСХОДАХ: реоткрытие/CSAT, не самооценке); раскатка shadow→graduated→cutover (метрики agreement/confidence-correlation); авто-graduation (composite judge + A/B), kill-switch `SUPPORT_CLONE_AUTOSEND_ENABLED`; лог обещаний клона (`IssueActivity actorType='ai_agent'`); **решить под-вопрос раскрытия AI клиенту** (Р-5) — либо явный лейбл, либо человеко-fallback на низкой уверенности.
**Что НЕ входит:** тон-адаптер (Ф5).
**Acceptance:** при `SUPPORT_CLONE_AUTOSEND_ENABLED=false` авто-отправки НЕТ (черновик человеку); shadow-метрики пишутся; gauge agreement-rate; авто-send срабатывает только при calibrated≥порог И groundedness≥порог (unit с подставными значениями).
**Закрывает:** R19, R20, R21. (R-INV-6)
> Перед стартом Ф5 — отдельное согласование с владельцем (раскрытие AI + первый включённый авто-send).

### Ф6 (позже) — тон-адаптер.
Тонкий DPO/LoRA-адаптер тона поверх RAG на накопленных классифицированных парах (`SupportDraftOutcome` editType='tone'). Открыть отдельным ТЗ когда наберётся датасет. Обучающий фреймворк — НЕ в прод-пути Z (вынести в research/инфра, не backend).

---

## Требования (EARS, трассируемые)
- **R1** Когда авторизованный пользователь любой Org шлёт `POST /support/tickets`, система shall создать `Issue` в `SUPPORT_VENDOR_ORG_ID` с `supportCustomerOrgId/UserId` = вызывающего.
- **R2** Если `SUPPORT_DESK_ENABLED=false`, then `POST /support/tickets` shall вернуть 503 `SUPPORT_DESK_DISABLED`.
- **R3** Когда клиент читает свой тикет, система shall возвращать только комментарии с `access='external'`.
- **R4** Система shall хранить контур поддержки как `KnowledgeGroup(kind='support', isClosed=true)` синглтон per вендор-Org.
- **R5** Когда добавляется галочка сотрудника, система shall создать `KnowledgeGroupMember(groupId=support, source='manual')`, и этот член shall получить доступ к деску.
- **R6** Когда клон ретривит для черновика, система shall ограничить пул `blockAccess.some.groupId=supportGroupId` ДО ранжирования, независимо от `KNOWLEDGE_ACCESS_ENFORCEMENT`.
- **R7** Когда создан тикет, система shall отправить `Notification('support.ticket_created')` в telegram+email сотрудников.
- **R8** Когда сотрудник запросил черновик, система shall вернуть `IssueComment(authorType='clone')` с `cloneConfidence`, `groundednessScore` и ≥1 цитатой.
- **R9** Если groundedness черновика < `support_critic_min_groundedness`, then исход shall быть `clarify`/`escalate`, не `answer`.
- **R10** Система shall поддерживать видимость `internal|customer` на `IssueComment` (поле `access`).
- **R11** Когда тикет создан, система shall проставить `firstResponseDueAt/resolutionDueAt` из `SupportSlaPolicy`.
- **R12** Когда дедлайн SLA нарушен, cron shall проставить `slaBreachedAt`.
- **R13** Засев контура shall быть идемпотентным (повтор = no-op по хэшу пары).
- **R14** Когда черновик принят/изменён/отклонён, система shall записать `SupportDraftOutcome` + `LlmPreferenceSample`.
- **R15** Несколько сотрудников shall назначаться на тикет (reuse `IssueAssignee`).
- **R16** Когда черновик изменён, система shall классифицировать тип правки (`support-edit-classify`) до записи сигнала.
- **R17** Только ответы, прошедшие гейт качества (accepted/edited + нет реоткрытия + CSAT≥порог), shall промоутиться в контур с провенансом `clone-accepted`.
- **R18** Холодный старт: при пустой истории правок черновик shall строиться из засеянной базы (few-shot/RAG).
- **R19** Если `SUPPORT_CLONE_AUTOSEND_ENABLED=false`, then авто-отправки клиенту НЕ происходит.
- **R20** Авто-отправка shall срабатывать только при calibrated confidence ≥ порога И groundedness ≥ порога (per-категория, AdminSetting).
- **R21** Каждая авто-отправка shall логироваться в `IssueActivity(actorType='ai_agent')`.
- **R22** Когда `SUPPORT_CURATOR_ENABLED=true`, ночной cron shall анализировать дневные сигналы и предлагать действия `keep|promote|fix|merge|archive` по блокам контура; при `false` — no-op.
- **R23** Перед любой destructive-операцией куратора (fix/merge/archive) система shall получить verdict `MultiAgentDebateService`; при verdict «против» операция НЕ применяется.
- **R24** Куратор shall выполнять удаление только как soft-archive (`status='archived'`/`supersededAt`), писать аудит каждой операции, и быть идемпотентным в пределах прогона.

---

## Совместимость с prompt caching
- `support-clone-draft`/`-critic`/`-edit-classify`: **стабильный SYSTEM** (роль, правила, формат ответа, инструкция цитат) — без переменных данных; всё переменное (вопрос клиента, контур-блоки, few-shot пары) — в КОНЦЕ user-сообщения. Few-shot блок ставить перед вопросом, но после стабильной инструкции; менять few-shot реже (батч-обновление), чтобы не ломать кэш на каждый запрос. DeepSeek/OpenAI-proxy кэшируют 95-99%. Правка SYSTEM = инвалидция кэша → менять SYSTEM редко.

## Pre-mortem / Риски (ревью-аспекты для strict-production-review-gate)
- Утечка контура (R-INV-1) — проверять, что фильтр PRE-, безусловный, и есть negative-CI-тест. **Главный аспект ревью.**
- Утечка internal-коммента/черновика клиенту (R-INV-3) — каждый клиентский read фильтрует `access='external'`; черновик `authorType='clone'` всегда `access='internal'`.
- Cross-tenant intake — `POST /support/tickets` пишет ТОЛЬКО в вендор-Support-проект, не читает чужой tenant; валидировать, что нельзя подсунуть произвольный `tenantId`/`projectId`.
- Petля само-отравления (R-INV-2) — гейт качества обязателен; провенанс+вес.
- Indirect prompt injection через текст обращения — в `support-clone-draft` контент клиента передаётся как ДАННЫЕ (в конце user), не как инструкция; клиентский виджет без tool'ов.
- Idempotency seed/contour-seed.

## Idempotency / feature-flag / prod-deploy
- **Флаги (Ship-On, → `docs/operations/feature-flags.md`):** `SUPPORT_DESK_ENABLED` (kill-switch, ON), `SUPPORT_CURATOR_ENABLED` (kill-switch, Ф4 ночной куратор, ON при выкате Ф4), `SUPPORT_CLONE_AUTOSEND_ENABLED` (kill-switch, Ф5), `feature.support_desk` (решение владельца — entitlement, включается только вендор-Org через `featureOverrides`), `SUPPORT_VENDOR_ORG_ID` (AdminSetting — параметр владельца, какая Org — деск).
- **Пороги (AdminSetting, не ENV):** `support_critic_min_groundedness`, `support_autosend_confidence_min`, `support_autosend_groundedness_min`, `support_rate_limit_per_user`.
- **prod-deploy-log.md шаги:** Шаг 1 (новые флаги/AdminSetting), Шаг 4 (новые модели/поля Issue/IssueComment + 3 модели + enum-значение `support`), Шаг 7 (`seed-support-project.ts`, `seed-support-contour-group.ts`, `seed-support-llm-routes.ts` — все в `apply-prod-deploy.ts STEPS`), Шаг 12 (smoke: SLA-cron, ночной curator-cron, новые taskType, Swagger `/support/*`). Скрипты — `createPrismaClient()`, импорты из `../src`.

## DoD
typecheck (вкл. `.spec`)/lint/build зелёные; vitest по новым spec; миграция применяется и идемпотентна на повторе; `second-brain/` обновлён по таблице производных заметок (новый модуль → `02_architecture/module-map.md`; новые job/cron → `01_projects/workers-queues.md`+`ai-jobs.md`; новые эндпоинты → `01_projects/api-layer.md`; новые модели/поля → `02_architecture/data-model.md`; новая страница → `frontend-pages.md`; реестр не-сделанного — строка про Ф4/Ф5); `prod-deploy-log.md` обновлён; реестр флагов обновлён; рефлексия после push.

## Итог
**Реализовано целиком Ф1→Ф4 (основной путь v1), 2026-06-09.** typecheck/lint/build зелёные; ~50 support-тестов; CI-тест изоляции R-INV-1; debate-gate R23; soft-archive R24.
- **Ф1** `356cc032` (бэкенд) + `d8ffbdf3` (фронт) — деск: cross-tenant приём в вендор-Org (Issue), клиент видит только `access='external'`, desk (reply/note/assign/transition), SupportAccessGuard (членство→`SUPPORT_NOT_AGENT`), SLA-сервис+cron, дублирование сотрудникам (Telegram+почта); флаг `SUPPORT_DESK_ENABLED`, entitlement `feature.support_desk`, AdminSetting `support.vendor_org_id`; миграция `support_desk_phase1` (поля Issue/IssueComment + SupportSlaPolicy + IssueRating + enum `support`); фронт — виджет + `/support/my-tickets` + `/support/desk`.
- **Ф2** `4cb444ed` — закрытый контур: `contourGroupId` ПОЗИТИВНЫЙ pre-filter (R-INV-1, безусловный, во всех ветках пула + expandViaGraph), галочка add/remove, ручной засев Q&A, CI-тест изоляции (pre-filter в where, enforcement-independent).
- **Ф3** `ae0fca83` (фундамент) + `24bf7e0f` (генерация) + `9d396cd4` (обучение) — миграция `SupportDraftOutcome`; клон-черновик (RAG из контура + few-shot + critic groundedness R-INV-5 → IssueComment authorType=clone); accept/edit/reject → `SupportDraftOutcome`+`LlmPreferenceSample`; промоут-гейт CSAT→контур (confidence 0.7, провенанс clone-accepted, R-INV-2); 3 taskType (draft→pro, critic+classify→flash).
- **Ф4** `14c4e6dc` — ночной куратор (`@Cron 03:00`, kill-switch `SUPPORT_CURATOR_ENABLED`): LLM `support-contour-curate` предлагает keep|promote|fix|merge|archive; destructive только за `MultiAgentDebateService` (R23); soft-archive `status='archived'/'merged_into'`, НИКОГДА delete (R24); миграция `SupportCuratorAction` (аудит).

**Осталось за отдельным согласованием владельца:** **Ф5** (авто-отправка клиенту — за `SUPPORT_CLONE_AUTOSEND_ENABLED`, нужен owner-go + решение про раскрытие AI клиенту) и **Ф6** (тон-адаптер DPO/LoRA — отдельное ТЗ, после накопления `editType='tone'` пар). Зафиксировано в `second-brain/04_не-сделано/README.md`.
