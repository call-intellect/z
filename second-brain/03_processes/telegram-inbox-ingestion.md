---
name: telegram-inbox-ingestion
title: Входящие сообщения из Telegram (заметка → память компании)
trigger_type: webhook
status_overall: partial
last_audited: 2026-05-29
owners_human:
  - продакт conversational-каналов
related_plans:
  - plans/tz/2026-05-21-sba-alpha-1-channels-foundation.md
  - plans/tz/2026-05-21-sba-beta-1-channels-telegram-max.md
related_projects:
  - 01_projects/conversational-channels.md
  - 01_projects/feedback.md
  - 01_projects/ingest-and-sources.md
---

# Входящие сообщения из Telegram

> **Как читать:** разделы 1–4 — для не-программиста. Раздел 5 — для разработчика. Номера шагов синхронизированы.

## 1. О чём это (бытовой рассказ)

У платформы Z есть глобальный Telegram-бот (`@kora_bot`), который служит **дополнительным входом** в память компании. Идея простая: сотрудник не всегда сидит у компьютера. Он может на ходу записать голосовое — «слушай, был у клиента, обещали платить до пятницы» — или скинуть PDF договора, или ответить на вопрос-проб от платформы прямо в чате. Всё это должно попасть в память компании ровно так же, как если бы он зашёл на сайт и ввёл это вручную.

Бот **никогда не пишет первым** — он отвечает только когда сотрудник сам что-то прислал. Это принципиальное правило: бот — не спамер, не уведомлятор-навязчивый. Он канал ввода, через который удобно поделиться мыслью голосом, файлом или текстом.

**Важно (расхождение с задумкой):** сейчас часть цепочки **не дотянута до конца**. Webhook принимается, привязка пользователя работает, голос распознаётся, документы загружаются, **ответы на вопросы-пробы доходят до графа знаний**. Но **свободная текстовая заметка**, написанная в боте просто как сообщение, **в граф знаний не попадает** — обработчик `free_note` не зарегистрирован, сообщение только пишется в лог. Это критичный gap, и он зафиксирован в разделе 8.

## 2. Что запускает (триггер)

- **Тип:** внешний вебхук от Telegram (Bot API через прокси `telegram.crossmark.ru`).
- **Что инициирует:** пользователь шлёт сообщение боту — текст, голос, документ, фото, ответ-реплай.
- **Технический источник:** `POST /api/v1/webhooks/telegram-bot` (глобальный, β-9) или legacy `POST /api/v1/webhooks/telegram-bot/:tenantId`.

## 3. Шаги процесса (общий список)

1. **Telegram отправляет Update в наш webhook**, бот проверяет подпись.
2. **Платформа узнаёт, какому пользователю и какой компании принадлежит этот чат** (binding `telegram-chatId ↔ userId ↔ orgId`).
3. **Сообщение классифицируется** — это команда (`/start`, `/login`), голос, документ, фото, ответ-реплай на наш вопрос или свободный текст?
4. **Голос распознаётся** в текст (Vox ASR), документ загружается в библиотеку, текст и ответы-реплаи маркируются как тип события.
5. **Свободная заметка должна стать сырым событием** для графа знаний (`RawEvent` с `sourceType='conversational'`) — **сейчас этот шаг прерывается на свободном тексте** (обработчик не зарегистрирован).
6. **Если это ответ на вопрос-пробу** от специалиста Слоя 3 — ответ записывается в `Notification`, эмитится событие, специалист его обрабатывает.
7. **Бот отвечает пользователю** (если уместно): подтверждение привязки, ASR-расшифровка для голоса, magic-link для логина. Свободному тексту — не отвечает по умолчанию.

## 4. Что получается на выходе

- **Голос** → распознанный текст → дальше как любая заметка (если бы цепочка работала до конца — попал бы в граф знаний).
- **Документ (PDF/DOCX/MD/TXT ≤20 МБ)** → лежит в библиотеке компании, проходит document-ingest → попадает в граф знаний через свой pipeline (`document.adapter`).
- **Ответ на пробу** → записан в `Notification`, специалист 3-X обработал, факт попал в граф (Decision/Insight/Idea).
- **Свободный текст** → **сейчас никуда** (только в DEBUG-лог). Должно быть → `RawEvent` → `IdeaBlock` через тот же конвейер, что и встреча.
- **Видно пользователю:** в Z — в карточке клиента / реестре решений / на радаре проблем (в зависимости от содержимого). В Telegram — подтверждение или расшифровка.

## 5. Технический разрез (по шагам)

| # | Шаг | Что делает технически | Где живёт код | Очередь / cron / эндпоинт | Записывает в БД | Статус |
|---|---|---|---|---|---|---|
| 1 | Telegram webhook | Контроллер принимает Update, проверяет `X-Telegram-Bot-Api-Secret-Token` (timing-safe) против `Channel.config.webhookSecret` (расшифровка через `CryptoService`) | `backend/src/modules/conversational/adapters/telegram-bot/telegram-webhooks.controller.ts:128`, `:170` | `POST /api/v1/webhooks/telegram-bot` (глоб.) и `POST /api/v1/webhooks/telegram-bot/:tenantId` (legacy) | — | ✅ |
| 2 | Привязка чата к пользователю | По `message.from.id` ищется `ChannelBinding WHERE externalId=tgUserId AND verifiedAt NOT NULL`; находится `Membership.orgId` (первый по `joinedAt`) → `tenantId` | `backend/src/modules/conversational/adapters/telegram-bot/telegram-bot.adapter.ts:239`, `resolveTenantForBinding` | inline в `ingestUpdate` | `ChannelBinding` (если новый `/start <code>`) | ✅ |
| 3 | Парсинг и роутинг типа сообщения | Switch по типу: `/start <code>` или 6–32 hex → `handleStart/handleLinkCode`; `/login` → magic-link через `AccountsService`; `voice`/`audio` → `handleVoice`; `document` → `handleDocument`; reply на нашу outbound → `tryMatchReplyToProbe`; свободный текст → `classifyIntent` (LLM `dialog-classify` + эвристика) | `telegram-bot.adapter.ts:239..559` | inline | — | ✅ |
| 4а | Голос → ASR | `handleVoice` тянет файл через Bot API, шлёт в Vox; результат — текст; дальше идёт по флоу свободного текста или команды | `telegram-bot.adapter.ts (handleVoice)` | прямой вызов `VoxService` | — | ✅ (под флагом `BOT_VOICE_ENABLED`) |
| 4б | Документ → upload | `handleDocument` валидирует MIME/размер (≤20 МБ), кладёт в S3 через `DocumentsService.upload`, дальше — отдельный document-ingest pipeline | `telegram-bot.adapter.ts (handleDocument)` | `DocumentsService.upload` → document-ingest | `Document`, `DocumentSource` | ✅ (под флагом `BOT_DOCUMENT_ENABLED`) |
| 5 | Свободная заметка → RawEvent | Адаптер возвращает `InboundMessage { type: 'free_note', userId, tenantId, text, metadata }`; `ConversationalService.dispatchInbound(msg)` ищет handler типа `free_note` — **не находит**, пишет DEBUG-лог и роняет сообщение | `backend/src/modules/conversational/conversational.service.ts:741`, ожидается вызов `ConversationalIngestAdapter.ingestFreeNote` в `backend/src/modules/conversational/adapters/conversational-ingest.adapter.ts:38` | ожидается `core.raw-events` (через `RawEvent(sourceType='conversational')`) | (должно быть) `RawEvent`, `Source('Свободные заметки')` | ❌ **Telegram free_note**; ✅ in-app free-note через `POST /api/v1/me/notifications/free-note` |
| 6 | Ответ на пробу | `tryMatchReplyToProbe` находит открытый `Notification(responseStatus='pending')` по `reply_to_message.message_id`; возвращает `{ type: 'response', notificationId, payload }`; `ConversationalService.respondToProbe` обновляет Notification, эмитит `notification.responded`; ProbeModule слушает → создаёт RawEvent | `telegram-bot.adapter.ts:501,643`, `conversational.service.ts (respondToProbe)`, `probe-response.handler.ts` (`@OnEvent('notification.responded')`) | внутр. `EventEmitter`, далее `core.raw-events` | `Notification.responseStatus`, `RawEvent`, `ProbeEvent.status='dispatched'` | ✅ |
| 7 | Ответ боту | На `/start <code>` — «привязано», на голос — расшифровка + опц. подтверждение, на `/login` — magic-link; на free_note — молчание (правило «бот не пишет первым» здесь интерпретируется буквально, без подтверждения) | `telegram-bot.adapter.ts (handleStart, handleLogin, handleVoice)`, `telegram-api-client.ts` (с прокси `telegram.crossmark.ru`) | `conversational.send` (для outbound уведомлений) | — | ✅ |

### 5.1 Структура данных

```
Telegram Update
  ↓ webhook
ChannelBinding (резолв userId/orgId)
  ↓ classifyIntent / type switch
InboundMessage {
  type: free_note | chat_query | response | command,
  userId, tenantId, text|payload, metadata
}
  ↓ dispatchInbound — должен делегировать handler'у по типу
  ├── 'chat_query'  → ChatV2Service.handleChatQuery     ✅
  ├── 'response'    → ConversationalService.respondToProbe ✅
  └── 'free_note'   → ConversationalIngestAdapter.ingestFreeNote ❌ HANDLER НЕ ЗАРЕГИСТРИРОВАН
                      → RawEvent(sourceType='conversational')
                      → core.raw-events → BlockIngestWorker → IdeaBlock + специалисты
```

### 5.2 LLM-вызовы внутри процесса

| Шаг | taskType | Primary | Fallback | Где |
|---|---|---|---|---|
| 3 | `dialog-classify` | DeepSeek V4 Flash | OpenAI mini → Ollama; при отказе — эвристика | `QueryClassifierService` |
| 4а (ASR) | — | Vox (GigaAM) через `proxy.agent-lia.ru` | — | `VoxService` |
| 5 (если бы работало) | `block-ingest` (тот же что у встреч) | DeepSeek V4 Flash | OpenAI mini → Ollama | `block-ingest.worker.ts` |

## 6. Точки отказа и наблюдаемость

**Prometheus метрики:**
- `conversational_telegram_webhooks_total{status}` — приём вебхуков
- `conversational_inbound_total{tenant_top, type}` — типы входящих сообщений
- `conversational_send_total{channel, status}` — исходящие в Telegram
- `vox_asr_calls_total{status}` — распознавание голоса

**BullMQ очереди:**
- `conversational.send` — исходящие сообщения (ответы, уведомления, пробы)
- `core.raw-events` — обработка `RawEvent` (когда `free_note` начнёт сюда попадать)

**Логи:** `TelegramBotAdapter`, `ConversationalService`, `TelegramWebhooksController`, `VoxService`.

**Известные грабли:**
- Telegram прокси `telegram.crossmark.ru` (с 2026-05-26) — `TelegramApiClient.resolveApiBase()` через `TelegramProxyAdminClient`.
- Один пользователь = одна Org (см. `feedback_conversational_channels_principles`). Если у пользователя 2 Membership — берётся первый по `joinedAt`.
- Голос ≤20 МБ Telegram-лимит, обработка может уйти в долгий polling Vox (до 2 мин таймаут).

**Кнопки админки:**
- `/admin/platform/channels` — статус канала, тумблеры, ребиндинг.
- `/admin/platform/workers` → очередь `conversational.send` — посмотреть pending, retry.

## 7. Связанные процессы

- [[inapp-free-note-ingestion]] — параллельный канал ввода, у него цепочка дотянута до конца (через REST `POST /api/v1/me/notifications/free-note`).
- [[probe-question-flow]] — Шаг 6 здесь — это «обратная сторона» исходящего проба.
- [[notification-dispatch]] — Telegram также является исходящим каналом, описан отдельно.
- [[raw-event-to-graph]] — что произошло бы (и происходит для in-app), если бы free_note дотягивался до конца.
- [[email-to-task]] — родственный канал ввода (IMAP → задача).

## 8. Расхождения «задумано vs реализовано»

**Критический gap (❌):**
- **Telegram free_note не попадает в `core.raw-events`.** В `ConversationalService.dispatchInbound()` нет handler'а для типа `free_note`. Сообщение пишется в DEBUG-лог и теряется. ТЗ `2026-05-21-sba-alpha-1-channels-foundation.md` явно предполагает полную цепочку до графа. **Минимальный фикс:** зарегистрировать handler в `subscribeInbound('free_note', msg => ingestAdapter.ingestFreeNote(msg))` в инициализации `ConversationalModule`. **Рекомендованный фикс:** Вариант A в отчёте аудита.

**Заложено в ТЗ, но реализовано иначе:**
- **Команды бота сокращены.** В β-1 rip-out (2026-05-23) удалены все slash-команды, остались только `/start` (с link-code) и `/login` (β-9 magic-link). Команды `/note`, `/myideas`, `/feedback` — в ТЗ были, в коде нет.

**Не описано в ТЗ, но реализовано:**
- **Глобальный бот вместо per-tenant.** `Channel(tenantId=null, kind='telegram_bot')` — один бот на платформу, не на каждую компанию. Это решение зафиксировано в `feedback_conversational_channels_principles` и в [[01_projects/conversational-channels]].
- **Telegram прокси** через `telegram.crossmark.ru` — обход блокировок Telegram API на стороне нашего бэкенда.
- **Best-effort прерывание** — если пользователь не привязан, бот отвечает «попросите руководителя выслать ссылку-приглашение». ТЗ просто говорил «отвергнуть».

**Feedback-модуль ≠ Telegram:**
- `/feedback` команда в боте не реализована. `POST /api/v1/feedback` — отдельный REST-эндпоинт из in-app UI. Это сознательное решение (см. [[01_projects/feedback]]).

## 9. История изменений процесса

| Дата | Что изменилось | Коммит/рефлексия |
|---|---|---|
| 2026-05-29 | Карточка создана. Зафиксирован критический gap `free_note`. | этот документ |
| 2026-05-26 | Telegram-прокси `telegram.crossmark.ru` | TelegramApiClient.resolveApiBase |
| 2026-05-25 | β-9: глобальный бот `@kora_bot`, `/login` magic-link | [[01_projects/conversational-channels]] |
| 2026-05-23 | β-1: rip-out slash-команд | [[01_projects/conversational-channels]] |
