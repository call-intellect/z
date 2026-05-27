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

## Продуктовые принципы каналов (утверждены 2026-05-25)

Это верховный закон слоя — любые будущие фичи каналов сверять с ним. Принципы взяты из продуктового обсуждения 2026-05-25 (Telegram-бот + приглашения сотрудников).

1. **Приватность переписки клиента — святое.** Главный администратор платформы (super-admin) НЕ читает содержимое сообщений клиентов. Видит только статусы доставки, метаданные привязок, агрегированные счётчики. Доступ к содержимому — только по юридической процедуре с письменным согласием клиента.
2. **Magic-link (одноразовая ссылка-вход) — по умолчанию вместо паролей.** Постоянный пароль — опция в настройках профиля для тех, кто захочет. Письма с временным паролем (Bitrix-стиль) — deprecated, оставлены только для обратной совместимости и постепенно выводятся.
3. **Электронная почта сотрудника — необязательна.** Линейный персонал (продавцы, повара, мастера, водители) может работать только через Telegram. Без почты вход в кабинет — через команду в бот: бот высылает одноразовую ссылку на 15 минут.
4. **Один пользователь = одна компания (`Org`).** На уровне сервиса (не БД) при создании нового `Membership` проверяется, что у пользователя ещё нет другого активного `Membership`. Модель `Membership` остаётся many-to-many, но валидация блокирует. Снимать ограничение — только по явному продуктовому решению.
5. **Бот пишет только тем, кто сам начал разговор или явно согласился.** Никаких холодных сообщений извне. Бот может писать только сотрудникам (после `linkChannel`) и внешним людям, которые написали первыми (или явно согласились через QR/форму).
6. **Личка — по умолчанию, групповые чаты — отдельная фича по запросу.** На MVP бот пишет каждому сотруднику в личный диалог. Групповые чаты компании — отложено до явного спроса клиента и только под строго определённый класс событий (например, утренний дайджест в общий чат отдела).
7. **Меньше переключателей = меньше путаницы.** Поведение системы выводится из статуса (`Org.status`, `User.deletedAt`, `ChannelBinding.verifiedAt`), а не из настройки в десятом меню. Если можно не вводить кнопку — не вводим.

---

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

# Conversational Channels β-1 — Telegram + MAX adapters (zero-button)

> **Дата:** 2026-05-23. **ТЗ:** `plans/tz/2026-05-23-sba-beta-1-telegram-max-zero-button-ripout.md`.
> Предыдущая версия (β-1 с slash-командами и inline-кнопками) — `plans/archive/2026-05-21-sba-beta-1-channels-telegram-max.md` (deprecated 2026-05-23).
>
> **Что это.** Первые два внешних канала: Telegram-бот и MAX-бот (mssgr.ru). Бот — **zero-button**: никаких inline-кнопок, никаких slash-команд (кроме hard-coded `/start <token>` для deep-link). Покрывают outbound (`Notification → sendMessage`), inbound (свободный текст + voice через ASR + документы через DocumentsService), `/start <token>` и голый код linking flow.

## Адаптеры

`backend/src/modules/conversational/adapters/telegram-bot/`:
- `telegram-bot.adapter.ts` — `IChannel`-адаптер: `send`, `ingestUpdate`, intent classify + Vox ASR + DocumentsService.upload.
- `telegram-api-client.ts` — тонкий клиент Bot API (`sendMessage`, `setWebhook`, `setMyCommands` (с пустым списком), `getMe`, `deleteWebhook`, `getFile`, `downloadFile`) с throttle через Redis-bucket (`cfg.telegramBot.globalRps`). С 2026-05-26 транспорт идёт через прокси `telegram.crossmark.ru` (см. ниже «Транспорт Telegram через прокси»).
- `telegram-webhooks.controller.ts` — `POST /api/v1/webhooks/telegram-bot/:tenantId` с `X-Telegram-Bot-Api-Secret-Token` timing-safe verification. Также подписан на Redis pub/sub `conversational:channel:updated:telegram_bot` — после ротации `webhookSecret` в админке кэш `globalChannelCache` сбрасывается без рестарта.
- `telegram-proxy-admin.client.ts` (2026-05-26) — REST-клиент к админ-API прокси: `login()` с JWT-кэшем в Redis, `upsertBot()`, `getBotByToken()`, `apiRequest()` с retry-on-401, `ping()`.
- `telegram-proxy-health.cron.ts` (2026-05-26) — раз в `TELEGRAM_PROXY_HEALTH_INTERVAL_SEC` секунд (default 30) пингует прокси, пишет `tg:proxy:healthy` в Redis. Лидер-выбор по `SET NX EX`.
- `telegram.types.ts` — типизированный subset Update / Message / Voice / Document / SendMessage. Без `reply_markup`, без `callback_query`, без `BotCommand`.
- `SMOKE.md` — инструкция ручного smoke на проде.
- `telegram-bot.adapter.spec.ts` — unit-тесты (`/start <token>`, голый код, voice → ASR, document → upload, free text classify, rate-limit, незалинкованный юзер).
- `telegram-api-client.spec.ts`, `telegram-proxy-admin.client.spec.ts`, `telegram-webhooks.controller.spec.ts` — модульные тесты transport / proxy / pub-sub invalidation.

### Транспорт Telegram через прокси (2026-05-26)

> ТЗ: [plans/tz/2026-05-26-telegram-via-crossmark-proxy.md](../../plans/tz/2026-05-26-telegram-via-crossmark-proxy.md).

Z живёт в ДЦ Новосибирска. Прямые исходящие к `api.telegram.org` и
входящие webhook'и от Telegram нестабильны/недоступны (региональные
блокировки). Решение — пустить весь Telegram-трафик через сервис-прокси
`https://telegram.crossmark.ru`.

**Outbound** (Z → Telegram). `TelegramApiClient.call()` строит URL через
`resolveApiBase()`: при `TELEGRAM_PROXY_ENABLED=true` (default в проде)
— `cfg.telegramProxy.apiBase` (`telegram.crossmark.ru`), иначе legacy
`cfg.telegramBot.apiBase` (`api.telegram.org`). Прокси прозрачный по
форматам запросов/ответов — каждый Bot API метод и каждый Content-Type
(включая `multipart/form-data`).

**Inbound** (Telegram → Z). Прокси регистрирует у Telegram свой URL
`/webhook/<secret>`, принимает Update и форвардит на наш
`targetWebhookUrl` (`POST /api/v1/webhooks/telegram-bot`), проставляя
`X-Telegram-Bot-Api-Secret-Token`. Прокси гарантирует до 3 ретраев с
возрастающей задержкой на не-2xx нашего ответа. Наш контроллер
верифицирует секрет через `timingSafeEqual`.

**Регистрация бота в прокси.** Автоматическая — при первом
`PUT /admin/system/telegram-bot/token` (кнопка «Установить токен»
в админке) backend сам генерирует `webhookSecret` (если ещё не было) и
вызывает `TelegramProxyAdminClient.upsertBot` через
`autoRegisterInProxy`. Прокси дёргает `setWebhook` у Telegram —
дополнительных действий админ-у не требуется. Если прокси упал в
момент регистрации, токен всё равно сохраняется, ошибка пишется в
`Channel.config.proxyLastSyncError`, юзер видит её в карточке
«Прокси» админ-страницы и может ретрайнуть кнопкой «Перенастроить
webhook» (`PUT /webhook` → тот же `upsertBot` + ротация
webhookSecret).

Альтернатива (для bootstrap'а старого прода или если веб-админка
недоступна) — patch-скрипт `patch-telegram-register-in-proxy.ts`
(идемпотентен, регистрируется в `apply-prod-deploy.ts` Шаг 6.11).

**Аутентификация в админ-API прокси.** Через `POST /auth/login` JWT;
кэшируется в Redis (`tg:proxy:admin:jwt`) с TTL ≈ `exp - prefetchSec`.
Креды (`TELEGRAM_PROXY_ADMIN_EMAIL/PASSWORD`) — в ENV, не в БД (уровень
инфры).

**Кэш канала и ротация secret'а.** `TelegramWebhooksController` держит
`globalChannelCache` в памяти процесса. При любой мутации
`Channel.config` (token, webhook, status, templates)
`AdminTelegramBotService` публикует в Redis pub/sub топик
`conversational:channel:updated:telegram_bot`; контроллер сбрасывает
кэш и при следующем webhook'е делает свежий `findFirst`. Без этого
после ротации `webhookSecret` входящие webhook'и продолжали бы
проверяться против старого секрета до рестарта.

**Метрики.**
- `telegram_proxy_request_total{api_method, outcome}` — outcome ∈ `ok | proxy_5xx | proxy_4xx | telegram_5xx | telegram_4xx | network`. Различают «прокси сам упал» (JSON-ответ не Telegram-формата) vs «Telegram через прокси вернул ошибку».
- `telegram_proxy_request_duration_seconds{api_method}` — histogram.
- `telegram_proxy_health_check_total{outcome}` — `ok | fail` (раз в 30 секунд).

**Аварийный rollback на прямой Telegram.** Переменная
`TELEGRAM_PROXY_ENABLED=false` + рестарт backend → outbound идёт в
`api.telegram.org` (legacy), `setWebhook` дёргает наш бэк. Inbound при
этом не дойдёт пока прокси настроен у Telegram, нужно либо
зарегистрировать webhook напрямую (через legacy CLI
`setup-telegram-bot.ts`), либо смириться, что бот «слепо-глухой» на
исходящие до восстановления прокси.

**Известное ограничение.** `modules/ingest/adapters/telegram/*` —
per-source бот для ingest. В прокси-режиме `setWebhook` для бота, не
зарегистрированного в прокси, вернёт 401/403. На основной conversational-flow
(`@kora_bot`) это не влияет — для него регистрация в прокси выполняется
patch-скриптом или через админку.

`backend/src/modules/conversational/adapters/max-bot/` — то же для MAX (api base `https://platform-api.max.ru`):
- `max-bot.adapter.ts` / `max-api-client.ts` (включая `downloadAttachment`) / `max-webhooks.controller.ts` / `max.types.ts` (без MaxCallback и MaxInlineKeyboard*).
- MAX webhook не использует header-secret → secret встроен в path (`/api/v1/webhooks/max-bot/:tenantId/:secret`).
- Voice/document вытаскиваются из `body.attachments[]` (defensive-парсинг по `type`, `payload.url`, `payload.duration`, `payload.file_size`).

## CommandHandlerService — УДАЛЁН

В β-1 zero-button (2026-05-23) `command-handler.service.ts` удалён вместе с типом `'command'` в `InboundMessage`. Slash-команды (`/status`, `/myideas`, `/help`, `/ask`, `/note`, `/idea`, `/link`) больше не существуют. Все запросы от пользователя обрабатываются через intent classification: вопросы (определяются эвристикой/LLM) уходят в `chat_query` → ChatV2, остальные — в `free_note` → `ConversationalIngestAdapter`.

## Inbound маршрутизация (`TelegramBotChannelAdapter.ingestUpdate`)

| Сценарий | Тип InboundMessage | Дальше |
|---|---|---|
| `/start <code>` (deep-link, hard-coded handler) | `null` (адаптер обрабатывает сам) | `linkCode.consume` → upsert `ChannelBinding` |
| `/start` без аргумента | `null` | приветствие |
| голый 6–32 hex/digit код в первом сообщении | `null` | `linkCode.consume` → binding (если binding ещё нет) |
| voice/audio (`message.voice`) | `chat_query` или `free_note` | `getFile` → `downloadFile` → Vox ASR → intent classify |
| document (`message.document`, PDF/DOCX/MD/TXT, ≤20 МБ) | `null` | `getFile` → `DocumentsService.upload` → document.adapter pipeline |
| reply на наше outbound-сообщение | `response` (match по `NotificationDelivery.externalMessageId`) | → `respondToProbe` |
| свободный текст (вопрос/утверждение) | `chat_query` или `free_note` | `QueryClassifierService.classify` → ChatV2 или ingest |
| photo без caption | `null` + reply «изображения не поддерживаются» | — |
| voice spam (>10/час/user) | `null` + reply «слишком много» | Redis-bucket |
| document >20 МБ | `null` + reply «слишком большой» | — |

## Intent classification

Зависит от `BOT_INTENT_CLASSIFIER_ENABLED`:
- `true` (default) — вызывает `QueryClassifierService.classify()` (LLM `taskType='dialog-classify'` с эвристическим pre-фильтром). Маппинг `DialogIntent → InboundIntent`: `factual|exploratory|analytical|clone_roleplay → chat_query`, прочее → `free_note`. На LLM throw — fallback на эвристики.
- `false` — сразу эвристики.

**Эвристика:** вопросительный знак `?` или start-with «как/что/почему/зачем/кто/где/когда/сколько/какой/какая/какое/какие» → `chat_query`. Иначе → `free_note`.

Метрика `bot_intent_classified_total{channel, intent, source}` фиксирует источник решения (`llm` vs `heuristic`).

## InboundMessage в β-1 zero-button

`InboundMessage` сужено до 3 типов (см. `backend/src/modules/conversational/types/channel.types.ts`):
```ts
type InboundMessage =
  | { type: 'free_note';  userId; tenantId; text; metadata?; originChannelBindingId? }
  | { type: 'response';   userId; tenantId; notificationId; payload; originChannelBindingId? }
  | { type: 'chat_query'; userId; tenantId; question; conversationId?; originChannelBindingId? };
```
Удалён тип `'command'` (β-1 rip-out 2026-05-23). Любые prom-конфиги, ENV или другие места, ссылающиеся на `commandName` / `commandHandler` / `subscribeInbound('command', ...)`, тоже удалены.

## ENV (β-1, актуальное)

- `TELEGRAM_BOT_API_BASE=https://api.telegram.org`
- `TELEGRAM_BOT_GLOBAL_RPS=25`
- `MAX_BOT_API_BASE=https://platform-api.max.ru`
- `MAX_BOT_GLOBAL_RPS=25`
- `BOT_VOICE_ENABLED=true`         — master-flag voice inbound (через ASR Vox).
- `BOT_DOCUMENT_ENABLED=true`      — master-flag document inbound (PDF/DOCX/MD/TXT).
- `BOT_INTENT_CLASSIFIER_ENABLED=true` — true: LLM + эвристика; false: только эвристика.

Per-tenant `botToken` + `webhookSecret` хранятся в `Channel.config` зашифрованными через `CryptoService.encrypt` (формат `gcm:v1:...`). Setup-скрипты (`bun run setup:telegram-bot` / `setup:max-bot`) шифруют их при upsert'е.

## Метрики (β-1 zero-button)

Существующие (без изменений):
- `telegram_bot_api_errors_total{api_method, code}` — counter.
- `telegram_bot_webhook_received_total{type}` — counter (`message`/`edited_message`/`unknown`).
- `max_bot_api_errors_total{api_method, code}` — counter.
- `max_bot_webhook_received_total{type}` — counter.

Новые (rip-out 2026-05-23):
- `bot_inbound_total{channel, kind}` — counter; `channel ∈ telegram_bot|max_bot`; `kind ∈ text|voice|document|start_command|link_code|other`.
- `bot_voice_asr_duration_seconds{channel}` — histogram; длительность ASR voice от бота.
- `bot_intent_classified_total{channel, intent, source}` — counter; `intent ∈ chat_query|free_note`; `source ∈ llm|heuristic`.

Базовые `conversational_*` метрики работают автоматически.

## Зависимости модуля

`ConversationalModule` теперь импортирует `DocumentsModule` (для `DocumentsService.upload` из адаптеров). Адаптеры также инжектят:
- `VoxService` — экспортируется `@Global AiModule` (поднят из WorkersModule в HTTP-side для адаптеров).
- `QueryClassifierService` — экспортируется `@Global DialogLayerModule`.

## Setup-скрипты

- `bun run setup:telegram-bot -- --token <BOT_TOKEN> --tenant-id <tenantId> --public-host-url <url> [--webhook-secret <secret>]` — webhook без `callback_query`, `setMyCommands([])` (очищает menu).
- `bun run setup:max-bot -- --token <ACCESS_TOKEN> --tenant-id <tenantId> --public-host-url <url> [--webhook-secret <secret>]`.

Idempotent — upsert по `(tenantId, kind)`. Шифруют секреты совместимо с `CryptoService`.

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

---

# β-9 — Глобальный Telegram-бот + GitHub-style приглашения (реализовано 2026-05-25)

> **Дата фиксации ТЗ:** 2026-05-25. **ТЗ:** [plans/tz/2026-05-25-telegram-bot-global-and-invites.md](../../plans/tz/2026-05-25-telegram-bot-global-and-invites.md). **Статус:** реализовано в коммитах `d011831` (backend, фазы 1+2+3) и `913dd1e` (UI + admin, фазы 4+5+6). 4-волновая оркестрация — рефлексия в [`05_история/2026-05-25-β-9-orchestration.md`](../05_история/2026-05-25-β-9-orchestration.md). Smoke-инструкция — `backend/src/modules/conversational/adapters/telegram-bot/SMOKE.md`.

**Что меняет:**
- `Channel` для kind `telegram_bot` становится **глобальным** (один на всю платформу, без `tenantId`). Все клиенты пользуются одним нашим ботом `@kora_bot`. Per-tenant ботов больше нет.
- Главный администратор Z настраивает бота через **админскую панель** (не через CLI-скрипт). Скрипт `setup:telegram-bot` остаётся как резервный путь.
- Приглашение сотрудника в Org переписано в стиле GitHub: одно письмо содержит **magic-link** в кабинет + **deep-link для Telegram-бота**. Сотрудник кликает — и попадает либо в веб, либо в бот, без логина/пароля.
- Сотрудник без почты — поддержан: директор копирует ссылку приглашения и пересылает руками. Вход в кабинет такого сотрудника — через бот.
- Срок жизни приглашения 7 дней → **14 дней**, с автонапоминаниями (на 7-й день сотруднику, на 14-й — директору).
- TTL `linkCode` 10 минут → **30 дней для invite-кода** (отдельный класс кодов, не для ручной привязки, а для one-click из письма/ссылки).
- Защита «один пользователь = одна компания» — на уровне `OrgInvitationsService` и `accountsService.registerFromInvite`.

**Что НЕ меняет:**
- Внутренний адаптер `telegram-bot.adapter.ts`, intent classification, voice/document inbound, метрики — остаются как в β-1.
- Архитектура `Notification` / `NotificationDelivery` / `ChannelBindingPreferences` — не меняется.
- MAX-бот остаётся per-tenant (как сейчас), это решение только про Telegram.

[[../index|← index]]
