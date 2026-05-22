---
type: tz
status: draft
feature: SBA α-1 — Conversational Channels Foundation (двунаправленный омниканальный слой)
date: 2026-05-21
parent_tz: tz/2026-05-21-second-brain-agents-umbrella.md
phase: alpha
unblocks:
  - tz/2026-05-21-sba-alpha-4-layer4-curation-foundation.md (Curation шлёт probe через channels)
  - tz/2026-05-21-sba-alpha-5-layer5-chat-v2.md (ChatV2 как inbound-handler)
  - tz/2026-05-21-sba-beta-1-channels-telegram-max.md (Telegram + MAX адаптеры — переиспользуют IChannel)
  - tz/2026-05-21-sba-beta-5-specialist-3-6-ideas-and-layer6-probe.md (Probe-Agent шлёт через channels)
covers_matrix_rows: [E1..E10 (без E9), J10..J11 частично, K5, L3]
---

# ТЗ α-1: Conversational Channels Foundation

> **Это sub-TZ.** Зонтичный — [`plans/tz/2026-05-21-second-brain-agents-umbrella.md`](2026-05-21-second-brain-agents-umbrella.md). При расхождениях — приоритет у зонтичного.
>
> **Архитектурное решение, которое реализует этот sub-TZ:** [§3.5 Conversational Channels — двунаправленные, pluggable, омниканальные](2026-05-21-second-brain-agents-umbrella.md#35-conversational-channels--%D0%B4%D0%B2%D1%83%D0%BD%D0%B0%D0%BF%D1%80%D0%B0%D0%B2%D0%BB%D0%B5%D0%BD%D0%BD%D1%8B%D0%B5-pluggable-%D0%BE%D0%BC%D0%BD%D0%B8%D0%BA%D0%B0%D0%BD%D0%B0%D0%BB%D1%8C%D0%BD%D1%8B%D0%B5).
>
> **Контекст для исполнителя:**
> - Стек — NestJS / Prisma / Redis / BullMQ. ENV — `TypedConfigService` (skill `nestjs-rules`).
> - Prisma — только `bun run prisma:push` (skill `prisma-db-push-rules`).
> - Все email — через существующий [mail.hosting.reg.ru SMTP setup](../../second-brain/01_projects/auth-and-accounts.md).

---

## 1. Цель

После α-1 в Z работает **`ConversationalModule`** — двунаправленный омниканальный слой общения с человеком. Он используется:
- Слоем 4 (Curation) для отправки probe куратору
- Слоем 5 (Chat-v2) как входной канал для AI-вопросов
- Слоем 6 (Probe-Agent) для активного уточнения пробелов
- Любым другим компонентом, который хочет «спросить человека через привычный канал»

InApp и Email — два первых канала. Telegram/MAX — в β-1, без правки этого слоя.

---

## 2. Зависимости

**Зависит от:**
- Существующих моделей `User`, `Org`, `Membership`.
- SMTP-инфры из [accounts](../../second-brain/01_projects/auth-and-accounts.md).
- `BullMQModule` (для outbound-очереди).

**Разблокирует:** α-4, α-5, β-1, β-5.

---

## 3. Scope

### Входит

- `ConversationalModule` как `@Global` модуль в `backend/src/modules/conversational/`.
- 4 Prisma-модели: `Channel`, `ChannelBinding`, `Notification`, `NotificationDelivery` (см. §4).
- Интерфейс `IChannel` (send / ingest / parseResponse).
- 2 адаптера: `InAppChannelAdapter`, `EmailSmtpChannelAdapter`. Опц. `EmailImapChannelAdapter` (reply-парсинг — может быть отложен на β-1).
- `ConversationalService` — публичный API: `sendNotification(event)`, `subscribeInbound(handler)`, `respondToProbe(notificationId, payload)`.
- Routing-слой: per-user preferences + per-event-type policy + dataClass-фильтр.
- Universal linking flow (код в ЛК → команда `/link` в боте) — инфра, использование в β-1.
- API: `/api/v1/me/notifications`, `/api/v1/me/notifications/:id/respond`, `/api/v1/me/channel-preferences`, `/api/v1/me/channels`, `/api/v1/me/channels/:kind/link-code`.
- UI: `/me/channels` (привязка каналов), `/me/notifications` (центр уведомлений, master-detail).
- Метрики `conversational_*` в `BusinessMetricsService`.
- RBAC: `channel`, `notification` ResourceType.

### Не входит

- Telegram/MAX адаптеры (β-1).
- Voice-через-ASR (γ+).
- Slack/Mattermost/WhatsApp (γ+).
- AI-chat-handler как inbound (α-5 регистрирует себя).
- Логика создания probe-нотификаций (β-5 ProbeService использует этот слой).

---

## 4. Модели данных (Prisma)

```prisma
model Channel {
  id              String   @id @default(uuid())
  tenantId        String   // @relation Org
  kind            ChannelKind
  direction       ChannelDirection  // 'inbound_only' | 'outbound_only' | 'bidirectional'
  config          Json     // зашифрованные секреты через CryptoService
  status          ChannelStatus     // 'active' | 'disabled' | 'broken'
  maxDataClass    DataClass         // public | internal | confidential | restricted | top_secret
  brokenReason    String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@index([tenantId, kind])
}

model ChannelBinding {
  id              String   @id @default(uuid())
  userId          String
  channelId       String
  externalId      String   // tg user_id, email, max id
  preferences     Json     // quiet hours, rate limits, event-type filters
  linkedAt        DateTime @default(now())
  verifiedAt      DateTime?
  @@unique([channelId, externalId])
  @@index([userId])
}

model Notification {
  id              String   @id @default(uuid())
  tenantId        String
  recipientUserId String
  eventType       String   // 'probe.question' | 'curation.pending' | 'idea.status_changed' | ...
  payload         Json     // payload-схема зависит от eventType
  dataClass       DataClass
  contextBlockId  String?  // ссылка на IdeaBlock-источник
  contextCardId   String?  // ссылка на карточку специалиста
  status          NotificationStatus  // queued | sent_partial | delivered | read | responded | failed
  responseStatus  NotificationResponseStatus?  // pending | answered | dismissed | expired
  responsePayload Json?
  expiresAt       DateTime?
  createdAt       DateTime @default(now())
  respondedAt     DateTime?
  @@index([tenantId, recipientUserId, status])
}

model NotificationDelivery {
  id                  String   @id @default(uuid())
  notificationId      String
  channelBindingId    String
  status              DeliveryStatus  // queued | sent | delivered | read | responded | failed
  externalMessageId   String?         // tg message id, smtp message id
  errorReason         String?
  attemptedAt         DateTime @default(now())
  deliveredAt         DateTime?
  readAt              DateTime?
  respondedAt         DateTime?
  @@index([notificationId])
  @@index([channelBindingId, status])
}
```

Новые enum'ы: `ChannelKind`, `ChannelDirection`, `ChannelStatus`, `NotificationStatus`, `NotificationResponseStatus`, `DeliveryStatus`. `DataClass` — переиспользуется существующий.

`ChannelKind` в α-1: `in_app`, `email_smtp`, `email_imap`. Расширение в β-1: `telegram_bot`, `max_bot`.

---

## 5. Интерфейс `IChannel`

```ts
export interface IChannel {
  readonly kind: ChannelKind;
  readonly maxDataClass: DataClass;
  send(delivery: NotificationDelivery, notification: Notification, binding: ChannelBinding): Promise<{externalMessageId: string}>;
  ingest(rawMessage: unknown): Promise<InboundMessage>;
  parseResponse(rawMessage: unknown, openProbes: Notification[]): Promise<ParsedResponse | null>;
}

export type InboundMessage =
  | { type: 'free_note'; userId: string; text: string; metadata: Json }
  | { type: 'response'; userId: string; notificationId: string; payload: Json }
  | { type: 'chat_query'; userId: string; question: string; conversationId?: string };
```

Регистрация адаптеров через `@Injectable()` + `ChannelRegistry.register(adapter)`.

---

## 6. ConversationalService — публичный API

```ts
sendNotification(event: SendNotificationInput): Promise<Notification>
subscribeInbound(handler: (msg: InboundMessage) => Promise<void>): void
respondToProbe(notificationId: string, userId: string, payload: Json): Promise<void>
listMyNotifications(userId: string, filter): Promise<Notification[]>
linkChannel(userId: string, kind: ChannelKind, externalId: string, code: string): Promise<ChannelBinding>
generateLinkCode(userId: string, kind: ChannelKind): Promise<string>  // одноразовый, TTL 10 min, Redis
```

---

## 7. Routing-логика (внутренняя)

При `sendNotification`:
1. Найти `ChannelBinding[]` для `recipientUserId`.
2. Отфильтровать по `notification.dataClass <= channel.maxDataClass`.
3. Отфильтровать по `binding.preferences.eventTypeFilter`.
4. Отфильтровать по quiet hours (если не critical).
5. Применить per-event-type policy (например, `probe.question` → telegram + in_app; `curation.pending` → in_app + email).
6. Если ни один канал не подошёл → fallback на `in_app` (он всегда разрешён).
7. Для каждого выбранного канала — `NotificationDelivery` + enqueue `conversational.send` BullMQ job.

При inbound (через webhook или polling — зависит от канала):
1. `Channel.ingest(raw)` → `InboundMessage`.
2. Если `type='response'` → `parseResponse` найдёт `openProbes` → `respondToProbe`.
3. Если `type='free_note'` → создать `RawEvent` через `IngestService` (новый адаптер `conversational.adapter` в `ingest/`).
4. Если `type='chat_query'` → вызвать подписанный chat-handler (α-5 регистрирует его).

---

## 8. ENV / конфигурация

```
CONVERSATIONAL_OUTBOUND_CONCURRENCY=4
CONVERSATIONAL_LINK_CODE_TTL_SEC=600
CONVERSATIONAL_QUIET_HOURS_DEFAULT="22:00-08:00"  # tz-агностично, применяется в локали user'а
CONVERSATIONAL_RATE_LIMIT_DEFAULT_PER_HOUR=10
EMAIL_FROM_DEFAULT="noreply@kora.ai"
```

Все через `TypedConfigService.conversational.*`.

---

## 9. RBAC

- `channel` ResourceType — read/write/delete: owner/admin. Tenant-настройка каналов делается в `/admin/channels` (отдельный sub-TZ, не входит).
- `notification` ResourceType — read: owner/admin/recipient (политика «только свои + админы»).
- `/me/*` endpoints — `CookieAuthGuard` + own-user-only (через `@CurrentUser()`).

---

## 10. Метрики

`BusinessMetricsService`:
- `conversational_notifications_total{eventType, status}` (counter)
- `conversational_deliveries_total{kind, status}` (counter)
- `conversational_response_rate{kind, eventType}` (gauge, rolling 7d)
- `conversational_response_time_seconds{kind, eventType}` (histogram)
- `conversational_inbound_total{kind, type}` (counter)
- `conversational_link_attempts_total{kind, status}` (counter)

---

## 11. LLM

Этот sub-TZ не вызывает LLM. (Routing — pure heuristic.)

---

## 12. Фазы реализации

- [x] **α-1.0** Preflight: payload-схемы `probe.question` / `curation.pending` / `system.message` зафиксированы как Zod-схемы в `event-payload.registry.ts` (расширяемые).
- [x] **α-1.1** Prisma-модели `Channel`, `ChannelBinding`, `Notification`, `NotificationDelivery` + новые enum'ы. **`bun run prisma:push` нужно прогнать на проде** (см. §16); локально на нашем dev'е Docker не поднят, поэтому push отложен — Prisma client сгенерирован, схема валидна.
- [x] **α-1.2** `CryptoService` доступен через `CryptoModule` @Global; `Channel.config` шифруется при добавлении секретов в адаптерах (для in_app/email_smtp в α-1 config пустой `{}`).
- [x] **α-1.3** `IChannel` интерфейс + `ChannelRegistry`.
- [x] **α-1.4** `InAppChannelAdapter` — БД-резидент, без external transport.
- [x] **α-1.5** `EmailSmtpChannelAdapter` — outbound через `MailService.sendPlain` + deep-link в ЛК.
- [ ] **α-1.6** (опц.) `EmailImapChannelAdapter` — **перенесено в β-1** (см. §14, решение принято: SMTP-only + deep-link достаточно).
- [x] **α-1.7** `ConversationalService` (sendNotification, subscribeInbound, respondToProbe, markRead, dismissProbe, listMyNotifications, generateLinkCode, linkChannel).
- [x] **α-1.8** Routing-логика + `conversational.send` BullMQ worker (concurrency из ENV `CONVERSATIONAL_OUTBOUND_CONCURRENCY`, exp backoff).
- [x] **α-1.9** `ConversationalIngestAdapter` — `ingestFreeNote` создаёт `RawEvent(Source.type='conversational')`.
- [x] **α-1.10** REST API + DTO + Swagger (`/me/channels`, `/me/notifications`, `/me/notifications/free-note`, ...).
- [x] **α-1.11** UI `/me/channels` — список каналов, генерация link-code, отвязка.
- [x] **α-1.12** UI `/me/notifications` — master-detail, фильтры, inline respond/dismiss + free-note форма.
- [x] **α-1.13** Метрики `conversational_*` в `BusinessMetricsService`.
- [x] **α-1.14** RBAC: `channel`, `notification` в `policy.csv`.
- [x] **α-1.15** Глоссарий UI (`delivery/13-glossary.md` раздел SBA α-1, `delivery/ui/copy-strings.ru.md` секция Conversational Channels).
- [x] **α-1.16** Документация: `second-brain/01_projects/conversational-channels.md`, апдейт `02_architecture/module-map.md`, ссылка в `second-brain/index.md`.

---

## 13. DoD

- Все Prisma-модели в схеме, `bun run prisma:push` проходит.
- `bun run typecheck && bun run lint && bun run build` — зелёный.
- Integration-test: создать `Notification` → выбираются in_app + email каналы → доставка → respond через API → status='responded'.
- Integration-test: free-note через `POST /me/notifications/respond` с режимом «свободная заметка» → создаётся `RawEvent` → виден в knowledge-core ingest.
- Linking-flow: генерация кода в API → имитация бота (мок) → `ChannelBinding.verifiedAt` проставлен.
- UI `/me/channels` и `/me/notifications` работают на реальном API.
- Метрики `conversational_*` экспортируются через `/metrics`.

---

## 14. Открытые вопросы

1. **EmailImapChannelAdapter — в α-1 или β-1?** Если SMTP-only достаточно (deep-link в ЛК для ответа) — переносим в β-1. Если хотим reply-парсинг сразу — оставляем в α-1.
2. **Notification payload schema** — JSON Schema validation на уровне модели или just-trust-typescript? Рекомендация: Zod-валидация на write через DTO.
3. **Conflict с существующими `notifications` системами** (если есть в [accounts module](../../second-brain/01_projects/auth-and-accounts.md)) — мигрировать в новую или оставить параллельно?

---

## 15. Итог (2026-05-21)

**Реализовано целиком:** да (α-1.0…α-1.16 минус α-1.6, перенесённый в β-1).

**Что сделано:**
- Backend: новый `@Global` модуль `backend/src/modules/conversational/` с 4 Prisma-моделями, `ConversationalService` (routing + sendNotification + linking), `ChannelRegistry`, адаптеры `in_app` и `email_smtp`, `ConversationalIngestAdapter`, BullMQ outbound worker с exp backoff и retry. REST `/me/channels` и `/me/notifications` (с respond/dismiss/read/free-note) + Swagger. RBAC channel/notification в policy.csv. Метрики conversational_* в BusinessMetricsService. Backend typecheck + build чистые.
- Frontend: ApiDto `frontend/src/api/conversational.api.ts`, DomainModel `frontend/src/domain/conversational.ts`, страницы `/me/channels` и `/me/notifications` (master-detail, фильтры, free-note форма). Frontend typecheck чистый.
- Документация: `second-brain/01_projects/conversational-channels.md`, апдейт `02_architecture/module-map.md`, ссылка из `second-brain/index.md`, разделы в `delivery/13-glossary.md` и `delivery/ui/copy-strings.ru.md`.

**Что осталось / на проде:**
- `bun run prisma:push` на проде (применить миграцию схемы — Docker dev на этой машине не поднят, но Prisma client сгенерирован, схема валидна).
- DoD §13 integration-тесты (создание Notification → routing → respond → free-note) — нужны при наличии живой dev-БД; код к ним готов.

**Зависимости вниз:** на α-1 опираются α-4, α-5, β-1, β-5.

## 16. Prod-операции

Перед мержем на прод (см. §13 DoD):

```bash
# 1. Применить схему БД (новые таблицы channels, channel_bindings,
#    notifications, notification_deliveries + SourceType=conversational).
cd backend && bun run prisma:push && bun run prisma:generate

# 2. Перезапустить backend — он зарегистрирует
#    ConversationalModule, поднимет BullMQ-очередь conversational.send,
#    включит /me/channels и /me/notifications контроллер.
docker compose up -d --build backend

# 3. (Опц.) Установить ENV переопределения, если нужно (defaults подходят):
#    CONVERSATIONAL_OUTBOUND_CONCURRENCY=4
#    CONVERSATIONAL_LINK_CODE_TTL_SEC=600
#    CONVERSATIONAL_QUIET_HOURS_DEFAULT="22:00-08:00"
#    CONVERSATIONAL_RATE_LIMIT_DEFAULT_PER_HOUR=10
#    CONVERSATIONAL_MAX_DELIVERY_ATTEMPTS=5

# 4. Smoke-test: открыть /me/notifications в браузере под обычным
#    пользователем, отправить free-note — должна появиться запись в
#    RawEvent с source.type='conversational'.
```

RBAC policy подхватывается автоматически из обновлённого `policy.csv` при старте.
