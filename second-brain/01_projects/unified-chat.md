# Единый чат Коры (unified-chat) — фактическое состояние

> Реализовано по ТЗ [plans/tz/2026-06-21-unified-chat-kora-tz.md](../../plans/tz/2026-06-21-unified-chat-kora-tz.md) (Ф0–Ф7, R1–R40). Влито в `dev` локально (merge `unified-chat-kora`, НЕ запушено на момент написания). Модуль ядра — `backend/src/modules/messaging/`.

## Принцип
Единый диалоговый слой компании: **один склад сообщений** `Conversation` + `Message` на всё — личка/группы/каналы, рабочий чат задачи, обращения поддержки, внешняя переписка с клиентами. Тикет = `Conversation(kind='ticket')` + обёртка `SupportTicket`. Вся переписка кормит граф знаний (Р5, вкл. dm). Тела сообщений шифруются at-rest и читаются только членами разговора (super_admin тела не читает).

## Модель данных
- **`Conversation`** (`kind`: dm|group|channel|work_chat|external|ticket; `isMandatory`, `feedsGraph`, `lastMessageAt`).
- **`ConversationMember`** (`role`: owner|admin|member|agent|client; `lastReadSeq` — единый read-cursor; `source`: manual|auto; `mutedUntil`).
- **`Message`** (`seq` BigInt — монотонный per-conversation gap-free; `content` AES-256-GCM at-rest; `contentStripped` плейнтекст для GIN-поиска; `access`: normal|internal|external; `authorType`: human|clone|system; `clientMessageId` для идемпотентности; voice/attachments/mentions/reactions/thanks; nullable draftState/cloneConfidence/groundednessScore для тикетов).
- **`MessageOutbox`** — transactional outbox (Message+outbox в одной транзакции).
- **`SupportTicket`** (обёртка над `Conversation(kind='ticket')`: status/SLA/customer).
- **`ConversationAccessLink`** (magic-link внешнего клиента: sha256-хэш токена, TTL/revoke/claim).
- **`Poll/PollOption/PollVote`**, **`PushToken`**, **`UserBlock`**, **`MessageReport`**. `User.kind`(member|external_client)/`verified`. `Issue.conversationId @unique` (work_chat). `Meeting.huddleConversationId`.

## Доставка и realtime
- WS `/ws/tracker`: `conversation.join/leave/typing` + room `conversation:<id>` (+ `conversation:<id>:staff` для не-client — `internal` не течёт клиенту). `@socket.io/redis-adapter` (cross-instance), presence в Redis (TTL).
- **Outbox-relay** (`message-outbox.worker`): Message+outbox в транзакции → relay (`FOR UPDATE SKIP LOCKED` sweep + BullMQ) → WS `message.new` + офлайн-сигнал **без тела/имён** (ФЗ-41, `assertNoExternalBody`).
- **Boot:** `RedisIoAdapter` создаёт свои ioredis pub/sub из `cfg.redis.url` (не `RedisService` до onModuleInit — иначе старт падает).

## Поверхности
- **Внутренний чат** (Ф2): dm/group/channel, обязательный «канал на компанию» (выход → 409), реакции/упоминания/voice. `ConversationController` (`/api/v1/conversations*`, `/message-threads*`), enforcement членства (`NOT_MEMBER` 403), tenant-scoping участников.
- **Рабочий чат задачи** (Ф2.5): `WorkChatService` (ленивый `work_chat` на Issue), переписка `IssueComment` мигрирована в `Message` (backfill идемпотентен), двусторонняя навигация карточка↔«Сообщения».
- **Поддержка** (Ф3): тикет на ядре, клиент видит только `access='external'`, клон-черновик/critic/edit-classify/куратор/SLA/CSAT пересажены с Issue/IssueComment на Message+SupportTicket. Контур-изоляция (IdeaBlock+KnowledgeGroup) не тронута. 0 Issue-пути в support (CI-grep guard).
- **Внешняя переписка** (Ф3.5): `external`-чат, вход клиента по magic-link без пароля (теневой `User(external_client)`), дорегистрация (OTP email, ФЗ-152), guest-scope (только external/normal), rate-limit→429, report/block. Публичная страница `app/(public)/c/[token]`.
- **Единый экран «Сообщения»** (Ф4): `/message-threads` (один запрос по Conversation +join SupportTicket/Issue, INV-A1: status/sla только ticket, linkedIssue только work_chat), sort recent/active/unread + курсор, q по людям/группам/PROJ-NN, `/message-search` (GIN), единый unread-badge (Redis). Фронт `app/(authenticated)/messages` (3 колонки список/чат/контекст, мобильный стек), один `<MessageBubble>` (INV-A2), INV-A3 (только эти эндпоинты).
- **AI-крючки** (Ф5): chat.ingest (relay→граф для feedsGraph), voice ASR (voiceTranscript→граф), системное сообщение при закрытии встречи, chat-summary «Что пропустил», «Спросить Кору» (chat-v2 askEphemeral + Message.id-провенанс), сообщение→задача (intake `source=chat`)/решение (Decision).
- **Мобильное** (Ф6): backend `PushService` транспорт-агностичный (APNs/FCM/RuStore/VAPID, FCM не фундамент — R34), `POST /account/delete` (App Review 5.1.1v), `UserBlock`/`MessageReport` (UGC). `kora-mobile/` — Expo RN scaffold (tsc-clean; нативная сборка/сертификаты/публикация owner-gated).
- **Доводка** (Ф7): опросы (Poll→IdeaBlock decision), huddles (LiveKit из чата → запись+резюме в чат), автоудаление (pre-ingest→soft-delete), HR-авто-подписки (membership-события → ConversationMember auto).

## Флаги (реестр — [docs/operations/feature-flags.md](../../docs/operations/feature-flags.md))
Kill-switches ON: `CHAT_ENABLED`, `MESSAGE_BRIDGE_ENABLED`, `EXTERNAL_CHAT_ENABLED`, `CHAT_INGEST_ENABLED`, `CHAT_PUSH_ENABLED`, `HUDDLES_ENABLED`, `SUPPORT_DESK_ENABLED`/`SUPPORT_CURATOR_ENABLED`. Крутилки в AdminSetting: `chat_presence_ttl_seconds`, `chat_outbox_sweep_*`, `chat_summary_min_messages/idle_days`, `external_link_ttl_hours`, `external_inbound_rate_limit`, `message_retention_days`(0=выкл), `hr_auto_subscribe_enabled`, `huddle_max_participants`, `push_debounce_seconds`, `unread_smart_badge`.

## Открытые пункты (см. [04_не-сделано](../04_не-сделано/README.md))
Captcha внешнего входа (owner: провайдер+ключ), боевые push-креды (APNs/FCM/RuStore), нативная сборка+публикация kora-mobile, полная анонимизация PII при удалении аккаунта, members-эндпоинт (имена участников в UI), in-memory курсор `/message-threads` (SQL-keyset при росте), опц. дроп неиспользуемых support-полей Issue/IssueComment, embedding decision-блока опроса.
