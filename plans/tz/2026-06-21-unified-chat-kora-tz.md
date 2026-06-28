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
- **E2EE приватных каналов, федерация серверов, бот-платформа (Bot API)** — vNext. _(Опросы — входят в Ф7 доводки; переписка с внешними клиентами — входит в Ф3.5, решение Р10; полноценный клиентский портал-кабинет — vNext.)_
- **`Issue` как МОДЕЛЬ задачи** (поля/доска/статусы/прогресс/чек-листы) — НЕ трогаем, остаётся в трекере. НО **переписка задачи (`IssueComment`) переезжает на общее ядро** как `Conversation(kind='work_chat')` (Ф2.5, решение Р9) — это и есть «рабочий чат из задачи» на едином экране. На общее ядро также переезжают тикеты поддержки.
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
| Р9 | **Чат задачи = `work_chat` на едином ядре.** Каждая задача лениво получает `Conversation(kind='work_chat')` (`Issue.conversationId @unique`); переписка `IssueComment` мигрирует в `Message`; заголовок чата = `PROJ-123 · <задача>`; рабочий чат виден в общем списке «Сообщения» и горит непрочитанным наравне с личкой/группами; двусторонняя навигация карточка↔переписка. `Issue` как модель задачи (поля/доска/статусы/прогресс) не трогаем | Цель ТЗ обещает «рабочие чаты из задач на одном экране» (стр. 34) и `work_chat` в `InboxItem` — без Ф2.5 обещание не выполнено; один склад сообщений (вариант A) распространяется и на чат задачи. Владелец 2026-06-28 |
| Р10 | **Внешняя переписка с клиентами на едином ядре.** Проактивный клиентский чат = `Conversation(kind='external')` (сотрудник пишет клиенту первым) + реактивная поддержка = `ticket` (Ф3); клиент входит по **magic-link БЕЗ пароля** с опц. лёгкой дорегистрацией (email/телефон+код: теневой → подтверждённый `User(kind='external_client')`); жёсткая граница — только своя переписка, только `external`-сообщения, закрытый контур | Владелец 2026-06-28: «клиенту тоже нравится новая чат-платформа, переписка с клиентами важна»; переиспользует support-контур (Ф3) + паттерн гостя встречи; дорегистрация даёт continuity при минимуме трения. Прежний vNext-пункт «коллаб для внешних контрагентов» снят |

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
**Входит:** Ф0 мост-загрузки; Ф1 единое ядро (`Conversation/ConversationMember/Message/MessageOutbox` + слой корректности + WS + presence-Redis + RBAC + шифрование + ФЗ-41 gate); Ф2 внутренний чат (личка/группы/каналы); Ф2.5 рабочий чат задачи (work_chat: связка Issue↔Conversation + миграция IssueComment→Message + двусторонняя навигация карточка↔переписка); Ф3 поддержка на ядре (`SupportTicket`-обёртка + пересадка контур/клон/critic/куратор/SLA/CSAT); Ф3.5 внешняя переписка с клиентами (`external` + magic-link-гость + лёгкая дорегистрация); Ф4 единый экран «Сообщения» (один список + контроллер + общий UI + поиск); Ф5 AI-крючки; Ф6 мобильное приложение; Ф7 доводка (huddles/опросы/автоудаление/HR-подписки).

**Не входит:** см. «Вне scope».

## Граничные контракты с другими ТЗ / подсистемами
- **`Issue` (трекер задач)** — модель задачи (поля/доска/статусы/прогресс) НЕ трогаем. На ядро переезжают: тикеты поддержки (Ф3) и **переписка задачи `IssueComment`→`Message` под `work_chat`-Conversation** (Ф2.5, `Issue.conversationId @unique`). Связь «задача из сообщения» (Ф5) по-прежнему создаёт обычный `Issue`-task через intake.
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
  work_chat /// чат задачи трекера = разговор + связь Issue.conversationId (Ф2.5)
  external  /// проактивный клиентский чат (сотрудник↔клиент-вне-компании), вход по magic-link (Ф3.5)
  ticket    /// обращение клиента = разговор + обёртка SupportTicket
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
  contentHtml     String?   @db.Text /// рендер-кэш rich-text (паритет с IssueComment, Ф2.5)
  contentStripped String?   @db.Text /// для поиска (GIN)
  parentMessageId String?   /// плоский reply (НЕ форум, Р4)
  clientMessageId String    /// идемпотентность отправки
  voiceUrl        String?
  voiceDuration   Int?
  voiceTranscript String?   @db.Text
  attachments     Json?
  mentions        String[]
  reactions       Json?     /// {"👍":["userId"]}
  thanksUserIds   String[]  @default([]) /// gamification «спасибо» (паритет IssueComment → Recognition-бридж, Ф2.5)
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
// --- work_chat: связка задачи трекера с ядром (Ф2.5) ---
// Issue.conversationId String? @unique — ленивая 1:1-связь задачи с её Conversation(kind='work_chat'); reverse-relation отдаёт задачу из чата.
// IssueComment → Message: переписка задачи мигрирует в Message под work_chat-Conversation (поля совпадают по «анатомии» REALITY-CHECK).
// IssueAttachment.messageId String? — перепривязать вложения (commentId → messageId), S3-пайплайн (25MB, MIME-whitelist) НЕ трогаем.
// IssueMention — userId упоминания едет в Message.mentions[]; @-уведомления перепривязать на messageId (сохранить by-whom для нотификаций).
// IssueProgressUpdate (прогресс/health задачи) — НЕ трогаем, это не переписка.
```

```prisma
// --- внешняя переписка с клиентами (Ф3.5) ---
model ConversationAccessLink { /// bearer-доступ внешнего клиента к ОДНОМУ разговору (magic-link)
  id              String    @id @default(cuid())
  token           String    @unique /// в ссылке; хранить хэш, отдавать сырое только при выдаче
  conversationId  String
  contactEmail    String?   @db.VarChar(320)
  contactPhone    String?
  createdByUserId String
  claimedByUserId String?   /// заполняется при дорегистрации (теневой → подтверждённый User)
  expiresAt       DateTime?
  revokedAt       DateTime?
  createdAt       DateTime  @default(now())
  conversation    Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  @@index([conversationId])
}
// User (существующая модель) — расширить: kind String @default("member") /// member|external_client; verified Boolean @default(false).
//   Теневой external_client создаётся при первом открытии magic-link; дорегистрация (email/телефон+код) → verified=true + уведомления.
// ConversationMember(role='client') ВСЕГДА указывает на User (теневой или подтверждённый) — членство единообразно (без отдельной guest-ветки).
// Conversation(kind='external') — проактивный клиентский чат; Message.access external/internal/normal как у ticket (клиент не видит internal).
```
> GIN полнотекста по `Message.contentStripped` — в `postgres-init.sql` (Шаг 5), НЕ в schema. `BigInt seq` — атомарный инкремент per-conversation в транзакции (НЕ `now()`).

### Единый list-DTO (Zod + Swagger), INV-A1
```ts
InboxItem = {
  kind: 'dm' | 'group' | 'channel' | 'ticket' | 'work_chat' | 'external',
  refId: string,                 // conversationId
  title: string,
  snippet: string,
  lastMessageAt: string,
  unreadCount: number,            // >0 → «горит» непрочитанным (вкл. work_chat задачи)
  // только-ticket: для прочих kind = null (INV-A1)
  status: string | null,
  slaBreachedAt: string | null,
  // только-work_chat: для прочих kind = null (Ф2.5) — дип-линк в карточку задачи
  linkedIssue: { id: string, identifier: string, title: string } | null,
}
```

### Единый контроллер (INV-A3)
```
GET  /api/v1/message-threads?type=all|dm|group|channel|work_chat|ticket|unread&sort=recent|active|unread&q=&cursor=
                                                                              → { items: InboxItem[], nextCursor }
     // q= — поиск ленты по людям/группам/задачам (title + имена участников + PROJ-NN); sort= — recent(свежее сверху, default)|active(больше сообщений)|unread(непрочитанные сверху)
POST /api/v1/message-threads/:conversationId/read  body:{ cursorSeq }          → 200
GET  /api/v1/conversations/:id/messages?sinceSeq=                              → { items: Message[], nextSeq }
POST /api/v1/conversations/:id/messages  body:{ content, clientMessageId, parentMessageId?, voice?, access? } → 201
POST /api/v1/conversations            body:{ kind, title?, memberUserIds[] }   → 201
POST /api/v1/conversations/:id/members body:{ userId }                         → 200
GET  /api/v1/message-search?q=&type=all                                        → { items: [{conversationId, messageId, snippet}] }
     // полнотекст по ТЕЛАМ сообщений (GIN), в отличие от q= в /message-threads (поиск по веткам/контактам)
// work_chat задачи (Ф2.5) — ленивое получение/создание чата задачи + обратная навигация:
GET  /api/v1/issues/:issueId/conversation                                      → { conversationId }  (создаёт work_chat при первом обращении, идемпотентно)
GET  /api/v1/conversations/:id/linked-issue                                    → { id, identifier, title } | 404
// тикеты-специфика (поверх той же Conversation):
POST /api/v1/support/tickets          body:{ subject, message } (клиент)       → 201 { conversationId }
POST /api/v1/conversations/:id/ticket/transition body:{ status }              → 200
POST /api/v1/conversations/:id/ticket/draft                                    → 202 (клон-черновик)
// внешняя переписка с клиентами (Ф3.5):
POST /api/v1/external-conversations   body:{ title?, clientContact:{email?|phone?}, message? } → 201 { conversationId, inviteLink }  (сотрудник начинает чат)
POST /api/v1/external/access          body:{ token }                          → 200 { sessionToken, conversationId }  (гость входит по magic-link)
POST /api/v1/external/register        body:{ token, email|phone, code }        → 200  (дорегистрация: теневой → verified)
GET  /api/v1/external/conversations/:id/messages?sinceSeq=   (guest-scope)     → { items, nextSeq }  (только access external/normal, НИКОГДА internal)
POST /api/v1/external/conversations/:id/messages  body:{ content, clientMessageId }  (guest-scope) → 201
// ошибки: CHAT_DISABLED(503), NOT_MEMBER(403), MANDATORY_CHANNEL_LEAVE_FORBIDDEN(409), SUPPORT_DESK_DISABLED(503), EXTERNAL_CHAT_DISABLED(503), ACCESS_LINK_EXPIRED(403), ACCESS_LINK_REVOKED(403), EXTERNAL_RATE_LIMITED(429)
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
- ✅ Always: tenant-scoping `@@index([tenantId,...])`; Zod-DTO+Swagger; `seq` атомарный per-conversation; идемпотентность `clientMessageId`; наружу только сигнал; super_admin не читает тела; `Message.access` проверять на КАЖДОМ чтении ленты клиентом (тикет и external); magic-link — хэш+TTL+отзыв, scope строго в один разговор; крутилки в AdminSetting.
- ⚠️ Ask first: трогать `Issue` как модель задач; общий retrieval chat-v2; открывать прямое чтение тел чужой переписки (граф — да, тела — member-scoped); новый ENV вместо AdminSetting.
- 🚫 Never: тело во внешний канал; отдавать внешнему участнику сообщения `access='internal'`; magic-link без TTL/отзыва/scope-в-один-разговор; пост-фильтрация доступа (только pre-filter по членству); `seq` от timestamp; прямой вызов фронтом разрозненных движков в обход `/message-threads` (INV-A3); `process.env.*` мимо env.schema; `prisma migrate dev` мимо файловых миграций; `new PrismaClient()` в скриптах; код ради кода.

---

## Фазы (dependency-ordered)

**Граф:** Ф0 ∥ Ф1 (независимы) → Ф2 ∥ Ф2.5 ∥ Ф3 (все на ядре Ф1) → Ф3.5 (на Ф3: контур/access) → Ф4 (нужны Ф2+Ф2.5+Ф3.5) → Ф5 → Ф6 → Ф7. Внутри фазы: Prisma → сервис → контроллер → фронт → e2e.

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

### Ф2.5 — Рабочий чат задачи (`work_chat`): связка `Issue`↔`Conversation` (двусторонняя навигация).
**Картография:** `Issue:9463`/`IssueComment:9719`/`IssueMention:9700`/`IssueAttachment:9949` (`schema.prisma`), `tracker.gateway.ts` `issue.chat.*` (presence/typing — переиспользуется через `conversation.*` Ф1), фронт карточки задачи (вкладка обсуждения), `IssueChat`/Recognition-бридж (`thanksUserIds`). Снять факт `run_pipeline`/Grep по `IssueComment`-писателям ДО старта (мест записи может быть несколько).
**Цель.** Каждая задача имеет ровно один `Conversation(kind='work_chat')` (ленивое создание); вся переписка задачи — `Message`; заголовок чата = `PROJ-123 · <заголовок задачи>`; из карточки открывается та же переписка, из общего списка «Сообщения» (work_chat) — дип-линк в карточку (журнал/файлы/прогресс); новое сообщение в задаче «горит» непрочитанным в общем списке как и личка/группа.
**Входит:** миграция — `ConversationKind.work_chat`; `Issue.conversationId String? @unique`; `IssueAttachment.messageId` (перепривязка `commentId→messageId`, S3-пайплайн не трогаем); перенос `IssueComment`→`Message` под work_chat-Conversation (`backfill-issuecomment-to-message-*.ts`, идемпотентно: маркер перенесённых, повтор=no-op); `IssueMention`-userId → `Message.mentions[]` + перепривязка @-уведомлений на `messageId`; `thanksUserIds` сохраняется (Recognition-бридж не переписываем); ленивое создание work_chat при первом сообщении/обращении (`GET /issues/:id/conversation`); членство work_chat = участники задачи (assignee + подписчики + упомянутые), далее через `ConversationMember`; обратная навигация `GET /conversations/:id/linked-issue`; `InboxItem.linkedIssue` (chip «PROJ-123» → карточка) + заголовок `PROJ-NN · …`; депрекейт старого `issue.chat.*`-пути записи в `IssueComment` (чтение легаси — до завершения backfill); `feedsGraph=true` (переписка задачи кормит граф как раньше — единый `Message`-источник Ф5, без двойного ingest).
**Не входит:** новый UI чата (переиспользуется `<MessageBubble>` Ф4); агрегатор/поиск/сортировка (Ф4); huddles из задачи (Ф7).
**Файлы:** миграция (`Issue.conversationId`, `IssueAttachment.messageId`, enum); `backend/src/modules/messaging/work-chat.service.ts` (ленивое создание + членство-из-задачи); правка `tracker` (карточка зовёт `conversation.*`, не `issue.chat.*`); `backfill-issuecomment-to-message-*.ts` (в `apply-prod-deploy.ts`, `createPrismaClient()`, импорты `../src`); фронт — вкладка «Обсуждение» карточки рендерит work_chat-Conversation, кнопка «к карточке» из ленты.
**Acceptance:** у задачи без чата `GET /issues/:id/conversation` создаёт ровно один `Conversation(kind='work_chat')` с `Issue.conversationId` (повтор=тот же id, не плодит); backfill переносит `IssueComment`→`Message` 1:1 без дублей (идемпотентно, маркер), вложения/упоминания/«спасибо»/voice сохранены; из карточки и из общего списка открывается ОДНА и та же переписка (`refId`=conversationId); `InboxItem(work_chat).linkedIssue` несёт `identifier`/title, заголовок `PROJ-NN · …`, прочие kind = `null` (INV-A1); непрочитанное по work_chat входит в общий badge; presence/typing работают через `conversation.*`; grep — нет новых записей в `IssueComment` (старый путь записи мёртв); `typecheck/lint/build` зелёные.
**Тесты:** `work-chat.spec.ts` (ленивое создание идемпотентно, членство-из-задачи, linked-issue навигация, unread в общем badge), `backfill-issuecomment-to-message.spec.ts` (1:1, идемпотентность, вложения/упоминания).
**Закрывает:** R27, R28, R29, R30, R31.

### Ф3 — Поддержка на едином ядре (пересадка, НЕ переписывание логики с нуля).
**Картография:** `backend/src/modules/support/*` (contour/clone/critic/edit-classify/curator/sla/learning, controllers), `chat-v2-retrieval.service.ts:~377` (pre-filter контура), модели `SupportSlaPolicy/IssueRating/SupportDraftOutcome/SupportCuratorAction`, `KnowledgeGroup(kind='support')`.
**Цель.** Тикет = `Conversation(kind='ticket')` + `SupportTicket`-обёртка; переписка тикета = `Message`; вся логика поддержки (контур/клон/critic/куратор/SLA/CSAT/обучение) пересажена с `Issue/IssueComment` на ядро.
**Входит:** миграция `SupportTicket` (Контракт-first) + перепривязка `SupportSlaPolicy/SupportDraftOutcome/SupportCuratorAction` на `conversationId/messageId`; CSAT на `conversationId`; приём обращения клиента `POST /support/tickets` создаёт `Conversation(kind='ticket')`+`SupportTicket` (вендор-Org) + первое `Message(access='external')`; ответ агента = `Message(access='external')`, заметка = `access='internal'`, черновик клона = `Message(authorType='clone', draftState='pending', access='internal')`; статусы (`status` на `SupportTicket`); назначение (через `ConversationMember role='agent'`); SLA-cron перепривязан; закрытый контур — блоки из `Message` тикета (pre-filter `contourGroupId` сохраняется); клон-черновик/critic/edit-classify/куратор работают на `Message`; **удалить/депрекейтнуть** старый Issue-based support-код и неиспользуемые support-поля `Issue/IssueComment` (опц. миграция, данных нет); seed Support (вендор-Org/контур-группа/LLM-маршруты) перенастроить на новые модели; флаги `SUPPORT_DESK_ENABLED`/`SUPPORT_CURATOR_ENABLED`, AdminSetting `support.vendor_org_id`, entitlement `feature.support_desk` сохраняются.
**Не входит:** единый экран (Ф4 — здесь backend+деск работают); авто-ответ клиенту (Ф5/owner-go отдельно); мобайл (Ф6).
**Файлы:** переписать `backend/src/modules/support/services/*` и controllers на ядро; миграция `SupportTicket`+перепривязки; правка `chat-v2-retrieval` (контур из Message); `seed-support-*`; фронт `support/desk` на общий `<MessageBubble>`.
**Acceptance:** `POST /support/tickets` от Org-A создаёт `Conversation(kind='ticket')`+`SupportTicket(customerOrgId='A')`+`Message(access='external')`; клиент видит ТОЛЬКО `access='external'` (negative: `internal` не в выдаче); черновик клона = `Message(authorType='clone',draftState='pending')` с цитатами из контура (reuse контур-isolation тест на Message); SLA-cron ставит `slaBreachedAt`; куратор soft-archive за debate-гейтом (как было); грепом — нет рабочих ссылок на старый Issue-based support-путь; `typecheck/lint/build` зелёные.
**Тесты:** `support-*.spec.ts` переписаны на ядро (contour-isolation на Message, clone-draft, critic, learning, sla, curator).
**Закрывает:** R11, R12, R13, R14.

### Ф3.5 — Внешняя переписка с клиентами (`external`) + лёгкий вход клиента (magic-link → дорегистрация).
**Картография:** Ф3 (`SupportTicket`, закрытый контур `support-contour.service.ts`, pre-filter `chat-v2-retrieval.service.ts:~377`, `Message.access`), ядро Ф1 (`Conversation/ConversationMember/Message`), паттерн гостя встречи (guest-токены LiveKit/`auth`), `auth` (сессии/JWT/cookie), `conversational.service.ts` `sendNotification` (email/SMS/telegram сигнал), `rbac`, `common/crypto`.
**Цель.** Клиент (внешний человек вне компании) переписывается с командой на той же платформе: сотрудник может начать чат с клиентом первым (продажи/онбординг/аккаунт) И клиент может написать сам (поддержка, Ф3); клиент входит по magic-link БЕЗ пароля, при желании — лёгкая дорегистрация (email/телефон+код) ради истории и уведомлений; клиент видит ТОЛЬКО свою переписку и только внешние сообщения, без графа/внутренних заметок/других клиентов.
**Входит:** `ConversationKind.external`; модель `ConversationAccessLink` (Контракт-first: token-хэш, conversationId, contact, expiresAt/revokedAt, claimedByUserId) — bearer-доступ к ОДНОМУ разговору; расширение `User` (`kind='external_client'`, `verified`) — теневой аккаунт при первом открытии ссылки, дорегистрация email/телефон+код → `verified=true` + уведомления; `ConversationMember(role='client')` всегда на `User` (единообразное членство); проактивный старт сотрудником (`POST /external-conversations` → `Conversation(kind='external')` + ссылка + сигнал-приглашение через `conversational`); guest-вход (`POST /external/access`) + guest-scope чтение/отправка (только `access` external/normal, НИКОГДА internal); анти-абьюз публичного входа (rate-limit, captcha для неаутентифицированных, report/block); ФЗ-152 (перс.данные клиента — уведомление/согласие); `feedsGraph=true` через закрытый контур (знание об отношениях с клиентом → память, тело member-scoped); kill-switch `EXTERNAL_CHAT_ENABLED`; крутилки `external_link_ttl_hours`, `external_inbound_rate_limit`.
**Не входит:** E2EE; полноценный клиентский портал-кабинet (vNext); федерация/бот-платформа; зеркало переписки клиента в WhatsApp/Telegram как ТРАНСПОРТ (отдельный owner-go — тело наружу, осторожно ФЗ-41).
**Файлы:** `backend/src/modules/messaging/external/*` (external-conversation.service, access-link.service, guest-auth.guard); миграция (`ConversationKind.external`, `ConversationAccessLink`, `User` external-поля); правка `auth` (guest-сессия по ссылке), `conversational` (шаблон приглашения); фронт `frontend/app/(public)/c/[token]/*` (веб-чат клиента) + экран дорегистрации; e2e.
**Acceptance:** сотрудник создаёт `external`-чат с контактом → ссылка → клиент открывает БЕЗ пароля и пишет (теневой `User` + `ConversationMember role='client'`); дорегистрация email/телефон+код → `verified=true`, та же история; клиент НЕ видит `access='internal'` (negative), не видит другие разговоры/граф/других клиентов (contour-isolation на `external`); просроченная/отозванная ссылка → 403; rate-limit на публичном входе → 429; чат виден сотруднику в Ф4 как `external`; `feedsGraph` идёт через контур; `typecheck/lint/build` зелёные.
**Тесты:** `external-conversation.spec.ts` (проактивный старт, membership, contour-isolation, internal-невидимость), `access-link.spec.ts` (magic-link, expire/revoke, claim/дорегистрация), `external-abuse.spec.ts` (rate-limit/block).
**Закрывает:** R35, R36, R37, R38, R39, R40.

### Ф4 — Единый экран «Сообщения» (агрегатор + общий UI).
**Картография:** ядро Ф1–Ф3, прототип (раскладка список/чат/контекст), `tailwind.config.ts` (парные токены).
**Цель.** Единая точка входа: один список — личка+группы+каналы+рабочие чаты задач+тикеты; видно все переписки в одном месте, новое сообщение (вкл. чат задачи) «горит» непрочитанным; клик по work_chat → переход в карточку задачи; слева — поиск/фильтр по людям/группам/задачам, сверху — сортировка ленты; общий компонент сообщения; доступ через единый контроллер. Раскладка — фундамент под мобильное приложение (Ф6).
**Входит:** `GET /message-threads` — один запрос по `Conversation` (+join `SupportTicket`, +join `Issue` для work_chat) с фильтром `type` (вкл. `work_chat`), **сортировкой `sort=recent|active|unread`** и **поиском ленты `q=`** (по людям/группам/задачам: title + имена участников + `PROJ-NN`), составной курсор `(сорт-ключ,id)` (INV-A1/A3); единый badge непрочитанного по ВСЕМ kind вкл. work_chat (Redis-кэш TTL) — «красный» индикатор новой переписки в задаче; `/message-search` (GIN по `Message.contentStripped`, полнотекст по телам); фронт раздел «Сообщения» (левая колонка: поиск+фильтр-табы «Всё·Личные·Работа·Задачи·Клиенты·Поддержка·Непрочитанное» + переключатель сортировки; центр: чат; правая контекст-панель) + общий `<MessageBubble sourceKind>` (INV-A2) + chip «PROJ-NN» в строке work_chat (дип-линк в карточку) + композер с переключателем «клиент/заметка» для тикета; **адаптивная одноколоночная раскладка-фундамент под Ф6** (список→чат→контекст как стек).
**Не входит:** AI-крючки (Ф5); нативное мобильное приложение и пуш (Ф6 — здесь десктоп отзывчивый + адаптив-фундамент).
**Файлы:** `messaging/inbox.controller`+inbox.service (один запрос, без фасада-провайдеров — один склад); `frontend/app/(authenticated)/messages/*`, `frontend/src/ui/messaging/MessageBubble.tsx`, `messaging.api.ts`, `domain/messaging.ts`.
**Acceptance:** `/message-threads?type=all` отдаёт `Conversation` всех kind (вкл. ticket, work_chat и external) одним списком; `sort=recent` — свежее сверху, `sort=active` — по числу сообщений, `sort=unread` — непрочитанные сверху; `q=` фильтрует по имени человека/группы/`PROJ-NN`; курсор через ≥2 страницы без дублей/пропусков на каждом `sort`; `InboxItem` ticket несёт `status/slaBreachedAt`, work_chat несёт `linkedIssue`, прочие — `null` (INV-A1 negative); клик по work_chat ведёт в карточку (`linkedIssue.id`); непрочитанное по задаче поднимает общий badge; `/message-search` ищет по одному складу `Message`; grep INV-A3 (фронт «Сообщения» зовёт только `/message-threads`); grep INV-A2 (один `<MessageBubble>`); `typecheck/lint/build` (front+back); UI русский; парные токены.
**Тесты:** `inbox.spec.ts` (один запрос, kind-фильтр вкл work_chat, sort-режимы, q-поиск, INV-A1 null), `message-search.spec.ts`; front `test:unit` (MessageBubble chat+ticket+work_chat).
**Закрывает:** R15, R16 (INV-A1/A2/A3), R32, R33.

### Ф5 — AI-крючки (дифференциатор).
**Картография:** `ingest`/`conversational-ingest.adapter` (Ф0), chat-v2 retrieval, `llm-router.service.ts`, intake-воркер, Meeting-закрытие, ASR.
**Цель.** Чат кормит граф; «Спросить Кору/Что решили»; «Что пропустил»; сообщение→задача/решение; расшифровка голосовых; авто-сообщение в чат при закрытии встречи.
**Входит:** `chat.ingest` для всех `feedsGraph=true` тредов (вкл. dm — Р5; один источник `Message`, без разветвления); taskType `chat-summary` (стабильный SYSTEM, переменное в конце user); «Спросить Кору» поверх chat-v2 со ссылкой на `Message.id`; сообщение→задача (intake-источник `chat`, создаёт `Issue`-task) и →решение (реестр решений); расшифровка голосовых (`voiceTranscript` ASR); системное `Message(authorType='system')` в связанный чат при закрытии встречи; крутилки `chat_summary_min_messages`/`chat_summary_idle_days` (AdminSetting); `seed-llm-task-routes-chat.ts` (chat-summary→DeepSeek V4 Pro).
**Не входит:** мобайл (Ф6); huddles (Ф7); авто-ответ клиенту поддержки (отдельный owner-go).
**Файлы:** `messaging` (ingest-adapter, summary-service, message-actions), `seed-llm-task-routes-chat.ts`, `chat-summary.prompt.ts`; правка intake, Meeting-закрытие.
**Acceptance:** сообщение в любом `feedsGraph` треде (вкл. dm) → `chat.ingest`→`IdeaBlock` (один путь, grep — нет двух адаптеров); приватность (тело чужой переписки не отдаётся прямым чтением, super_admin тоже — R-priv); «Что пропустил» при N≥порога → сводка с переходами; «Спросить Кору» → ссылка на `Message.id`; сообщение→задача создаёт `Issue` с `EntityLink` на автора; голосовое → `voiceTranscript`; закрытие встречи → системное `Message`; раздел prompt caching соблюдён.
**Тесты:** `chat-ingest.spec.ts`, `chat-summary.spec.ts`, `message-to-task.spec.ts`, `privacy-body-scope.spec.ts`.
**Закрывает:** R17, R18, R19, R20.

### Ф6 — Мобильное приложение (сквозное Р8) — публикация в App Store + Google Play + RuStore.
**Картография:** `kora-mobile` (RN, «не начато» по 2026-06-03), `06-mobile-ux.md`, пуш (VAPID есть, нативного нет).
**Цель.** Единый чат удобен на телефоне; нативный пуш; приложение готово к публикации в App Store, Google Play и RuStore на ОДНОМ фундаменте (API-first ядро Ф1 + транспорт-агностичный пуш), без архитектурной переделки под каждый магазин.
**Входит:** одноколоночный поток (список→чат→контекст-шторка снизу) — переиспользует адаптив-фундамент Ф4; нижняя навигация (Сообщения·Поддержка·AI/Кора·Я; «Поддержка» по RBAC); композер с голосом hold→swipe-up-lock→swipe-left-cancel + выбор «голос/расшифровка»; **`PushService` (зеркало llm-router) — транспорт-агностичный**: `APNs`(iOS/App Store) · `FCM`(Android/Google Play global — ОДИН из транспортов, НЕ фундамент Р8) · `RuStore`(Android/RU) · `VAPID`(web); выбор транспорта по сборке/`PushToken{platform,transport,token}` — ядро работает при любом, отсутствие любого одного не «выключает» доставку; офлайн-очередь+докачка `sinceSeq`; деск на мобиле — переключатель «клиент/заметка» с цветом фона; collision-detection; умный бейдж; утренняя пуш-сводка; **store-compliance ядро**: privacy policy + Apple privacy-nutrition / Google Data-safety формы (что собираем: переписка→память компании — Р5), **удаление аккаунта из приложения** (Apple App Review Guideline 5.1.1(v) / Play Account Deletion — обязательно для соцфич), **жалоба на контент/блокировка пользователя** (App Store 1.2 UGC / Play UGC — обязательны для приложений с перепиской), возрастной рейтинг, корректные разрешения (микрофон для голосовых — usage-string).
**Не входит:** huddles (Ф7).
**Файлы:** `kora-mobile/*`; backend `PushService`+`PushToken` миграция+регистрация (+транспорт `fcm`); endpoint удаления аккаунта + жалобы/блокировки; крутилки `push_debounce_seconds`/`unread_smart_badge`.
**Acceptance:** Reliability-gate (фон будится пушем ≤N сек на iOS-APNs, Android-FCM (Play) и Android-RuStore — ручной прод-тест в DoD); FCM присутствует как ТРАНСПОРТ, но не как единственная опора (grep: ядро доставки не падает при выключенном FCM); офлайн-сообщение доставляется при сети без дублей (`clientMessageId`); голос hold-lock-cancel; экраны «удалить аккаунт» и «пожаловаться/заблокировать» доступны из приложения (gate App Review/Play); `typecheck` (RN).
**Тесты:** доступные RN unit + ручной reliability-gate + чек-лист store-compliance (удаление аккаунта, UGC-модерация, privacy-формы).
**Закрывает:** R21, R22, R34.

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
- **R27** Каждая задача shall иметь не более одного `Conversation(kind='work_chat')` (`Issue.conversationId @unique`); повторный запрос — тот же чат (без дублей).
- **R28** Переписка задачи (`IssueComment`) shall быть перенесена в `Message` под work_chat-Conversation идемпотентно (повтор backfill = no-op), с сохранением вложений, упоминаний, «спасибо» и голосовых.
- **R29** Из карточки задачи и из общего списка «Сообщения» shall открываться одна и та же переписка (один `conversationId`); `InboxItem` work_chat shall нести `linkedIssue{identifier,title}` и заголовок `PROJ-NN · …` для дип-линка в карточку.
- **R30** Непрочитанное по work_chat задачи shall входить в единый badge непрочитанного наравне с личкой/группами.
- **R31** Система shall не писать новые сообщения в legacy-`IssueComment` после Ф2.5 (старый `issue.chat.*`-путь записи депрекейтнут).
- **R32** `GET /message-threads` shall поддерживать `sort=recent|active|unread` с корректным курсором (без дублей/пропусков) на каждом режиме.
- **R33** `GET /message-threads?q=` shall фильтровать ленту по людям/группам/задачам (title + имена участников + `PROJ-NN`); полнотекст по телам остаётся на `/message-search`.
- **R34** Мобильное приложение shall публиковаться в App Store, Google Play и RuStore на одном фундаменте: `PushService` транспорт-агностичен (APNs/FCM/RuStore/VAPID, FCM — не единственная опора); из приложения доступны удаление аккаунта и жалоба/блокировка пользователя (gate App Review / Play UGC).
- **R35** Сотрудник shall создавать `Conversation(kind='external')` с внешним клиентом и приглашать его ссылкой; клиент shall писать сам через поддержку (`ticket`, Ф3) — оба на едином ядре.
- **R36** Клиент shall входить в свой разговор по magic-link БЕЗ пароля; `ConversationAccessLink` — bearer-доступ к одному разговору, с `expiresAt`/`revokedAt` (просрочка/отзыв → 403).
- **R37** Клиент shall иметь возможность лёгкой дорегистрации (email/телефон + код) → `User(kind='external_client').verified=true`, та же история и уведомления; до этого — теневой аккаунт.
- **R38** Внешний участник shall видеть ТОЛЬКО свою переписку и только сообщения `access` external/normal — НИКОГДА `internal`, граф, другие разговоры или данные других клиентов (закрытый контур).
- **R39** Публичный вход внешней переписки shall иметь анти-абьюз (rate-limit → 429, captcha для неаутентифицированных, report/block).
- **R40** Внешняя переписка shall кормить граф через закрытый контур (тела member-scoped; наружу — только сигнал, ФЗ-41/152).

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
- **Миграция чата задачи (Ф2.5):** `IssueComment`→`Message` идемпотентно с маркером; не потерять вложения/упоминания/«спасибо»/voice; нельзя плодить >1 work_chat на задачу (`Issue.conversationId @unique`); CI-grep — нет новой записи в `IssueComment`; двойной ingest исключить (единый `Message`-источник Ф5).
- **Store-readiness (Ф6):** App Store/Google Play отклоняют соцприложения без удаления аккаунта из приложения и UGC-модерации (жалоба/блокировка) — закладывать с старта, не «потом»; FCM-транспорт нужен для Play global, но ядро доставки не должно от него зависеть (Р8: один из транспортов, не фундамент).
- **Внешний публичный вход (Ф3.5) — поверхность атаки:** magic-link = bearer-доступ → хранить хэш токена, короткий TTL, отзыв, scope строго в ОДИН разговор; обязательны rate-limit/captcha/abuse-report на неаутентифицированном входе; negative-тест «клиент не видит `internal`/граф/другие разговоры» — обязателен (утечка тела клиенту = инцидент + ФЗ-152). Contour-isolation тест переиспользовать на `external`, не только `ticket`.

## Idempotency / feature-flag / prod-deploy
- **Флаги (Ship-On → `docs/operations/feature-flags.md`):** `CHAT_ENABLED` (kill-switch ON, Ф1), `MESSAGE_BRIDGE_ENABLED` (Ф0), `SUPPORT_DESK_ENABLED`/`SUPPORT_CURATOR_ENABLED` (сохраняются, Ф3), `EXTERNAL_CHAT_ENABLED` (kill-switch ON, Ф3.5), `CHAT_PUSH_ENABLED` (Ф6). Все ON при выкате.
- **Параметр владельца:** AdminSetting `support.vendor_org_id` + entitlement `feature.support_desk` (вендор-эксклюзив) — сохраняются.
- **Крутилки (AdminSetting):** `chat_unread_smart_badge`, `chat_notify_debounce_seconds`, `chat_summary_min_messages`, `chat_summary_idle_days`, `chat_presence_ttl_seconds`, `message_retention_days`, `push_debounce_seconds`, `huddle_max_participants`, `support_critic_min_groundedness`, `support_promote_min_csat` (последние два — из поддержки), `external_link_ttl_hours`, `external_inbound_rate_limit` (Ф3.5).
- **prod-deploy-log.md:** Шаг 1 (флаги), Шаг 4 (модели Conversation/ConversationMember/Message/MessageOutbox/SupportTicket/PushToken + enum ConversationKind вкл. `work_chat` и `external`; `Issue.conversationId @unique` + `IssueAttachment.messageId` + `Message.contentHtml/thanksUserIds` (Ф2.5); `ConversationAccessLink` + `User.kind/verified` (Ф3.5); транспорт `fcm` в PushToken (Ф6); депрекейт неиспользуемых support-полей Issue/IssueComment), Шаг 5 (GIN по Message.contentStripped), Шаг 7 (seed-support-* перенастроены + seed-llm-task-routes-chat), Шаг 8 (backfill-chat-bridge-*, **backfill-issuecomment-to-message-*** Ф2.5 — идемпотентно, маркер), Шаг 12 (smoke: WS conversation.*, очереди message.outbox/chat.ingest, taskType chat-summary, Swagger /message-threads(+sort,q),/conversations,/issues/:id/conversation,/conversations/:id/linked-issue,/support/tickets,/external-conversations,/external/access,/external/register,/message-search). Все скрипты — `apply-prod-deploy.ts STEPS`, `createPrismaClient()`, импорты `../src`.

## DoD
typecheck (вкл `.spec`)/lint/build зелёные (front+back); vitest по новым/переписанным spec; миграции применяются и идемпотентны; second-brain обновлён (новый `messaging`→`module-map`; модели→`data-model`; очереди/cron→`workers-queues`+`ai-jobs`; эндпоинты→`api-layer`; страница «Сообщения»→`frontend-pages`; контекст/хук→`frontend-contexts-hooks`; новый `01_projects/unified-chat.md` (вкл. раздел внешней переписки Ф3.5); обновить `support-desk.md` — переезд на ядро + внешний `external`-чат рядом с тикетами; **обновить `tracker.md` + `03_processes/issue-lifecycle.md` — чат задачи переехал на `work_chat`/`Message`, `IssueComment` депрекейтнут**; строка в `04_не-сделано` про отложенные E2EE/федерацию/Ф6-Ф7 + store-compliance чек-лист Ф6); `prod-deploy-log.md`; реестр флагов; prompt-методология для chat-summary; рефлексия после push.

## Итог
_Заполняется tz-orchestrator по факту реализации фаз (ветка `feat/unified-chat-kora`, коммиты по фазам, push по подтверждению владельца)._

| Фаза | Статус | Закрывает | Примечание |
|---|---|---|---|
| Ф0 — Мост-загрузки | ✅ DONE | R1, R2 | Модуль `message-bridge` (`Source(type='chat')` + `ingestChatMessage` + Telegram-export-загрузчик + backfill), ветка `chat_message` в `segment-builder`, флаг `MESSAGE_BRIDGE_ENABLED`. Bitrix prod-путь оставлен на session-transcript (без двойного ingest) — R1 для Bitrix доказан unit-тестом через мост. typecheck/lint/build/vitest зелёные (42/42). |
| Ф1 — Единое ядро | ✅ DONE | R3–R8 | Ф1a: миграция `unified_chat_core`, `MessageService` (row-lock→gap-free seq, outbox в транзакции, dedup clientMessageId, AES-256-GCM at-rest), read-cursor, RBAC conversation/message, `CHAT_ENABLED`. Ф1b: `@socket.io/redis-adapter` + `RedisIoAdapter`, WS `conversation.*` + presence-Redis (TTL, переживает рестарт), outbox-relay воркер (BullMQ + `@Cron` sweep `FOR UPDATE SKIP LOCKED`, идемпотентно), офлайн-сигнал без тела/имён + `assertNoExternalBody` (ФЗ-41 gate). typecheck/lint/build зелёные, vitest 309 (messaging+tracker+conversational без регрессий). Контроллеры — Ф2/Ф4. Cross-instance broadcast подтверждён статически (типы+NestJS-паттерн), рантайм-smoke на проде. |
| Ф2 — Внутренний чат | ✅ DONE (backend) | R9, R10 | `ConversationController` (`/conversations` create dm/group/channel, members, leave-mandatory→409, send/list/read, реакции, company-channel) + Zod-DTO + enforcement членства (`NOT_MEMBER` 403 — закрывает carry-forward Ф1 про super_admin/не-член). `toggleReaction` (FOR UPDATE), `ensureCompanyChannel` (идемпотентно). **Hardening:** `assertUsersInTenant` — участник обязан принадлежать org (cross-tenant gap закрыт). vitest 55, typecheck/lint/build зелёные. FE data-слой + визуальный экран — в Ф4 (строю UI один раз). |
| Ф2.5 — work_chat | ✅ DONE | R27, R28, R31 (R29/R30 рендер в Ф4) | Ф2.5a: миграция `work_chat_link`, `WorkChatService` (ensureWorkChat идемпотентно, appendMessage делегирует sendMessage, getLinkedIssue), comments.service create/findByIssue на Message+legacy-merge, эндпоинты `/issues/:id/conversation`, `/conversations/:id/linked-issue`. Ф2.5b: `insertHistorical`/`editMessage`/`softDeleteMessage` (DRY через `insertMessageRow`), redirect update/softDelete + pending-actions + 3 import-стратегии, backfill `IssueComment→Message` (идемпотентно, маркер messageId + clientMessageId `ic:<id>`, re-point attachments/Recognition, сохраняет mentions/thanks/voice/draftState). **Dry-run проверен на live-БД (5 задач/12 коммент.).** support не тронут (Ф3), demo-seed legacy (read мержит). vitest 699, typecheck/lint/build зелёные. |
| Ф3 — Поддержка на ядре | ✅ DONE | R11–R14 | Ф3a: миграция `support_ticket` (SupportTicket-обёртка + перепривязки SupportDraftOutcome→conversationId/draftMessageId, IssueRating→conversationId), intake/desk/sla на Conversation/Message, `appendTicketMessage`, **клиент видит ТОЛЬКО external (изоляция)**. Ф3b: clone-черновик/critic/learning/curator на Message+SupportDraftOutcome(conversationId), `maybePromote` через Conversation.title, чистка — **0 Issue-пути в support** (CI-grep `no-issue-path.guard.spec`), seed-support-project=SLA only. vitest 142, typecheck/lint/build зелёные. Контур-изоляция (IdeaBlock) не тронута. **⚠ Найдено: relay эмитит `message.new` с телом в room независимо от access — в тикете не утечка (клиент не член), но Ф3.5 ОБЯЗАН добавить фильтр access для client-членов.** Frontend desk на `<MessageBubble>` — Ф4. |
| Ф3.5 — Внешняя переписка | ✅ DONE | R35–R40 | Ф3.5a: `ConversationAccessLink` (sha256-хэш токена, TTL/revoke/claim), `User.kind/verified`, AccessLink/ExternalConversation сервисы, guest-JWT scoped в conversationId, **relay-access фикс (internal→staff-room, не клиенту)**, флаг `EXTERNAL_CHAT_ENABLED`. Ф3.5b: guest-эндпоинты `/external/access|register|messages` (guest читает ТОЛЬКО external/normal — тест-негатив), OTP-дорегистрация (ФЗ-152 согласие), rate-limit→429, report/block. Ф3.5c: публичная FE `/c/[token]` (вход→лента→композер→дорегистрация, мобильно). vitest back 106 + front 6, typecheck/lint/build зелёные. **Отложено (owner-gated):** captcha — нет инфры/провайдера → `04_не-сделано`. |
| Ф4 — Единый экран | ✅ DONE | R15, R16, R32, R33 (+рендер R29/R30) | **Ф4b (фронт):** экран `/messages` (3 колонки список/чат/контекст, мобильный стек — фундамент Ф6), один `<MessageBubble>` (INV-A2), WS realtime (`conversation.*`+`message.new`+presence), FE data-слой (messaging.api/domain/hooks `useMessageThreads`/`useConversationMessages`/`useUnreadMessageCount`), табы-фильтры+сортировка, чип PROJ-NN дип-линк, композер клиент/заметка для ticket, nav-пункт+badge, кнопка «Открыть в Сообщениях» из карточки задачи (Ф2.5). INV-A3 (только message-threads/conversations/search). typecheck/lint/build/vitest(10) зелёные. _Отложено: members-эндпоинт (имена участников), message-search UI-поле, голос-запись (Ф6)._ **Ф4a (backend агрегатор):** `InboxController` (INV-A3, единый контроллер ленты) + `InboxService` — `GET /message-threads` (один запрос по `Conversation` члена, фильтр `type=all|dm|group|channel|work_chat|external|ticket|unread`, `sort=recent|active|unread`, `q=` по title/имени участника/PROJ-NN, составной base64url-курсор `{k:сорт-ключ,id}`, лимит 30), `GET /message-threads/unread-count` (Redis-кэш TTL 15с, сумма unread по всем kind), `GET /message-search` (полнотекст GIN `to_tsvector('russian',contentStripped) @@ plainto_tsquery`, scope члена, исключает deleted). INV-A1: ticket несёт `status/slaBreachedAt`, work_chat — `linkedIssue` (через `Issue.findMany`, у Conversation нет reverse-relation), прочие — `null`. `contentStripped` заполняется на записи (`stripToPlain` в `insertMessageRow`) + опц. backfill `backfill-message-contentstripped.ts`. GIN в `postgres-init.sql`. `POST /message-threads/:id/read` — уже был в Ф2 (не дублировано). vitest 125 (messaging, +19 новых), typecheck/lint/build зелёные. FE экран «Сообщения» + `<MessageBubble>` — Ф4b. |
| Ф5 — AI-крючки | 🟢 DONE (Ф5a + Ф5b) | R17, R18, R19, R20 | **Ф5b (AI-крючки backend, 2026-06-28):** taskType `chat-summary` (стабильный SYSTEM, переменное в конце user — prompt caching; `messaging/prompts/chat-summary.prompt.ts`) + `seed-llm-task-routes-chat.ts` (primary deepseek-v4-flash, в STEPS `phase:'seed-llm-routes'`). «Что пропустил» — `ChatSummaryService.summarizeUnread` (`GET /conversations/:id/whats-new`): `Message` с `seq>lastReadSeq` без system/deleted, `count<chat_summary_min_messages` → `{skipped:'too_few'}`, иначе `llm.call('chat-summary')` → сводка с `[MSG:<id>]`. «Спросить Кору» — `AskKoraService.ask` (`POST /conversations/:id/ask`) поверх `ChatV2OrchestrationService.askEphemeral(scope='org')`; `sourceMessageIds` = маппинг `usedBlockIds`→`IdeaBlockEvidence`→`RawEvent.sourceExternalId LIKE 'msg:%'` (best-effort) (R19); `CHAT_V2_ENABLED` off → 503. Сообщение→задача/решение — `MessageActionsService` (`POST …/to-task` → intake `source='chat'` provenance `externalId='msg:<id>'`; `POST …/to-decision` → `Decision(status='proposed')` provenance в `previewSourceRef`). `MessagingModule` += `ChatV2Module` + `forwardRef(TrackerModule)`; `IntakeSourceSchema` += `'chat'`; крутилки `chat_summary_min_messages`(5)/`chat_summary_idle_days`(3) в registry + сид. vitest 168 (messaging), typecheck/lint(0 err)/build зелёные. **Ф5a (AI-крючки backend):** `chat.ingest` — после `relay` (доставка) сообщение в `feedsGraph=true`-треде (вкл. dm — Р5, кроме `authorType='system'`) → `ChatIngestQueueService.enqueue` → `ChatIngestWorker` → `ChatIngestService.ingestMessage` → `IngestService.ingest(kind='chat_message', sourceExternalId='msg:<id>', dataClass='internal')` под `Source(type='chat', name='Сообщения Коры')` → IdeaBlock (R17, один источник `Message`, без двойного ingest; внешний мост Ф0 — отдельный путь). Голос: `MessageService.sendMessage` на `voiceUrl` → `voice.transcribe` → `VoiceTranscribeWorker` (S3→Vox ASR) → `Message.voiceTranscript` + пере-enqueue `chat.ingest` (text = `decrypt(content) || voiceTranscript`). Закрытие встречи (`MeetingsService.transitionStatus → ai_ready/ai_failed`) → системное `Message(authorType='system')` в work_chat связанных задач (`Issue.linkedMeetingIds has meetingId`), идемпотентно `clientMessageId='meeting-closed:<id>'`, best-effort try/catch (не ломает FSM) (R20). R18: chat-ingest пишет только в pipeline, не создаёт путь чтения тел не-членами. kill-switch `CHAT_INGEST_ENABLED`. Новые: `messaging/queue/{chat-ingest,voice-transcribe}.{queue,queue.service,worker}.ts` + `services/chat-ingest.service.ts` + `MessageService.appendSystemMessage`. vitest 48 (новые+правка outbox/message/meetings specs), typecheck/lint/build зелёные. (Ф5b закрыл «Спросить Кору» / сообщение→задача·решение / `chat-summary` — см. блок Ф5b выше.) |
| Ф6 — Мобильное приложение | ⬜ | R21, R22, R34 | |
| Ф7 — Доводка | ⬜ | R23–R26 | |
