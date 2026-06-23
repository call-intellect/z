Достаточно данных для полного анализа. Формирую итоговый markdown.

# Сведение движков в коде Z

## 0. Что есть в коде сейчас (факты)

- **Тикет = `Issue`.** Деск поддержки целиком построен на трекерных моделях: `Issue` (с support-полями `supportCustomerUserId/OrgId/Contact`, `externalSource='support_widget'`, `firstResponseDueAt/resolutionDueAt/slaBreachedAt/firstRespondedAt`) + `IssueComment` как форма сообщения. Фильтр «это тикет» = `supportCustomerUserId != null` (`support-desk.service.ts:90-94`, `support-intake.service.ts:129-148`).
- **Моделей `Conversation` / `Message` (peer-to-peer личка/группы) НЕТ.** Grep `model (Conversation|Message)` по `schema.prisma` — пусто. Есть только: `MeetingRoomMessage` (чат внутри LiveKit-комнаты, `schema.prisma:2002`), `ConciergeMessage/ConciergeConversation` (диалог с AI-ассистентом, `:8697`/`:8723`), `IssueComment` (`:9440`). Ядро внутреннего мессенджера придётся **создавать с нуля**.
- **`tracker.gateway.ts` СУЩЕСТВУЕТ** — это полноценный WebSocket-транспорт на socket.io (`backend/src/modules/tracker/gateways/tracker.gateway.ts:32`), namespace `/ws/tracker`, с auth по `z_session`-cookie/JWT (`:302-370`), tenant/project/issue-rooms и уже реализованным **чат-presence** (`issue.chat.join/leave/typing/presence` — `:166-245`, события `presence:user_joined/left/typing`).

---

## 1. Что уже переиспользуемо для внутреннего чата

| Кирпич | Где (file:line) | Готовность |
|---|---|---|
| **Форма сообщения** (тело + тред + голос + провенанс) | `schema.prisma:9440` `IssueComment` — поля `parentCommentId` (тред, `:9444`), `content/contentHtml/contentStripped` (`:9446-9448`), `access` internal/external (`:9450`), `authorType` human/clone/system (`:9453`), `voiceUrl/voiceDuration/voiceTranscript` (`:9459-9461`), `thanksUserIds` (`:9464`), `attachments/mentions` (`:9473-9474`) | Готовая «анатомия сообщения» — модель `Message` можно лепить по образу `IssueComment` |
| **WebSocket-транспорт** | `tracker.gateway.ts:32` — auth `:302`, rooms `:247-261`, presence/typing `:166-245`, `emitToRooms` `:293` | Транспорт + presence уже есть; для чата нужен лишь новый room-namespace (`conversation:<id>`) и обработчики `message.new`. **Полностью переиспользуемо** |
| **Мультиканальная доставка** | `conversational.service.ts:116` `sendNotification` + `EVENT_TYPE_CHANNEL_POLICY` (`:60-84`) + адаптеры in_app/email_smtp/telegram_bot/max_bot. dataClass-gate `:806-825`, бюджет `:184-199`, quiet-hours `:849` | Готов для **outbound-уведомлений** о новых сообщениях («вам написали»), не для самой ленты |
| **Echo ответа в исходный канал** | `conversational.service.ts:229` `sendChatReply` + `resolveOriginChannelKinds` `:281` (`originChannelBindingId` → отвечаем в тот же Telegram/MAX) | Готовый механизм «ответил в кабинете → ушло в Telegram». Ключ для Варианта B |
| **chat → граф (ingest)** | `ingest.service.ts:40` `ingest()` → `RawEvent` → `coreQueue.enqueueRawReceived` `:148`. Адаптер `conversational-ingest.adapter.ts:19` `ingestFreeNote` (`kind:'free_note'`). Разбор в `segment-builder.service.ts:102,200` (`p.kind === 'free_note'` → IdeaBlock). `SourceType.chat` уже в enum (`schema.prisma:253`) | Канал «сообщение → RawEvent → IdeaBlock» проложен. Сообщения чата лягут тем же путём (новый `kind:'chat_message'` в адаптере + ветка в segment-builder) |
| **Идемпотентность** | (a) `RawEvent.idempotencyKey` = sha256(sourceId:extId:occurredAt) (`ingest.service.ts:89-104`, P2002-race `:167`); (b) `MeetingRoomMessage.clientMessageId @unique` (`schema.prisma:2011`) — образец dedup сообщений с клиента (двойная отправка/reconnect) | Оба паттерна готовы; `clientMessageId @unique` — прямой эталон для `Message` |
| **AI-черновик клона** | `support-clone.service.ts:52` `generateDraft` → `IssueComment{authorType:'clone',draftState:'pending',cloneConfidence,groundednessScore}` (`:196-208`) | Специфика поддержки, в общий чат не нужен |
| **Закрытый контур (pre-filter)** | `support-contour.service.ts:173` `createContourBlock` (`IdeaBlockAccess.via='closed'` `:222`); pre-filter в ретриве `chat-v2-retrieval.service.ts:377-379` (`blockAccess.some.groupId` ДО ранжирования) + 1-hop-граф-сосед `:946-948` (R-INV-1) | Специфика поддержки (изоляция знаний вендора) |

---

## 2. Общее vs различное: support-на-Issue ↔ messenger-на-Conversation

**Общее (выносить в shared, не дублировать):**
- **Тело сообщения** — `content/contentStripped/voice*/attachments/mentions/parentCommentId`. Сегодня живёт в `IssueComment` (`schema.prisma:9446-9474`). Это и есть будущий общий `Message`.
- **Лента-композер на фронте** — пузыри сообщений, тред, голосовой ввод, «спасибо», typing-индикатор. Один React-компонент ленты + композера работает и над `IssueComment` (тикет), и над `Message` (диалог).
- **Транспорт реального времени** — `tracker.gateway.ts` уже обслуживает чат внутри Issue (`:166-245`); тот же gateway отдаёт события для диалогов.
- **Outbound-нотификация о новом сообщении** — `conversational.service.ts:116` для обоих.

**Различается (специфика, держать в support-слое):**
- **SLA** — `firstResponseDueAt/resolutionDueAt/slaBreachedAt` на `Issue` + `support-sla.service.ts`/`support-sla.cron.ts`. У личного/группового чата SLA нет.
- **Статусы/очередь/назначение** — `IssueState` (FSM new→…→completed), `IssueAssignee`, views `unassigned/mine/closed/spam` (`support-desk.service.ts:95-104`). У мессенджера нет «статуса» и «исполнителя».
- **Клон-черновик** — `support-clone.service.ts` + critic + calibration. Только поддержка.
- **Закрытый контур знаний** — `support-contour.service.ts` + `contourGroupId` pre-filter (`chat-v2-retrieval.service.ts:377`). Только поддержка.
- **`authorType='clone'`/`draftState`/`cloneConfidence`** на `IssueComment` (`schema.prisma:9453-9456`) — support-only поля; в `Message` их не тащить.

**Граница (рекомендация):** общий слой — `Message` (тело) + лента/композер (UI) + WS-room + ingest-в-граф + outbound-нотификация. Support оставляем **обёрткой**: `Issue` остаётся «контейнером тикета» (SLA/статус/очередь/контур/клон), а его переписка живёт там же, где и сейчас (`IssueComment`), пока не выполнена миграция п.4. Не объединять `IssueComment` и `Message` на этом шаге — это разные жизненные циклы; объединяем позже через общий интерфейс.

---

## 3. Единый list-DTO ленты «Сообщения»: тикеты (`Issue`) + диалоги (`Conversation`)

Сегодня два независимых list-метода, оба возвращают курсор-DTO:
- тикеты — `support-desk.service.ts:85` `listTickets` (`orderBy updatedAt desc`, `nextCursor` пока всегда `null` `:135`) и `support-intake.service.ts:184` `listMyTickets`;
- диалогов как сущности нет (моделей нет).

| Вариант | Как | Плюсы | Минусы (под стек Z) |
|---|---|---|---|
| **A. Union на лету** (два запроса `Issue`+`Conversation`, merge в памяти, сорт по `updatedAt`) | сервис-агрегатор: `prisma.issue.findMany` + `prisma.conversation.findMany`, склейка | Просто, нет новой таблицы/синка, всегда консистентно | Курсор по слитому списку из 2 таблиц — боль (нужен составной курсор `updatedAt+id+kind`); счётчики непрочитанных дорого; деградирует на больших объёмах |
| **B. Materialized inbox-таблица** (`InboxEntry`: kind=ticket\|conversation, refId, lastMessageAt, unreadCount, preview) | пишется триггерами доменных событий (новый IssueComment / новый Message), читается одним `findMany` с нативным курсором | Один индекс `(tenantId,userId,lastMessageAt)` — быстрый курсор и unread; ровно ложится на единый list-DTO; масштабируется | Нужен синхронизатор (двойная запись/listener) — риск рассинхрона; миграция + backfill. Эталон синка под рукой — `block-ingest`-listener'ы |
| **C. Адаптер-провайдеры** (`InboxProvider[]`: `SupportInboxProvider`, `ConversationInboxProvider`, общий интерфейс) на лету | каждый провайдер отдаёт `InboxItem[]` со своим курсором, фасад мержит | Чисто архитектурно, новые типы лент добавляются провайдером; нет новой таблицы | Тот же курсор-merge-минус, что у A; пагинация «честная» только при materialized |

**Рекомендация под Z:** старт с **C поверх A** (фасад + провайдеры, union на лету) — даёт единый list-DTO без миграции, переиспользует существующие `listTickets`/`listMyTickets`. Когда лента вырастет (unread-бейджи, тяжёлый курсор) — добавить **B** (materialized `InboxEntry`) как кэш под тем же фасадом, провайдеры станут его наполнять. То есть C — контракт, B — реализация-ускоритель потом. Чистый A не брать — он сразу упрётся в курсор/unread.

Единый `InboxItem` (минимум): `{ kind: 'ticket'|'dm'|'group'|'work_chat', refId, title, snippet, lastMessageAt, unreadCount, status?, slaBreachedAt? }` — поля поддержки (`status/slaBreachedAt`) опциональны, как уже в `DeskTicketListItem` (`support-desk.service.ts:31-42`).

---

## 4. Путь миграции support → общее ядро Conversation/Message

**Что мешает сейчас:**
1. **Переписка тикета приколочена к `IssueComment`** через `issueId` FK (`schema.prisma:9442,9470`) — не к абстрактному «треду». Десятки мест читают/пишут `issueComment` напрямую (`support-desk.service.ts:141,198,250`; `support-intake.service.ts:150,216,256`; `support-clone.service.ts:90,196`).
2. **Support-поля сообщения** (`authorType='clone'`, `draftState`, `cloneConfidence`, `groundednessScore`) живут в той же таблице (`schema.prisma:9453-9456`) — при переезде на нейтральный `Message` их надо вынести в support-расширение, иначе общий чат потащит поддержку.
3. **`access` internal/external** (`schema.prisma:9450`) семантичен для тикета (внешний клиент vs внутренняя заметка); в DM/группе «external» не существует — нужна другая модель видимости.
4. **WS сегодня знает только `issue:`/`presence:issue:` rooms** (`tracker.gateway.ts:255-261`) — нет `conversation:`-room.

**Что заложить в модель данных под будущее сведение:**
- Ввести `Conversation` (kind: `dm`|`group`|`work_chat`; tenantId; participants; lastMessageAt) и `Message` по образу `IssueComment` (`parentCommentId`→`parentMessageId`, `content/contentStripped`, `voice*`, `clientMessageId @unique` как в `MeetingRoomMessage:2011`, `attachments/mentions`).
- В новом `Message` **сразу** заложить нейтральный `threadRef` (полиморфная привязка `{ kind:'conversation'|'issue', id }`) — чтобы потом тикет стал ещё одним владельцем треда без второй миграции.
- Support-специфику (`draftState/cloneConfidence/groundednessScore/authorType=clone`) держать в отдельной таблице-расширении `SupportMessageMeta(messageId)`, а не в общем `Message`.
- Ingest: добавить `kind:'chat_message'` в `conversational-ingest.adapter.ts` (рядом с `free_note` `:30-35`) и ветку в `segment-builder.service.ts:200` — тогда и DM, и тикеты текут в граф единообразно через `SourceType.chat` (enum уже есть, `schema.prisma:253`).
- WS: добавить `conversation.join/leave/typing` + room `conversation:<id>` в `tracker.gateway.ts` (копия логики `issue.chat.*` `:166-245`).

**Порядок переезда (когда дойдёт):** (1) построить `Conversation/Message` для DM/групп/рабочих чатов на новом ядре; (2) единый фасад ленты (п.3, вариант C) — поддержка остаётся на `Issue/IssueComment`; (3) позже — `Issue` начинает ссылаться на общий `Conversation` (тикет = `Conversation{kind:'work_chat'}` + support-обёртка с SLA/статусом/контуром), `IssueComment` мигрирует в `Message` + `SupportMessageMeta`. Шаг 3 — последний и необязателен для Варианта B: единый экран достигается уже на шаге 2 без слома поддержки.