---
type: feature
status: in_progress
phase: alpha-1
related_tz: plans/tz/2026-05-21-sba-alpha-1-channels-foundation.md
parent_tz: plans/tz/2026-05-21-second-brain-agents-umbrella.md
implemented_at: 2026-05-21
---

# Conversational Channels Foundation (SBA α-1)

> **Что это.** Двунаправленный омниканальный слой общения с человеком. На α-1 — `in_app` + `email_smtp`. На β-1 расширяется до `telegram_bot`/`max_bot`/`email_imap` без правки этого слоя (только новые адаптеры).
>
> **Зачем.** Когда Кора (Слой 4 Curation, Слой 5 ChatV2, Слой 6 Probe-Agent) хочет «спросить человека», она дёргает один сервис — `ConversationalService.sendNotification`. А не каждая система пилит свой канал общения отдельно.

## Архитектура

```
ConversationalService.sendNotification(event)
        ↓
[ Validate payload (Zod registry) ]
        ↓
[ ensureInAppForUser → ChannelBinding ]
        ↓
[ resolveBindings(tenant, user) → list ]
        ↓
[ Filter:                                ]
[   - dataClass ≤ channel.maxDataClass   ]
[   - preferences (allow/deny/quiet)     ]
[   - per-event-type policy              ]
[   - fallback на in_app                 ]
        ↓
[ Create Notification + N×Delivery ]
        ↓
[ enqueue BullMQ conversational.send × N ]
        ↓
ConversationalSendWorker.process(job)
        ↓
ChannelRegistry.require(kind) → IChannel
        ↓
adapter.send(...) → externalMessageId | throw
        ↓
[ update Delivery.status, recompute Notification.status ]
```

## Модели Prisma

- `Channel(tenantId, kind, direction, config, status, maxDataClass)` — один настроенный канал на Org для каждого `ChannelKind`.
- `ChannelBinding(userId, channelId, externalId, preferences, verifiedAt)` — привязка пользователя к каналу.
- `Notification(tenantId, recipientUserId, eventType, payload, dataClass, status, responseStatus, responsePayload, expiresAt)` — событие, адресованное пользователю.
- `NotificationDelivery(notificationId, channelBindingId, status, externalMessageId, attempts, errorReason, ...)` — попытка доставки в конкретный канал.

Enum'ы: `ChannelKind`, `ChannelDirection`, `ChannelStatus`, `NotificationStatus`, `NotificationResponseStatus`, `NotificationDeliveryStatus`. `SourceType.conversational` добавлен — используется адаптером свободных заметок.

Обратные relations: `User.channelBindings`, `User.notifications`, `Org.channels`, `Org.notifications`.

## Public API

### `ConversationalService` (backend)
- `sendNotification(input)` — отправить нотификацию (валидирует payload, выбирает каналы, ставит в очередь).
- `respondToProbe(notificationId, userId, payload)` — ответить на probe (идемпотентен).
- `dismissProbe(notificationId, userId)` — закрыть без ответа.
- `markRead(notificationId, userId)` — пометить прочитанным.
- `listMyNotifications/getMyNotification` — выборка для UI.
- `listMyChannels/updatePreferences/unlinkChannel` — управление привязками.
- `generateLinkCode(userId, kind)` / `linkChannel(tenantId, kind, externalId, code)` — universal linking flow.
- `subscribeInbound(type, handler)` / `dispatchInbound(msg)` — подписка/диспатч inbound (для α-5 chat-handler и β-1 telegram/max).

### `ConversationalIngestAdapter`
- `ingestFreeNote({tenantId, userId, text, metadata})` — создаёт `RawEvent(Source.type='conversational')` через `IngestService`.

### REST API (`/api/v1/me/...`)
- `GET /me/channels` — список Org-каналов + моя привязка.
- `POST /me/channels/:kind/link-code` — одноразовый код (TTL 10 мин).
- `PATCH /me/channels/bindings/:bindingId/preferences` — настройки.
- `DELETE /me/channels/bindings/:bindingId` — отвязать.
- `GET /me/notifications` (фильтры unread/pending_response/all, пагинация по cursor).
- `GET /me/notifications/:id` (детали + история доставок).
- `POST /me/notifications/:id/respond` — ответить.
- `POST /me/notifications/:id/dismiss` — закрыть.
- `POST /me/notifications/:id/read` — пометить прочитанным.
- `POST /me/notifications/free-note` — создать `RawEvent` из свободной заметки.

## Routing-логика

При `sendNotification`:
1. Найти `ChannelBinding[]` пользователя (через `verifiedAt IS NOT NULL` и `channel.status='active'`).
2. Гарантировать `in_app` (auto-upsert при необходимости).
3. Отфильтровать по `notification.dataClass ≤ channel.maxDataClass`.
4. Отфильтровать по `preferences.eventTypeAllow/Deny` и `disabledUntil`.
5. Применить per-event-type policy (`EVENT_TYPE_CHANNEL_POLICY` в коде).
6. Quiet hours — пропускают каналы, если `!critical`. Fallback на `in_app` (он живёт всегда).
7. Создать N×`NotificationDelivery` и поставить N задач в очередь.

Per-event-type defaults в α-1:
- `probe.question` → `[telegram_bot, max_bot, in_app]` (на α-1 первые два не существуют — попадает в `in_app`).
- `curation.pending` → `[in_app, email_smtp]`.
- `system.message` → `[in_app, email_smtp]`.

## Outbound worker

`ConversationalSendWorker` (in-process, как `WebhookDeliveryWorker`):
- BullMQ-очередь `conversational.send`.
- concurrency = `CONVERSATIONAL_OUTBOUND_CONCURRENCY` (4 по умолчанию).
- Exp backoff (2^attempt сек, cap 1 час), потолок `CONVERSATIONAL_MAX_DELIVERY_ATTEMPTS` (5).
- На успех — `Delivery.status='delivered'` + пересчёт `Notification.status`.
- На ошибку до потолка — retry с delay. На потолке — `failed`.

## Quiet hours / preferences

`ChannelBindingPreferences` — Zod-схема в JSON:
- `quietHours` — `HH:mm-HH:mm` (серверная TZ; локализация TZ-пользователя — β+).
- `eventTypeAllow/Deny`.
- `rateLimitPerHour` — placeholder, проверка появится в β+.
- `disabledUntil` — ISO-дата.

## Метрики Prometheus

- `conversational_notifications_total{event_type, status}` — queued/delivered/read/responded/failed/sent_partial.
- `conversational_deliveries_total{kind, status}` — попытки в конкретный канал.
- `conversational_inbound_total{kind, type}` — free_note/response/chat_query.
- `conversational_link_attempts_total{kind, status}` — generated/verified/invalid_code.
- `conversational_response_time_seconds{kind, event_type}` — histogram времени ответа.

## RBAC

`policy.csv`:
- `channel` — owner/admin/manager read; write/manage — owner/admin (настройка Org-каналов через `/admin/channels` — отдельный sub-TZ).
- `notification` — owner/admin read all; manager — только свои (`self`). Обычный пользовательский доступ к своим notification — через `/me/notifications` (фильтр в контроллере).

## ENV

- `CONVERSATIONAL_OUTBOUND_CONCURRENCY=4`
- `CONVERSATIONAL_LINK_CODE_TTL_SEC=600`
- `CONVERSATIONAL_QUIET_HOURS_DEFAULT="22:00-08:00"`
- `CONVERSATIONAL_RATE_LIMIT_DEFAULT_PER_HOUR=10`
- `CONVERSATIONAL_EMAIL_FROM_DEFAULT=""` (fallback на `MAIL_FROM`)
- `CONVERSATIONAL_MAX_DELIVERY_ATTEMPTS=5`

## UI

`/me/channels` — список каналов + моя привязка, генерация кода привязки, отвязка.
`/me/notifications` — master-detail список с фильтрами (Непрочитанные / Ждут ответа / Все), inline-кнопки «Ответить»/«Пропустить», форма «Свободная заметка» → `RawEvent`.

Глоссарий русских терминов: `delivery/13-glossary.md` (раздел SBA α-1) и `delivery/ui/copy-strings.ru.md`.

## Что не входит в α-1

- `email_imap` reply-парсинг (перенесено в β-1).
- ~~`telegram_bot`/`max_bot` адаптеры — β-1.~~ → **реализовано в SBA β-1 (см. ниже).**
- `/admin/channels` для конфигурации Org-каналов через UI — отдельный sub-TZ (не блокирует α-1).
- AI-chat-handler как inbound `chat_query` — α-5 регистрирует себя через `subscribeInbound`.
- Probe-Agent (создание probe-нотификаций) — β-5 использует этот слой.

## Зависимости вниз

На α-1 опираются:
- **α-4 Curation Foundation** — шлёт `curation.pending` через `ConversationalService`.
- **α-5 ChatV2** — регистрирует `chat_query` handler через `subscribeInbound`.
- **β-1 Telegram + MAX** — добавляет адаптеры в `ChannelRegistry` (см. ниже).
- **β-5 Probe-Agent** — отправляет `probe.question` через `ConversationalService`.

---

# Conversational Channels β-1 — Telegram + MAX adapters

> **Дата:** 2026-05-22. **ТЗ:** `plans/tz/2026-05-21-sba-beta-1-channels-telegram-max.md`.
>
> **Что это.** Первые два внешних канала: Telegram-бот и MAX-бот (mssgr.ru). Покрывают outbound (`Notification → sendMessage`), inbound (slash-commands + callback + free text → `dispatchInbound`), inline-кнопки для probe-ответов, и `/link <код>` linking flow.

## Адаптеры

`backend/src/modules/conversational/adapters/telegram-bot/`:
- `telegram-bot.adapter.ts` — `IChannel`-адаптер: `send`, `ingestUpdate`, маршрутизация slash-команд.
- `telegram-api-client.ts` — тонкий клиент Bot API (`sendMessage`, `setWebhook`, `setMyCommands`, `answerCallbackQuery`, `getMe`, `deleteWebhook`) с throttle через Redis-bucket (`cfg.telegramBot.globalRps`).
- `telegram-webhooks.controller.ts` — `POST /api/v1/webhooks/telegram-bot/:tenantId` с `X-Telegram-Bot-Api-Secret-Token` timing-safe verification.
- `telegram.types.ts` — типизированный subset Update / Message / CallbackQuery / SendMessage / InlineKeyboardMarkup.
- `SMOKE.md` — инструкция ручного smoke на проде.
- `telegram-bot.adapter.spec.ts` — unit-тесты ключевых сценариев (`/link`, `/ask`, callback, voice, незалинкованный юзер).

`backend/src/modules/conversational/adapters/max-bot/` — то же для MAX (api base `https://platform-api.max.ru`):
- `max-bot.adapter.ts` / `max-api-client.ts` / `max-webhooks.controller.ts` / `max.types.ts` / `SMOKE.md`.
- MAX webhook не использует header-secret → secret встроен в path (`/api/v1/webhooks/max-bot/:tenantId/:secret`).

## CommandHandlerService

`backend/src/modules/conversational/command-handler.service.ts` — подписан на `subscribeInbound('command', ...)`. Отвечает:
- `/status` — `prisma.notification.count(pending probe)`.
- `/myideas` — placeholder («скоро в β-5»).
- `/help` — список команд.

Ответ — `sendNotification(eventType='system.message', preferredChannelKinds=[bindingKind], critical=true)`, чтобы ушёл туда же, откуда пришёл вопрос (через `originChannelBindingId`).

## Inbound маршрутизация (`TelegramBotChannelAdapter.ingestUpdate`)

| Сценарий | Тип InboundMessage | Дальше |
|---|---|---|
| `/link <code>` | `null` (обрабатывается в адаптере) | `linkCode.consume` → upsert `ChannelBinding` |
| `/ask <q>` | `chat_query` | → ChatV2Service (α-5) |
| `/note <t>` | `free_note` | → `ConversationalIngestAdapter` |
| `/idea <t>` | `free_note` с `metadata.tag='idea'` | → `ConversationalIngestAdapter` |
| `/status`, `/myideas`, `/help` | `command` | → `CommandHandlerService` |
| `callback_query` (нажата inline-кнопка) | `response` | → `respondToProbe` (handler в α-1) |
| reply на наше сообщение | `response` (match по `NotificationDelivery.externalMessageId`) | → `respondToProbe` |
| свободный текст | `free_note` | → `ConversationalIngestAdapter` |
| voice / audio | `null` + best-effort reply «голос не поддерживается» | — |

## Расширение InboundMessage

Добавлен 4-й тип в `backend/src/modules/conversational/types/channel.types.ts`:
```ts
| { type: 'command'; userId; tenantId; commandName: string; args?: string; originChannelBindingId? }
```
Существующие типы (`free_note`/`response`/`chat_query`) расширены полем `originChannelBindingId?` (раньше было только у `chat_query`).

## ENV (β-1, новое)

- `TELEGRAM_BOT_API_BASE=https://api.telegram.org`
- `TELEGRAM_BOT_GLOBAL_RPS=25`
- `MAX_BOT_API_BASE=https://platform-api.max.ru`
- `MAX_BOT_GLOBAL_RPS=25`

Per-tenant `botToken` + `webhookSecret` хранятся в `Channel.config` зашифрованными через `CryptoService.encrypt` (формат `gcm:v1:...`). Setup-скрипты (`bun run setup:telegram-bot` / `setup:max-bot`) шифруют их при upsert'е.

## Метрики (новые)

- `telegram_bot_api_errors_total{api_method, code}` — counter
- `telegram_bot_webhook_received_total{type}` — counter (`message`/`callback_query`/`command`/`edited_message`/`unknown`)
- `max_bot_api_errors_total{api_method, code}` — counter
- `max_bot_webhook_received_total{type}` — counter

Базовые `conversational_*` метрики работают автоматически (label `kind='telegram_bot'|'max_bot'`).

## Setup-скрипты

- `bun run setup:telegram-bot -- --token <BOT_TOKEN> --tenant-id <tenantId> --public-host-url <url> [--webhook-secret <secret>]`
- `bun run setup:max-bot -- --token <ACCESS_TOKEN> --tenant-id <tenantId> --public-host-url <url> [--webhook-secret <secret>]`

Idempotent — upsert по `(tenantId, kind)`. Шифруют секреты совместимо с `CryptoService` (формат `gcm:v1:...`).

## ⚠ Telegram — два независимых пути (CRIT-5)

В Z есть **две разные интеграции Telegram** с разными целями, моделями и RBAC. Не путать:

| Свойство | Ingest path (legacy) | Conversational path (β-1) |
|---|---|---|
| Каталог | `backend/src/modules/ingest/adapters/telegram/` | `backend/src/modules/conversational/adapters/telegram-bot/` |
| Назначение | Пассивный приём сообщений из чата/канала как **источника знаний** | Двунаправленное общение Кора ↔ пользователь (probe-ответы, /ask, free notes) |
| Webhook URL | `POST /api/v1/ingest/telegram/:sourceId` | `POST /api/v1/webhooks/telegram-bot/:tenantId` |
| Persisted as | `Source` (тип `bot`) + `RawEvent` (источник знаний) | `ChannelBinding(userId, channelId)` + `Notification`/`Delivery` |
| Tenant resolve | `Source.tenantId` (заранее настроен админом) | `:tenantId` в path + `Channel.tenantId` |
| Auth | `Source.config.botToken` (per-Source) | `Channel.config.botToken` (per-tenant, один бот на Org) |
| RBAC | `source` ResourceType (источники знаний — admin/manager) | `channel`/`notification` ResourceType (см. выше) |
| Адресация | Сообщения идут «вообще» в Source — без привязки к конкретному User | Сообщения идут конкретному User через `ChannelBinding.externalId` |
| Inline-кнопки | Нет (только текст) | Да (probe-ответы, β-1) |
| LinkCode flow | Нет (привязка делается админом через настройку Source) | Да (`/link <код>` → upsert ChannelBinding) |

**Правило выбора пути для новых фич:**
- Нужно принять сообщение в общий knowledge-граф без user-привязки → **ingest path**.
- Нужно общаться с конкретным пользователем (probe-вопрос, ChatV2, проактивные сообщения) → **conversational path**.

**Зависимости в плане v2:**
- δ-2 (ProactiveWatcher) использует **conversational path** — он отправляет пользователю.
- δ-3 (Voice channel) ASR-on-voice использует **conversational path** (`message.voice` → ASR → `free_note`/`chat_query`). Ingest path с голосом не работает.

## Открытые вопросы (решения β-1)

1. **MAX публичная Bot API?** — Да. context7 verified 2026-05-22 (`dev.max.ru/docs-api`). API минималистичная: `POST /messages`, `POST /subscriptions`, `DELETE /subscriptions`, `GET /me`. Авторизация: header `Authorization: <token>`. Inline-кнопки: `attachments[type='inline_keyboard']`. **Формат update'а** зафиксирован defensive-парсером (`update_type`, `sender.user_id`, `chat_id`, `body.text`, `callback.payload`) — после реального smoke на проде поля могут потребовать донастройки.
2. **Single bot per tenant** — да, admin создаёт бота, прокладывает токен через setup-script.
3. **Голос** — игнор + reply «не поддерживается». ASR — γ+.
4. **Throttle** — Redis-bucket per-second, 25 RPS pessimistic, до 10 попыток подождать; иначе пропускаем (Telegram сам ответит 429 → retry воркера).

[[../index|← index]]
