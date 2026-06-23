---
type: tz
status: ready-to-implement
feature: unified-chat-kora
date: 2026-06-21
owner: Сергей (sergrv80@gmail.com)
relates_to:
  - plans/analysis/2026-06-21-unified-chat-kora/99-synthesis.md
  - plans/analysis/2026-06-03-internal-messenger-anti-ban-research.md
  - plans/analysis/2026-06-21-support-desk-messenger-prototype.html
  - plans/archive/2026-06-09-support-desk-clone-and-closed-contour-tz.md
  - second-brain/01_projects/support-desk.md
  - second-brain/01_projects/conversational-channels.md
  - second-brain/01_projects/chat-v2.md
---
> Анализ: `plans/analysis/2026-06-21-unified-chat-kora/99-synthesis.md` (research-complete) · Статус согласования: 2026-06-21 (архитектура **вариант A — единое ядро**; 4 продуктовые развилки закрыты)
> Прототип (UI-эталон, одобрен): `plans/analysis/2026-06-21-support-desk-messenger-prototype.html`
> **Смена архитектуры 2026-06-21:** поддержка ещё НЕ запущена (нет живых данных) → выбран **вариант A (единое ядро)** вместо B+ (два склада). Это упрощает ТЗ: 4 из 7 «инвариантов-костылей» исчезают.

# ТЗ: Единый чат Коры (единое ядро сообщений: внутренний чат + поддержка)

## Принцип
Строим **единый диалоговый слой**, который кормит память компании (граф знаний). **Один склад сообщений на всё** (`Conversation` + `Message`): и командные чаты (личка/группы/каналы), и обращения клиентов поддержки. **Тикет поддержки = `Conversation(kind='ticket')` + обёртка `SupportTicket`** с ярлыками (статус, SLA, клиент, ответственный); богатая логика поддержки (закрытый контур, клон-черновик, critic, ночной куратор) **пересаживается** с тикетов-задач (`Issue`/`IssueComment`) на общее ядро. Поддержка ещё не запущена — переписать её сейчас дёшево, пока нет живых данных и пока не наросли «костыли». Мобильная удобность — сквозное требование.

## Вне scope / отложено владельцем
- **Треды-форумы (Zulip/Discord-стиль) и иерархия workspace→команды→каналы** — не v1 (Р4). Только плоские каналы + плоский reply (`parentMessageId`).
- **E2EE приватных каналов, федерация серверов, бот-платформа (Bot API), коллаб для внешних контрагентов** — vNext. _(Опросы — входят в Ф7 доводки.)_
- **Перенос ЗАДАЧ трекера (`Issue` для задач, НЕ для тикетов) на общее ядро** — НЕ трогаем; `Issue` остаётся моделью задач трекера. На общее ядро переезжают только **тикеты поддержки**.
- **Миграция живых данных поддержки** — не нужна (поддержка не запущена, тикетов нет). Старые support-поля на `Issue`/`IssueComment` (миграция 2026-06-09) становятся неиспользуемыми; их удаление — опциональная уборка (Ф3, не блокер).

---

## Цель + Зачем
**Цель.** Сотрудник ведёт всю рабочую переписку в Коре (личка, группы, каналы, рабочие чаты из задач/встреч, обращения клиентов) на одном экране «Сообщения»; переписка автоматически пополняет граф знаний; всё удобно на телефоне; блокировка одного канала доставки не «выключает» команду.

**Зачем ([99-synthesis §1]).** Переписки сотрудник↔сотрудник как продукта нет ([04-code-convergence §0]). Около-чатовые куски разрознены (поддержка на `Issue`, AI-чат `chat-v2` read-only, уведомления `conversational`, чат встречи эфемерный). Знание из переписки не в графе и уходит с сотрудником. Дифференциатор Коры (граф / семантический поиск истории / клоны) — нет ни у кого ([02/03]); baseline рынка 2026 = расшифровка голосовых бесплатно + авто-конспект встречи.

---

## REALITY-CHECK (снято 2026-06-21; vexp-демон недоступен — Grep/Read; номера строк дрейфуют, перед правкой перечитать по якорю-символу)

**Готово и переиспользуется (НЕ переделывать):**
- **WebSocket-транспорт + presence/typing** — `backend/src/modules/tracker/gateways/tracker.gateway.ts`: `namespace:'/ws/tracker'` (:28), auth cookie/JWT, `@SubscribeMessage('issue.chat.join'/'leave'/'typing')` (:166/:203/:217), события `presence:user_joined/left/typing`, `presenceRoom()` (:260). **Добавить** `conversation.join/leave/typing` + room `conversation:<id>` + `message.new` (копия логики `issue.chat.*`).
- **Форма сообщения (образец для `Message`)** — `IssueComment` (`schema.prisma` ~:9440): `parentCommentId`, `content/contentHtml/contentStripped`, `access` (internal/external), `authorType` (human/clone/system), `voiceUrl/voiceDuration/voiceTranscript`, `thanksUserIds`, `attachments/mentions`, `draftState/cloneConfidence/groundednessScore`. Это готовая «анатомия» — `Message` лепим по ней.
- **Идемпотентность** — `MeetingRoomMessage.clientMessageId @unique` (`schema.prisma` ~:2011) — эталон.
- **Мультиканальная доставка** — `conversational.service.ts` `sendNotification` + `EVENT_TYPE_CHANNEL_POLICY` + адаптеры in_app/email_smtp/telegram_bot/max_bot; echo `sendChatReply`/`resolveOriginChannelKinds`.
- **Чат → граф (ingest)** — `conversational-ingest.adapter.ts`: `ingestFreeNote()` (:19), `kind:'free_note'` (:31). `ingest.service.ts`→RawEvent→coreQueue. `SourceType.chat` в enum (`schema.prisma` ~:253). `segment-builder.service.ts` ветка `free_note`→IdeaBlock. **Добавить** `kind:'chat_message'` + ветку.
- **Логика поддержки (пересаживается на ядро, НЕ выбрасывается)** — `backend/src/modules/support/*`: закрытый контур `support-contour.service.ts` + pre-filter `chat-v2-retrieval.service.ts:~377`, клон-черновик `support-clone.service.ts`, critic `support-answer-critic.service.ts`, классификатор правок `support-edit-classify.service.ts`, ночной куратор `support-curator.*`, SLA `support-sla.*`, обучение `support-learning.service.ts`. Модели `SupportSlaPolicy/IssueRating/SupportDraftOutcome/SupportCuratorAction`, контур `KnowledgeGroup(kind='support')`. **Меняется привязка** (Issue/IssueComment → Conversation/Message+SupportTicket), сама логика сохраняется.
- **Прототип UI** — `plans/analysis/2026-06-21-support-desk-messenger-prototype.html`.

**Факт, изменивший архитектуру:** поддержка (Ф1–Ф4, коммиты 2026-06-09) **в ветке dev, НЕ на проде, не используется, живых тикетов нет** (`docs/operations/prod-deploy-log.md` — раздел «Накоплено к выкату», не «Архив применённых»). → переписать на единое ядро сейчас безопасно (нечего ломать, нет миграции данных).

**Чего НЕТ — строим:**
- Моделей `Conversation`/`ConversationMember`/`Message`/`SupportTicket` — нет (grep `model Conversation` пусто). Единое ядро строим с нуля.
- `@socket.io/redis-adapter` в `backend/src/main.ts`/`package.json` — **НЕ установлен** (presence в in-process Map). Работа Ф1.
- Слой корректности (per-thread `seq`, transactional outbox, `lastReadSeq`, докачка `since-seq`) — нет.
- Единый контроллер `/message-threads`, единый список — нет (сейчас `support-desk.service.ts` `listTickets` отдельно; при едином ядре это один list по `Conversation`).
- taskType `chat-summary` — нет.
- Нативный мобильный пуш (APNs/RuStore) — только web-push VAPID.

**Проверить в Ф0:** существующий Bitrix-ingest. По `second-brain/04_не-сделано` (2026-06-21) внутренние чаты Bitrix уже втекают в `RawEvent` — Ф0 для Bitrix может быть «достроить привязку». Снять факт `run_pipeline`/Grep ДО старта Ф0.

---

## Принятые решения владельца (НЕ пересматривать; закрыты 2026-06-21)

| # | Решение | Обоснование |
|---|---|---|
| Р1 | **Архитектура = вариант A (единое ядро).** Один склад `Conversation/Message` на всё (чат + поддержка). Тикет = `Conversation(kind='ticket')` + обёртка `SupportTicket`. Логику поддержки пересаживаем на ядро | Поддержка НЕ запущена (нет данных) → главный контраргумент A «не ломать рабочее» отпал; A стратегически сильнее (Intercom/Missive/Front/Slack), убирает костыли [99-synthesis §5-6, 05-redteam] |
| Р2 | `Conversation` несёт `kind: dm\|group\|channel\|ticket`. Support-обёртка `SupportTicket(conversationId @unique)` хранит ярлыки (статус/SLA/клиент). `Message.access` (normal\|internal\|external) — видимость клиенту в тикете | Тикет — это разговор + ярлыки, не задача-в-трекере; чисто концептуально |
| Р3 | Единый список ленты — **один запрос по `Conversation`** (+ join `SupportTicket` для ярлыков), фильтр по `kind`. Фасад-провайдеры/union двух складов НЕ нужны (один склад) | Упрощение vs B+; курсор по одной таблице |
| Р4 | Объём ядра чата = личка + группы + **плоские каналы** (вкл. обязательный «канал на компанию», покинуть нельзя). Без тредов-форумов/иерархии | Каналы дёшевы; форумы — высокий UX-порог [01/03] |
| Р5 | **ВСЯ переписка кормит граф, включая личку 1:1.** Кора — рабочий инструмент, личных сообщений нет. Приватность: в граф идут ИЗВЛЕЧЁННЫЕ знания (как из встреч); прямое чтение ТЕЛ — member-scoped (super_admin тела не читает) | Владелец 2026-06-21: «всё рабочее → всё в память» |
| Р6 | Мост-загрузки (Bitrix24/Telegram-экспорт → граф без перехода) = Ф0, первым/параллельно | «Moat на полу» [2026-06-03 §8] |
| Р7 | Huddles (созвон из чата на LiveKit) = Ф7 (доводка), не блокирует ядро | LiveKit в стеке; «вау», не ядро |
| Р8 | Мобильность — сквозное (Ф6 + учёт в UI-фазах); пуш APNs/RuStore, FCM никогда фундамент | Линейный персонал — главные пострадавшие от блокировок [06-mobile-ux] |

### Инварианты сведения (при едином ядре — встроены, не костыли)
Единое ядро устраняет 4 из 7 инвариантов red-team (они были нужны лишь чтобы склеить ДВА склада): **единый read-cursor** (один `lastReadSeq` на `ConversationMember`), **единый поисковый индекс** (один склад `Message`, GIN по `contentStripped`), **единый AI-ingest** (один источник `Message`), **схема расхождений** (одна схема) — стали свойством архитектуры. Остаются 3 как здоровая практика:
- **INV-A1** Единый list-DTO `InboxItem` (kind определяет рендер; поля поддержки `status/slaBreachedAt` опциональны/`null` для не-тикетов).
- **INV-A2** Единый UI-компонент `<MessageBubble sourceKind>` без if-else по типу выше него.
- **INV-A3** Единый контроллер ленты `/message-threads` — фронт не ходит в разрозненные эндпоинты движков.

---

## Доказательство выбора (полная матрица — [99-synthesis §5-6])

| Критерий | **A. Единое ядро (выбран)** | B+. Два склада + переходник | C. Раздельно |
|---|---|---|---|
| Поддержка не запущена → ломать нечего | ✓ (миграции данных нет) | ✓ но не использует факт | ✓ |
| Поиск/прочитанное/AI-память | ✓ из коробки | ⚠ только при 7 инвариантах | ✗ |
| Кол-во «инвариантов-костылей» | **3 (здоровых)** | 7 | — |
| «Перенос потом» | **не нужен** | нужен (vNext) | — |
| Цена сейчас | переписать support (не на проде) | почти нет | низкая, долг UX |
| Как делают лидеры | Intercom/Missive/Front/Slack | Zendesk side-conv (провал) | Zendesk (ценой разрыва) |

**Проход B+ (отвергнут с новым фактом):** держать два склада и склеивать переходником имело смысл ТОЛЬКО чтобы не ломать рабочую поддержку. Поддержка не запущена → экономия исчезает, остаются костыли (7 инвариантов) и обязательный «перенос потом». **Вариант A честнее: один склад, поддержка пересаживается сейчас, пока дёшево.** Red-team прямо назвал единое ядро стратегически сильнее.

---

## Scope
**Входит:** Ф0 мост-загрузки; Ф1 единое ядро (`Conversation/ConversationMember/Message/MessageOutbox` + слой корректности + WS + presence-Redis + RBAC + шифрование + ФЗ-41 gate); Ф2 внутренний чат (личка/группы/каналы); Ф3 поддержка на ядре (`SupportTicket`-обёртка + пересадка контур/клон/critic/куратор/SLA/CSAT); Ф4 единый экран «Сообщения» (один список + контроллер + общий UI + поиск); Ф5 AI-крючки; Ф6 мобильное приложение; Ф7 доводка (huddles/опросы/автоудаление/HR-подписки).

**Не входит:** см. «Вне scope».

## Граничные контракты с другими ТЗ / подсистемами
- **`Issue` (трекер задач)** — НЕ трогаем как модель задач. На ядро переезжают только тикеты поддержки (которые сейчас тоже на `Issue` — это и есть пересадка). Связь «задача из сообщения» (Ф5) создаёт обычный `Issue`-task через intake.
- **chat-v2** — переиспользуем как движок ответа «Спросить Кору / Что решили» (RAG поверх графа) со ссылкой на `Message.id`; не дублируем retrieval.
- **conversational** — `sendNotification` как outbound-будильник; тело наружу не шлём (ФЗ-41).
- **knowledge-core ingest** — кормим через `ingest()` + `kind:'chat_message'`; не вводим новый `signalType` (используем `expertise`/`reasoning`); воркеры in-process через `WorkersModule` (CLAUDE.md — отдельного worker-процесса нет).
- **Закрытый контур поддержки** — переиспrout), pre-filter `contourGroupId` остаётся; меняется лишь то, что блоки контура порождаются из `Message` тикета, не из `IssueComment`.
- **LiveKit** — только медиа (Ф7 huddles); токены на бэке.

---

## Контракт-first (единый источник правды для копипасты)

### Prisma (миграции ФАЙЛОВЫЕ — `bun run prisma:migrate -- --name <...>`, НЕ db push)

```prisma
enum ConversationKind {
  dm
  group
  channel
  ticket   /// обращение клиента = разговор + обёртка SupportTicket
}

model Conversation {
  id              String   @id @default(cuid())
  tenantId        String
  kind            ConversationKind
  title           String?
  isMandatory     Boolean  @default(false) /// обязательный «канал на компанию» — покинуть нельзя (Р4)
  feedsGraph      Boolean  @default(true)  /// вся переписка кормит граф, вкл. dm (Р5); поле под будущие исключения
  createdByUserId String
  lastMessageAt   DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  members         ConversationMember[]
  messages        Message[]
  supportTicket   SupportTicket?
  @@index([tenantId, kind, lastMessageAt])
}

model ConversationMember {
  id             String    @id @default(cuid())
  conversationId String
  userId         String
  role           String    @default("member") /// owner|admin|member|agent (agent — сотрудник поддержки в тикете)
  lastReadSeq    BigInt    @default(0)         /// единый read-cursor
  mutedUntil     DateTime?
  source         String    @default("manual")  /// manual|auto (HR-derived, Ф7)
  joinedAt       DateTime  @default(now())
  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  @@unique([conversationId, userId])
  @@index([userId])
}

model Message {
  id              String    @id @default(cuid())
  tenantId        String
  conversationId  String
  seq             BigInt    /// монотонный per-conversation, gap-free (НЕ timestamp)
  authorUserId    String
  authorType      String    @default("human") /// human|clone|system (clone — черновик клона в тикете)
  access          String    @default("normal") /// normal (чат) | internal (заметка команды) | external (видно клиенту) — тикет
  content         String    @db.Text
  contentStripped String?   @db.Text /// для поиска (GIN)
  parentMessageId String?   /// плоский reply (НЕ форум, Р4)
  clientMessageId String    /// идемпотентность отправки
  voiceUrl        String?
  voiceDuration   Int?
  voiceTranscript String?   @db.Text
  attachments     Json?
  mentions        String[]
  reactions       Json?     /// {"👍":["userId"]}
  // support-специфика черновика клона (nullable, только тикеты):
  draftState        String?  /// null|pending|accepted|edited|rejected
  cloneConfidence   Decimal? @db.Decimal(4,3)
  groundednessScore Decimal? @db.Decimal(4,3)
  editedAt        DateTime?
  deletedAt       DateTime?
  createdAt       DateTime  @default(now())
  conversation    Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  @@unique([conversationId, clientMessageId]) /// dedup отправки/reconnect
  @@unique([conversationId, seq])             /// gap-free лог
  @@index([conversationId, seq])
  @@index([tenantId, createdAt])
}

model MessageOutbox { /// transactional outbox (Message + outbox в одной транзакции)
  id        String   @id @default(cuid())
  messageId String   @unique
  status    String   @default("pending") /// pending|sent
  attempts  Int      @default(0)
  createdAt DateTime @default(now())
  @@index([status, createdAt])
}

model SupportTicket { /// обёртка-ярлыки поверх Conversation(kind='ticket')
  id                 String   @id @default(cuid())
  tenantId           String   /// вендор-Org (деск)
  conversationId     String   @unique
  status             String   @default("new") /// new|in_progress|waiting|resolved|closed|spam
  customerOrgId      String?  /// Org клиента
  customerUserId     String?  /// User клиента (глобальный)
  customerContact    String?  @db.VarChar(320)
  firstResponseDueAt DateTime?
  resolutionDueAt    DateTime?
  firstRespondedAt   DateTime?
  slaBreachedAt      DateTime?
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
  conversation       Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  @@index([tenantId, status])
  @@index([tenantId, firstResponseDueAt])
}
// SupportSlaPolicy / SupportDraftOutcome / SupportCuratorAction — остаются; привязку issueId/issueCommentId заменить на conversationId/messageId.
// IssueRating (CSAT) — переиспользовать с привязкой к conversationId (или новая ConversationRating; решает Ф3 по фактической схеме).
```
> GIN полнотекста по `Message.contentStripped` — в `postgres-init.sql` (Шаг 5), НЕ в schema. `BigInt seq` — атомарный инкремент per-conversation в транзакции (НЕ `now()`).

### Единый list-DTO (Zod + Swagger), INV-A1
```ts
InboxItem = {
  kind: 'dm' | 'group' | 'channel' | 'ticket' | 'work_chat',
  refId: string,                 // conversationId
  title: string,
  snippet: string,
  lastMessageAt: string,
  unreadCount: number,
  // только-ticket: для прочих kind = null (INV-A1)
  status: string | null,
  slaBreachedAt: string | null,
}
```

### Единый контроллер (INV-A3)
```
GET  /api/v1/message-threads?type=all|dm|group|channel|ticket|unread&cursor=  → { items: InboxItem[], nextCursor }
POST /api/v1/message-threads/:conversationId/read  body:{ cursorSeq }          → 200
GET  /api/v1/conversations/:id/messages?sinceSeq=                              → { items: Message[], nextSeq }
POST /api/v1/conversations/:id/messages  body:{ content, clientMessageId, parentMessageId?, voice?, access? } → 201
POST /api/v1/conversations            body:{ kind, title?, memberUserIds[] }   → 201
POST /api/v1/conversations/:id/members body:{ userId }                         → 200
GET  /api/v1/message-search?q=&type=all                                        → { items: [{conversationId, messageId, snippet}] }
// тикеты-специфика (поверх той же Conversation):
POST /api/v1/support/tickets          body:{ subject, message } (клиент)       → 201 { conversationId }
POST /api/v1/conversations/:id/ticket/transition body:{ status }              → 200
POST /api/v1/conversations/:id/ticket/draft                                    → 202 (клон-черновик)
// ошибки: CHAT_DISABLED(503), NOT_MEMBER(403), MANDATORY_CHANNEL_LEAVE_FORBIDDEN(409), SUPPORT_DESK_DISABLED(503)
```

### BullMQ / WS
```
WS (tracker.gateway.ts /ws/tracker): 'conversation.join'/'leave'/'typing' (room conversation:<id>), emit 'message.new'
Queue 'message.outbox': jobId = `msg-outbox:${messageId}` (идемпотентно)
Queue 'chat.ingest' (feedsGraph): jobId = `chat-ingest:${messageId}`
taskType 'chat-summary' (Ф5 «Что пропустил»)
```

### ASCII-поток (отправка, Ф1) — общий для чата и тикета
```
[POST /conversations/:id/messages {clientMessageId, access?}]
        │ (одна транзакция)
        ├─ seq = nextSeq(conversationId)
        ├─ INSERT Message (dedup по @@unique clientMessageId → P2002 = вернуть существующее)
        └─ INSERT MessageOutbox(pending)
        ▼
[relay 'message.outbox' FOR UPDATE SKIP LOCKED]
        ├─ WS emit 'message.new' в room conversation:<id>
        ├─ офлайн-получателям: debounce-будильник sendNotification (наружу ТОЛЬКО сигнал без тела/имён — ФЗ-41)
        └─ если conversation.feedsGraph (по умолчанию ВСЕ, вкл. dm — Р5): enqueue 'chat.ingest'
                (для тикета: external-ответы клиенту кормят закрытый контур поддержки как раньше)
```

---

## Границы фичи
- ✅ Always: tenant-scoping `@@index([tenantId,...])`; Zod-DTO+Swagger; `seq` атомарный per-conversation; идемпотентность `clientMessageId`; наружу только сигнал; super_admin не читает тела; `Message.access` проверять на КАЖДОМ чтении ленты клиентом (тикет); крутилки в AdminSetting.
- ⚠️ Ask first: трогать `Issue` как модель задач; общий retrieval chat-v2; открывать прямое чтение тел чужой переписки (граф — да, тела — member-scoped); новый ENV вместо AdminSetting.
- 🚫 Never: тело во внешний канал; пост-фильтрация доступа (только pre-filter по членству); `seq` от timestamp; прямой вызов фронтом разрозненных движков в обход `/message-threads` (INV-A3); `process.env.*` мимо env.schema; `prisma migrate dev` мимо файловых миграций; `new PrismaClient()` в скриптах; код ради кода.

---

## Фазы (dependency-ordered)

**Граф:** Ф0 ∥ Ф1 (независимы) → Ф2 ∥ Ф3 (оба на ядре Ф1) → Ф4 (нужны Ф2+Ф3) → Ф5 → Ф6 → Ф7. Внутри фазы: Prisma → сервис → контроллер → фронт → e2e.

### Ф0 — Мост-загрузки (moat на полу).
**Картография:** `conversational-ingest.adapter.ts:19/31`, `ingest.service.ts`, `segment-builder.service.ts` (ветка `free_note`), `SourceType.chat` (`schema.prisma:~253`), Bitrix-ingest (REALITY-CHECK).
**Цель.** Переписку из Bitrix24/Telegram-экспорта втянуть в граф через `ingest(SourceType.chat)` без перехода на наш чат.
**Входит:** `kind:'chat_message'` в `conversational-ingest.adapter.ts` + ветка в `segment-builder.service.ts` (→IdeaBlock); адаптер Bitrix (достроить привязку, если ingest есть) + загрузчик Telegram-экспорта; kill-switch `MESSAGE_BRIDGE_ENABLED`.
**Не входит:** наш чат (Ф1+); UI.
**Файлы:** правка `conversational-ingest.adapter.ts`, `segment-builder.service.ts`; `backend/src/modules/<bridge>/*`; `backend/scripts/backfill-chat-bridge-*.ts` (идемпотентно, в `apply-prod-deploy.ts`).
**Acceptance:** сообщение Bitrix → `RawEvent(sourceType='chat',kind='chat_message')` идемпотентно (повтор=no-op); `segment-builder` создаёт `IdeaBlock`; при `MESSAGE_BRIDGE_ENABLED=false` no-op; `bun run typecheck && build` зелёные.
**Тесты:** `bunx vitest run backend/src/modules/<bridge>/*.spec.ts`.
**Закрывает:** R1, R2.

### Ф1 — Единое ядро `Conversation/Message` (фундамент для чата И поддержки).
**Картография:** `tracker.gateway.ts:28/166/203/217/260`, `IssueComment:~9440`/`MeetingRoomMessage.clientMessageId:~2011`, `main.ts` (нет redis-adapter), `common/crypto` (AES-256-GCM), `rbac` `policy.csv`.
**Цель.** Один склад сообщений + надёжная доставка + realtime + presence в Redis + доступ по членству + тела не наружу.
**Входит:** миграция (`Conversation/ConversationMember/Message/MessageOutbox` — Контракт-first; `SupportTicket` — в Ф3); сервис сообщений (атомарный `seq`+outbox в транзакции, dedup `clientMessageId`); WS `conversation.*` + room + `message.new`; **`@socket.io/redis-adapter` + presence Redis-TTL** в `main.ts`; докачка `?sinceSeq`; `markRead` (единый read-cursor); relay-воркер `message.outbox` (FOR UPDATE SKIP LOCKED → WS + debounce-будильник, наружу только сигнал); RBAC `conversation`/`message` (member-scoped, super_admin не читает тела); AES-256-GCM at-rest для `content`; `Message.access` (normal/internal/external); kill-switch `CHAT_ENABLED`; **комплаенс-gate** (тест валит сборку при теле во внешнем канале — ФЗ-41) + аудит легаси-событий.
**Не входит:** типы диалогов-UX (Ф2); поддержка-обёртка (Ф3); единый экран (Ф4); AI (Ф5).
**Файлы:** `backend/src/modules/messaging/` (services: conversation/message/read-cursor/outbox-relay, dto/*); правка `tracker.gateway.ts`, `main.ts`; миграция; Context7 — `@socket.io/redis-adapter` под текущую socket.io.
**Acceptance:** миграция применяется, повтор=no-op; 2 параллельных POST с одним `clientMessageId` → одна `Message`; `seq` 1..N без дыр (unit 100 сообщений); `?sinceSeq=N` отдаёт только `seq>N`; `markRead` → `lastReadSeq`, `unreadCount=maxSeq−lastReadSeq`; presence переживает рестарт инстанса (Redis); negative ФЗ-41 (во внешний канал payload без `content`/имён, тест падает при теле); `CHAT_ENABLED=false`→503; super_admin не получает `content` где не член.
**Тесты:** `messaging-*.spec.ts` (dedup, seq, read-cursor, outbox-relay, presence-redis, foreign-channel-no-body).
**Закрывает:** R3, R4, R5, R6, R7, R8.

### Ф2 — Внутренний чат: личка / группы / каналы (поверх ядра).
**Картография:** ядро Ф1; `orgs`/`rbac` (членство), прототип.
**Цель.** Создание диалогов всех типов; обязательный «канал на компанию»; членство.
**Входит:** создание `Conversation(kind=dm|group|channel)`; добавление участников; обязательный канал (`isMandatory`, выход → `MANDATORY_CHANNEL_LEAVE_FORBIDDEN`); реакции/упоминания/тред-reply/голос на UI; крутилка «порог авто-фильтра непрочитанных» (AdminSetting).
**Не входит:** тикеты (Ф3); единый экран-агрегатор (Ф4 — здесь экран чата сам по себе); мобайл (Ф6).
**Файлы:** `messaging/conversation.controller`, dto; `frontend/app/(authenticated)/messages/*` (базовый чат), `frontend/src/ui/messaging/*`.
**Acceptance:** создаётся dm/group/channel; обязательный канал нельзя покинуть (409); упоминание/реакция/голос работают; `feedsGraph=true` по умолчанию (вкл. dm — Р5).
**Тесты:** `conversation.spec.ts` (типы, mandatory-leave, membership).
**Закрывает:** R9, R10.

### Ф3 — Поддержка на едином ядре (пересадка, НЕ переписывание логики с нуля).
**Картография:** `backend/src/modules/support/*` (contour/clone/critic/edit-classify/curator/sla/learning, controllers), `chat-v2-retrieval.service.ts:~377` (pre-filter контура), модели `SupportSlaPolicy/IssueRating/SupportDraftOutcome/SupportCuratorAction`, `KnowledgeGroup(kind='support')`.
**Цель.** Тикет = `Conversation(kind='ticket')` + `SupportTicket`-обёртка; переписка тикета = `Message`; вся логика поддержки (контур/клон/critic/куратор/SLA/CSAT/обучение) пересажена с `Issue/IssueComment` на ядро.
**Входит:** миграция `SupportTicket` (Контракт-first) + перепривязка `SupportSlaPolicy/SupportDraftOutcome/SupportCuratorAction` на `conversationId/messageId`; CSAT на `conversationId`; приём обращения клиента `POST /support/tickets` создаёт `Conversation(kind='ticket')`+`SupportTicket` (вендор-Org) + первое `Message(access='external')`; ответ агента = `Message(access='external')`, заметка = `access='internal'`, черновик клона = `Message(authorType='clone', draftState='pending', access='internal')`; статусы (`status` на `SupportTicket`); назначение (через `ConversationMember role='agent'`); SLA-cron перепривязан; закрытый контур — блоки из `Message` тикета (pre-filter `contourGroupId` сохраняется); клон-черновик/critic/edit-classify/куратор работают на `Message`; **удалить/депрекейтнуть** старый Issue-based support-код и неиспользуемые support-поля `Issue/IssueComment` (опц. миграция, данных нет); seed Support (вендор-Org/контур-группа/LLM-маршруты) перенастроить на новые модели; флаги `SUPPORT_DESK_ENABLED`/`SUPPORT_CURATOR_ENABLED`, AdminSetting `support.vendor_org_id`, entitlement `feature.support_desk` сохраняются.
**Не входит:** единый экран (Ф4 — здесь backend+деск работают); авто-ответ клиенту (Ф5/owner-go отдельно); мобайл (Ф6).
**Файлы:** переписать `backend/src/modules/support/services/*` и controllers на ядро; миграция `SupportTicket`+перепривязки; правка `chat-v2-retrieval` (контур из Message); `seed-support-*`; фронт `support/desk` на общий `<MessageBubble>`.
**Acceptance:** `POST /support/tickets` от Org-A создаёт `Conversation(kind='ticket')`+`SupportTicket(customerOrgId='A')`+`Message(access='external')`; клиент видит ТОЛЬКО `access='external'` (negative: `internal` не в выдаче); черновик клона = `Message(authorType='clone',draftState='pending')` с цитатами из контура (reuse контур-isolation тест на Message); SLA-cron ставит `slaBreachedAt`; куратор soft-archive за debate-гейтом (как было); грепом — нет рабочих ссылок на старый Issue-based support-путь; `typecheck/lint/build` зелёные.
**Тесты:** `support-*.spec.ts` переписаны на ядро (contour-isolation на Message, clone-draft, critic, learning, sla, curator).
**Закрывает:** R11, R12, R13, R14.

### Ф4 — Единый экран «Сообщения» (агрегатор + общий UI).
**Картография:** ядро Ф1–Ф3, прототип (раскладка список/чат/контекст), `tailwind.config.ts` (парные токены).
**Цель.** Один список: личка+группы+каналы+рабочие чаты+тикеты; общий компонент сообщения; доступ через единый контроллер.
**Входит:** `GET /message-threads` — один запрос по `Conversation` (+join `SupportTicket`) с фильтром `type`, составной курсор `(lastMessageAt,id)` (INV-A1/A3); единый badge непрочитанного (Redis-кэш TTL); `/message-search` (GIN по `Message.contentStripped`); фронт раздел «Сообщения» (лента/чат/контекст-панель) + общий `<MessageBubble sourceKind>` (INV-A2) + композер с переключателем «клиент/заметка» для тикета.
**Не входит:** AI-крючки (Ф5); мобайл-приложение (Ф6 — десктоп тут отзывчивый).
**Файлы:** `messaging/inbox.controller`+inbox.service (один запрос, без фасада-провайдеров — один склад); `frontend/app/(authenticated)/messages/*`, `frontend/src/ui/messaging/MessageBubble.tsx`, `messaging.api.ts`, `domain/messaging.ts`.
**Acceptance:** `/message-threads?type=all` отдаёт `Conversation` всех kind (вкл. ticket) одним списком, сортировка `lastMessageAt`, курсор через ≥2 страницы без дублей/пропусков; `InboxItem` ticket несёт `status/slaBreachedAt`, прочие — `null` (INV-A1 negative); `/message-search` ищет по одному складу `Message`; grep INV-A3 (фронт «Сообщения» зовёт только `/message-threads`); grep INV-A2 (один `<MessageBubble>`); `typecheck/lint/build` (front+back); UI русский; парные токены.
**Тесты:** `inbox.spec.ts` (один запрос, kind-фильтр, INV-A1 null), `message-search.spec.ts`; front `test:unit` (MessageBubble chat+ticket).
**Закрывает:** R15, R16 (INV-A1/A2/A3).

### Ф5 — AI-крючки (дифференциатор).
**Картография:** `ingest`/`conversational-ingest.adapter` (Ф0), chat-v2 retrieval, `llm-router.service.ts`, intake-воркер, Meeting-закрытие, ASR.
**Цель.** Чат кормит граф; «Спросить Кору/Что решили»; «Что пропустил»; сообщение→задача/решение; расшифровка голосовых; авто-сообщение в чат при закрытии встречи.
**Входит:** `chat.ingest` для всех `feedsGraph=true` тредов (вкл. dm — Р5; один источник `Message`, без разветвления); taskType `chat-summary` (стабильный SYSTEM, переменное в конце user); «Спросить Кору» поверх chat-v2 со ссылкой на `Message.id`; сообщение→задача (intake-источник `chat`, создаёт `Issue`-task) и →решение (реестр решений); расшифровка голосовых (`voiceTranscript` ASR); системное `Message(authorType='system')` в связанный чат при закрытии встречи; крутилки `chat_summary_min_messages`/`chat_summary_idle_days` (AdminSetting); `seed-llm-task-routes-chat.ts` (chat-summary→DeepSeek V4 Pro).
**Не входит:** мобайл (Ф6); huddles (Ф7); авто-ответ клиенту поддержки (отдельный owner-go).
**Файлы:** `messaging` (ingest-adapter, summary-service, message-actions), `seed-llm-task-routes-chat.ts`, `chat-summary.prompt.ts`; правка intake, Meeting-закрытие.
**Acceptance:** сообщение в любом `feedsGraph` треде (вкл. dm) → `chat.ingest`→`IdeaBlock` (один путь, grep — нет двух адаптеров); приватность (тело чужой переписки не отдаётся прямым чтением, super_admin тоже — R-priv); «Что пропустил» при N≥порога → сводка с переходами; «Спросить Кору» → ссылка на `Message.id`; сообщение→задача создаёт `Issue` с `EntityLink` на автора; голосовое → `voiceTranscript`; закрытие встречи → системное `Message`; раздел prompt caching соблюдён.
**Тесты:** `chat-ingest.spec.ts`, `chat-summary.spec.ts`, `message-to-task.spec.ts`, `privacy-body-scope.spec.ts`.
**Закрывает:** R17, R18, R19, R20.

### Ф6 — Мобильное приложение (сквозное Р8).
**Картография:** `kora-mobile` (RN, «не начато» по 2026-06-03), `06-mobile-ux.md`, пуш (VAPID есть, нативного нет).
**Цель.** Единый чат удобен на телефоне; нативный пуш без Google.
**Входит:** одноколоночный поток (список→чат→контекст-шторка снизу); нижняя навигация (Сообщения·Поддержка·AI/Кора·Я; «Поддержка» по RBAC); композер с голосом hold→swipe-up-lock→swipe-left-cancel + выбор «голос/расшифровка»; `PushService` (зеркало llm-router): APNs(iOS)/RuStore(Android) primary, VAPID(web), FCM НИКОГДА фундамент; `PushToken{platform,transport,token}`; офлайн-очередь+докачка `sinceSeq`; деск на мобиле — переключатель «клиент/заметка» с цветом фона; collision-detection; умный бейдж; утренняя пуш-сводка.
**Не входит:** huddles (Ф7).
**Файлы:** `kora-mobile/*`; backend `PushService`+`PushToken` миграция+регистрация; крутилки `push_debounce_seconds`/`unread_smart_badge`.
**Acceptance:** Reliability-gate (фон будится пушем ≤N сек на iOS-APNs и Android-RuStore — ручной прод-тест в DoD); нет FCM как фундамента (grep); офлайн-сообщение доставляется при сети без дублей (`clientMessageId`); голос hold-lock-cancel; `typecheck` (RN).
**Тесты:** доступные RN unit + ручной reliability-gate.
**Закрывает:** R21, R22.

### Ф7 — Доводка.
**Цель.** Huddles, поиск, опросы, автоудаление, HR-подписки.
**Входит:** huddles (созвон из чата на LiveKit, Р7) → запись/резюме в чат; полнотекстовый поиск (GIN в `postgres-init.sql`); опросы (`Poll/PollOption/PollVote`→IdeaBlock `decision`); автоудаление по таймеру (`deleteAfter`, cron, **pre-ingest в граф ДО удаления**); HR-авто-подписки (`employee.hired/transferred/terminated`→`ConversationMember(source='auto')`); крутилки `message_retention_*`/`huddle_*`.
**Не входит:** E2EE/федерация/бот-платформа (vNext).
**Файлы:** `messaging/huddles`, `messaging/poll`, cron автоудаления, HR-listener; `postgres-init.sql` (GIN).
**Acceptance:** huddle из чата → запись+резюме в чат; поиск через GIN; автоудаление сначала ingest потом soft-delete (negative: блок в графе есть после удаления); HR-событие пересчитывает членство. Идемпотентность скриптов.
**Закрывает:** R23, R24, R25, R26.

---

## Требования (EARS, трассируемые)
- **R1** Когда сообщение приходит из подключённого внешнего мессенджера, система shall создать `RawEvent(sourceType='chat',kind='chat_message')` идемпотентно.
- **R2** Если `MESSAGE_BRIDGE_ENABLED=false`, then ingest-моста shall быть no-op.
- **R3** Когда пользователь шлёт сообщение с `clientMessageId`, система shall создать ровно одну `Message` при повторе (dedup).
- **R4** Система shall присваивать `Message.seq` монотонно per-conversation без дыр (не из timestamp).
- **R5** Когда сообщение записано, система shall в одной транзакции записать `Message` + `MessageOutbox`.
- **R6** Когда получатель офлайн, система shall слать во внешний канал ТОЛЬКО сигнал без тела и имён.
- **R7** Система shall хранить presence в Redis-TTL (переживает рестарт инстанса).
- **R8** `markRead` shall обновить `lastReadSeq`; `unreadCount = maxSeq − lastReadSeq`.
- **R9** Система shall поддерживать `Conversation.kind` dm|group|channel|ticket на одном ядре.
- **R10** Обязательный «канал на компанию» (`isMandatory`) shall запрещать выход (`MANDATORY_CHANNEL_LEAVE_FORBIDDEN`).
- **R11** Тикет shall храниться как `Conversation(kind='ticket')` + `SupportTicket`; переписка тикета — как `Message`.
- **R12** Когда клиент читает тикет, система shall возвращать только `Message(access='external')`.
- **R13** Закрытый контур, клон-черновик, critic, ночной куратор, SLA, CSAT поддержки shall работать на `Conversation/Message` (пересажены с `Issue/IssueComment`).
- **R14** Система shall не иметь рабочего Issue-based support-пути (старый код удалён/депрекейтнут).
- **R15** `GET /message-threads?type=all` shall возвращать `Conversation` всех kind одним списком с рабочим курсором; `InboxItem` ticket несёт `status/slaBreachedAt`, прочие — `null`.
- **R16** Фронт «Сообщения» shall обращаться только к `/message-threads`; UI shall использовать один `<MessageBubble>`.
- **R17** Когда сообщение в треде `feedsGraph=true` (вкл. dm) записано, система shall поставить `chat.ingest` через единый источник `Message`.
- **R18** Прямое чтение тела чужой переписки (где caller не член) shall быть запрещено, вкл. super_admin (в граф идут извлечённые знания).
- **R19** «Спросить Кору» shall возвращать ответ со ссылкой на конкретное сообщение; «Что пропустил» при N≥`chat_summary_min_messages` shall вернуть сводку.
- **R20** Когда встреча закрыта, система shall создать системное `Message` в связанный чат со ссылкой на запись и резюме.
- **R21** Фоновое мобильное приложение shall будиться пушем (APNs/RuStore), без FCM как фундамента.
- **R22** Отправленное офлайн сообщение shall доставляться при восстановлении сети без дублей.
- **R23** Автоудаление shall выполнять ingest в граф ДО soft-delete.
- **R24** HR-событие shall пересчитывать `ConversationMember(source='auto')`.
- **R25** Полнотекстовый поиск shall использовать GIN-индекс.
- **R26** Huddle из чата shall сохранять запись и резюме в тот же чат.

---

## Совместимость с prompt caching
- `chat-summary` («Что пропустил») и «Спросить Кору»: **стабильный SYSTEM** (роль, формат сводки, инструкция цитат `[MSG:id]`) без переменных; переменное (непрочитанные, период) — в КОНЦЕ user; few-shot меняется батчем. DeepSeek/OpenAI-proxy кэшируют 95-99%; правка SYSTEM ломает кэш. `feedback_llm_prompts_cache_friendly`. Промпты поддержки (`support-clone-draft/critic/edit-classify/curate`) при пересадке на `Message` сохраняют стабильный SYSTEM (тело тикета — в конце user).

## Pre-mortem / Риски (ревью-аспекты для strict-production-review-gate)
- **Слой корректности — load-bearing** (Ф1): seq/outbox/lastReadSeq/докачка/presence-в-Redis; «дешёвые 90%» = молчаливая потеря сообщений на DPI-троттле [2026-06-03 §8]. Главный аспект ревью.
- **Пересадка поддержки (Ф3) — самый рискованный кусок:** контур-изоляция (R-INV-1 поддержки), клон-черновик, гейт промоута в контур — переписать на `Message` БЕЗ потери инвариантов; CI-негатив-тест изоляции контура обязателен на `Message`. Грепнуть, что старый Issue-based путь действительно мёртв (нет двойной записи).
- **ФЗ-41:** тело во внешний канал = штраф; gate Ф1 + аудит легаси-событий.
- **Ненадёжные уведомления** — частая жалоба RU-конкурентов [01/02]; доставка/пуш — повышенное тестирование (Reliability-gate Ф6).
- **Приватность «всё в граф» (Р5):** граф кормится всей перепиской, прямое чтение тел member-scoped (R18); AI-чат не цитирует тело личной переписки не-членам дословно.
- **Self-improving (клон/«что пропустил»)** — без «человек одобри», только авто; human gate лишь kill-switch.

## Idempotency / feature-flag / prod-deploy
- **Флаги (Ship-On → `docs/operations/feature-flags.md`):** `CHAT_ENABLED` (kill-switch ON, Ф1), `MESSAGE_BRIDGE_ENABLED` (Ф0), `SUPPORT_DESK_ENABLED`/`SUPPORT_CURATOR_ENABLED` (сохраняются, Ф3), `CHAT_PUSH_ENABLED` (Ф6). Все ON при выкате.
- **Параметр владельца:** AdminSetting `support.vendor_org_id` + entitlement `feature.support_desk` (вендор-эксклюзив) — сохраняются.
- **Крутилки (AdminSetting):** `chat_unread_smart_badge`, `chat_notify_debounce_seconds`, `chat_summary_min_messages`, `chat_summary_idle_days`, `chat_presence_ttl_seconds`, `message_retention_days`, `push_debounce_seconds`, `huddle_max_participants`, `support_critic_min_groundedness`, `support_promote_min_csat` (последние два — из поддержки).
- **prod-deploy-log.md:** Шаг 1 (флаги), Шаг 4 (модели Conversation/ConversationMember/Message/MessageOutbox/SupportTicket/PushToken + enum ConversationKind; депрекейт неиспользуемых support-полей Issue/IssueComment), Шаг 5 (GIN по Message.contentStripped), Шаг 7 (seed-support-* перенастроены + seed-llm-task-routes-chat), Шаг 8 (backfill-chat-bridge-*), Шаг 12 (smoke: WS conversation.*, очереди message.outbox/chat.ingest, taskType chat-summary, Swagger /message-threads,/conversations,/support/tickets,/message-search). Все скрипты — `apply-prod-deploy.ts STEPS`, `createPrismaClient()`, импорты `../src`.

## DoD
typecheck (вкл `.spec`)/lint/build зелёные (front+back); vitest по новым/переписанным spec; миграции применяются и идемпотентны; second-brain обновлён (новый `messaging`→`module-map`; модели→`data-model`; очереди/cron→`workers-queues`+`ai-jobs`; эндпоинты→`api-layer`; страница «Сообщения»→`frontend-pages`; контекст/хук→`frontend-contexts-hooks`; новый `01_projects/unified-chat.md`; обновить `support-desk.md` — переезд на ядро; строка в `04_не-сделано` про отложенные E2EE/федерацию/Ф6-Ф7); `prod-deploy-log.md`; реестр флагов; prompt-методология для chat-summary; рефлексия после push.

## Итог
_(заполнит tz-orchestrator по факту реализации фаз.)_
