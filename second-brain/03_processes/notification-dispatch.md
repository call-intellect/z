---
name: notification-dispatch
title: Доставка уведомления через предпочитаемый канал
trigger_type: event
status_overall: implemented
last_audited: 2026-05-29
owners_human:
  - продакт conversational-каналов
related_plans:
  - plans/archive/2026-05-21-sba-alpha-1-channels-foundation.md
  - plans/archive/2026-05-21-sba-beta-1-channels-telegram-max.md
related_projects:
  - 01_projects/conversational-channels.md
---

# Доставка уведомления через предпочитаемый канал

> **Как читать:** разделы 1–4 — для не-программиста. Раздел 5 — для разработчика. Номера шагов синхронизированы.

## 1. О чём это (бытовой рассказ)

Внутри платформы Z постоянно что-то происходит: подошёл сводный отчёт операционного директора, появился вопрос-проб от специалиста («у клиента Y нет адреса электронной почты, можешь уточнить?»), готов AI-отчёт встречи, кто-то упомянул сотрудника в комментарии к задаче. Каждое такое событие платформа должна **донести до конкретного человека**, и сделать это так, как он сам предпочитает: кому-то — в чате внутри платформы, кому-то — в Telegram, кому-то — на емейл.

Этот процесс — общий «почтальон» платформы. Любой модуль, который хочет известить пользователя, не пишет в Telegram или email напрямую — он зовёт `sendNotification(...)`, дальше «почтальон» сам решает:
- какие каналы вообще есть у пользователя (привязанные Telegram, подключенный email и т.д.);
- какие из них уважают чувствительность данных (sensitive-данные не уйдут в Telegram, если канал на это не настроен);
- какой канал предпочтительнее для этого типа события (например, для пробных вопросов сначала Telegram, потом MAX, потом внутри платформы);
- не молчит ли пользователь в «тихие часы» (для не-критичных уведомлений);
- не упёрся ли он в лимит частоты («не больше 10 уведомлений в час»).

Если ни один внешний канал не подошёл — почтальон всегда положит сообщение **во внутренний канал «in-app»** (внутри веб-кабинета), чтобы человек хотя бы там увидел. In-app — обязательный канал, он создаётся автоматически.

После отправки почтальон отслеживает: доставлено? прочитано? ответ получен? — всё это видно в карточке уведомления и в исторических метриках.

## 2. Что запускает (триггер)

- **Тип:** программное событие изнутри платформы.
- **Что инициирует:** другой сервис вызывает `ConversationalService.sendNotification(...)`. Примеры: COO-дайджест ([[coo-daily-digest]]), пробный вопрос ([[probe-question-flow]]), AI-ответ чата (chat-v2), reminder события календаря.
- **Технический источник:** `ConversationalService.sendNotification(input: SendNotificationInput)`.

## 3. Шаги процесса (общий список)

1. **Любой сервис формирует уведомление**: указывает получателя, тип события, payload, чувствительность данных, опц. срок жизни.
2. **Почтальон создаёт `Notification` в БД** и валидирует payload по схеме типа события.
3. **Гарантирует, что у пользователя есть внутренний канал** (`in_app`) — создаёт `Channel` и `ChannelBinding`, если их ещё нет.
4. **Собирает все привязанные каналы** этого пользователя в этой Org, фильтрует выключенные.
5. **Применяет per-eventType политику** — список приоритетных типов каналов; вызывающий может перебить через `preferredChannelKinds`.
6. **Прогоняет каждый кандидат через фильтры**: чувствительность данных, разрешённые типы событий, тихие часы, отключения, rate-limit пользователя.
7. **Для каждого прошедшего канала создаёт `NotificationDelivery`** и ставит задачу в очередь `conversational.send`.
8. **Worker** забирает задачу, по `ChannelKind` находит адаптер канала (`InApp`, `EmailSmtp`, `TelegramBot`, `MaxBot`), вызывает `adapter.send(...)`.
9. **На успех помечает `delivered`**, на ошибку — retry с экспоненциальной задержкой до 1 часа, после `maxDeliveryAttempts` — `failed`.
10. **Пересчитывает `Notification.status`** по агрегату всех доставок (`delivered` / `sent_partial` / `read` / `responded` / `failed`).

## 4. Что получается на выходе

- **Запись в БД:**
  - `Notification(eventType, payload, dataClass, status, responseStatus, expiresAt, ...)`.
  - `NotificationDelivery` × N (по числу выбранных каналов), у каждого — `status`, `attempts`, `attemptedAt`, `deliveredAt`, `readAt`, `respondedAt`, `errorReason`.
- **В каналах:**
  - In-app: запись становится видна на странице `/me/notifications` сразу (без external transport).
  - Email: письмо отправлено через общий SMTP (`MailService`), тема и тело — по `eventType`-шаблону.
  - Telegram / MAX: сообщение отправлено боту, ответ-реплай парсится обратно (см. [[probe-question-flow]] и [[telegram-inbox-ingestion]]).
- **Видно пользователю:**
  - `/me/notifications` — список с фильтрами «все / непрочитанные / ждут ответа».
  - `/me/notifications/[id]` — карточка одного уведомления + история доставок (`NotificationDelivery.attempts/status`).
  - `/me/channels` — какие каналы подключены и их настройки.

## 5. Технический разрез (по шагам)

| # | Шаг | Что делает технически | Где живёт код | Очередь / cron / эндпоинт | Записывает в БД | Статус |
|---|---|---|---|---|---|---|
| 1 | Вызов sendNotification | Public API `ConversationalService.sendNotification({ tenantId, recipientUserId, eventType, payload, dataClass?, contextBlockId?, contextCardId?, expiresAt?, critical?, preferredChannelKinds?, subjectPersonId? })` | `backend/src/modules/conversational/conversational.service.ts:167..270` | прямой вызов | — | ✅ |
| 2 | Валидация payload + создание Notification | `validateEventPayload(eventType, payload)` (Zod-схема per eventType из `event-payload.registry`); `prisma.notification.create({ data: { ..., responseStatus: eventType==='probe.question' ? 'pending' : null } })` | `backend/src/modules/conversational/conversational.service.ts:170..198`, `backend/src/modules/conversational/types/event-payload.registry.ts` | inline | `Notification` | ✅ |
| 3 | ensureInAppForUser | `Channel.upsert({ where: { tenantId_kind: { tenantId, kind: 'in_app' } } })` + `ChannelBinding.upsert({ where: { channelId_externalId: { channelId, externalId: userId } } })` — гарантирует in-app как fallback | `backend/src/modules/conversational/conversational.service.ts:813..838` | inline | `Channel`, `ChannelBinding` (только на первом вызове для юзера) | ✅ |
| 4 | resolveBindings | `prisma.channelBinding.findMany({ userId, verifiedAt: { not: null }, channel: { tenantId, status: 'active' } }, include: { channel } })` | `backend/src/modules/conversational/conversational.service.ts:794..806` | inline | (read-only) | ✅ |
| 5 | Per-eventType policy | `EVENT_TYPE_CHANNEL_POLICY[eventType] ?? DEFAULT_POLICY=['in_app']`; `preferredChannelKinds` из вызова перебивает. 11 зарегистрированных типов (probe.question, curation.pending, system.message, idea.status_changed, chat.answer, specialist.probe, proactive.notification, operations.weekly_digest, issue.mention, event.reminder + DEFAULT) | `backend/src/modules/conversational/conversational.service.ts:83..111` | inline | — | ✅ |
| 6 | selectBindingsForNotification | Фильтр кандидатов: (a) `DataClassPolicyService.canEmit({ payload, sink, effectiveMax=min(Channel.maxDataClass, ChannelBinding.maxDataClass) })` или legacy lattice; (b) `policySet.has(ch.kind)`; (c) preferences (eventTypeAllow/Deny, disabledUntil); (d) quietHours (не для critical); fallback `in_app` если selected пустое | `backend/src/modules/conversational/conversational.service.ts:848..942` | inline | — | ✅ |
| 7 | Создание NotificationDelivery + enqueue | Для каждого выбранного binding'а: `prisma.notificationDelivery.create({ data: { notificationId, channelBindingId } })`, `queue.enqueueSend({ deliveryId })`; метрика `conversational_deliveries_total{kind, status='queued'}` | `backend/src/modules/conversational/conversational.service.ts:247..264`, `backend/src/modules/conversational/queue/conversational-queue.service.ts` | очередь `conversational.send` | `NotificationDelivery` × N | ✅ |
| 8 | Worker → adapter.send | `ConversationalSendWorker.process(job)` загружает delivery с notification + binding + channel, по `channel.kind` берёт адаптер через `ChannelRegistry.get(kind)`, вызывает `adapter.send({ delivery, notification, binding, channel })` | `backend/src/modules/conversational/queue/conversational-send.worker.ts:86..175`, `backend/src/modules/conversational/channel-registry.ts` | worker очереди `conversational.send` (concurrency = `cfg.conversational.outboundConcurrency`) | — (адаптер возвращает `externalMessageId`) | ✅ |
| 8a | InApp adapter | no-op: возвращает `externalMessageId: null` — никакого external transport, UI читает Notification из БД через REST | `backend/src/modules/conversational/adapters/in-app.adapter.ts:48..61` | — | (worker обновит delivery) | ✅ |
| 8b | EmailSmtp adapter | `MailService.sendPlain({ to: binding.externalId, subject: subjectFor(eventType), text: renderPlainText(notification), template: 'conversational/{eventType}' })`; subject/body — русские шаблоны per eventType с deep-link на `/me/notifications/[id]` | `backend/src/modules/conversational/adapters/email-smtp.adapter.ts:51..160` | прямой вызов MailService | (worker обновит delivery) | ✅ |
| 8c | TelegramBot adapter | `TelegramApiClient.sendMessage(...)` через прокси `telegram.crossmark.ru`; форматирование payload + опц. `reply_markup` (inline-кнопки для probe-вопросов) | `backend/src/modules/conversational/adapters/telegram-bot/telegram-bot.adapter.ts`, `telegram-api-client.ts` | прямой HTTP через прокси | (worker обновит delivery) | ✅ |
| 8d | MaxBot adapter | `MaxApiClient.send(...)` (российский мессенджер MAX); по аналогии с Telegram | `backend/src/modules/conversational/adapters/max-bot/max-bot.adapter.ts` | прямой HTTP | (worker обновит delivery) | ✅ |
| 9 | Успех / retry / failed | Success: `delivery.update({ status: 'delivered', deliveredAt, externalMessageId, attempts+1 })`. Exception: `newAttempts < maxDeliveryAttempts` → enqueue retry с backoff `2^attempts × 1000ms, cap 60min`; иначе `markDeliveryFailed(errorReason)` | `backend/src/modules/conversational/queue/conversational-send.worker.ts:121..193` | re-enqueue в `conversational.send` (delayMs) | `NotificationDelivery.status` | ✅ |
| 10 | recomputeNotificationStatus | После каждого изменения delivery: groupBy `status`, выбор `NotificationStatus` (`responded > read > delivered > sent_partial > failed > queued`); `prisma.notification.update({ status })` + метрика | `backend/src/modules/conversational/queue/conversational-send.worker.ts:195..228` | inline | `Notification.status` | ✅ |

### 5.1 Структура данных

```
Caller (любой сервис: COO-digest / Probe / chat-v2 / calendar / tracker)
  ↓ ConversationalService.sendNotification({ tenantId, recipientUserId, eventType, payload, dataClass })
Notification.create
  ↓ ensureInAppForUser (Channel + ChannelBinding lazy)
  ↓ resolveBindings (active, verified)
  ↓ EVENT_TYPE_CHANNEL_POLICY[eventType] ?? DEFAULT
  ↓ selectBindingsForNotification (dataClass gate + preferences + quietHours + rate-limit?)
  └── для каждого выбранного:
       NotificationDelivery.create
       ↓ conversational.send (BullMQ)
       ConversationalSendWorker.process
       ↓ ChannelRegistry.get(channel.kind)
       ├── InAppChannelAdapter        → no-op
       ├── EmailSmtpChannelAdapter    → MailService.sendPlain
       ├── TelegramBotChannelAdapter  → TelegramApiClient (proxy)
       └── MaxBotChannelAdapter       → MaxApiClient
            ↓ success/exception
            NotificationDelivery.status = delivered | failed (+ retry с backoff)
            ↓
            recomputeNotificationStatus → Notification.status
```

### 5.2 LLM-вызовы внутри процесса

Самый дispatcher LLM не вызывает. Формирование payload (например, `probe-formulate` для `probe.question`) — задача вызывающего сервиса до `sendNotification`. Email-рендер — детерминированный switch по eventType, без LLM (`backend/src/modules/conversational/adapters/email-smtp.adapter.ts:105..156`).

## 6. Точки отказа и наблюдаемость

**Prometheus метрики** (`backend/src/common/metrics/business-metrics.service.ts:1218..1244`):
- `conversational_notifications_total{event_type, status}` — Counter, status ∈ `queued|sent_partial|delivered|read|responded|failed`.
- `conversational_deliveries_total{kind, status}` — Counter, status ∈ `queued|retrying|delivered|failed`.
- `conversational_inbound_total{kind, type}` — incoming (не для этого процесса, но в той же кучке).
- `conversational_link_attempts_total{kind, status}` — привязка каналов.
- `conversational_response_time_seconds{kind, event_type}` — Histogram, время ответа на probe.

**BullMQ очереди:**
- `conversational.send` — главная очередь dispatcher'а; видна в `/admin/platform/workers`.

**ENV / тумблеры:**
- `cfg.conversational.outboundConcurrency` — параллельная обработка job'ов одним worker'ом.
- `cfg.conversational.maxDeliveryAttempts` — потолок ретраев.
- `cfg.conversational.quietHoursDefault` — окно «не отправлять» (TZ серверная; локализация per-юзер — задача β+).

**Логи:** `ConversationalService`, `ConversationalSendWorker`, `InAppChannelAdapter`, `EmailSmtpChannelAdapter`, `TelegramBotChannelAdapter`, `MaxBotChannelAdapter`, `ChannelRegistry`.

**Известные грабли:**
- **`UserChannelPreference` как отдельная модель не существует.** Предпочтения хранятся в `ChannelBinding.preferences` (Json) и валидируются `ChannelBindingPreferencesSchema` (zod). Это per-binding, не per-user.
- **Quiet hours не локализованы по таймзоне юзера.** Используется серверная TZ через `cfg.conversational.quietHoursDefault`. На α-1 — допустимо, в β+ — расширить.
- **`DataClassPolicyService` опционален** (`@Optional()`). Если не инжектится — fallback на legacy lattice по `effectiveMax = min(Channel.maxDataClass, ChannelBinding.maxDataClass)`. В тестах часто этот fallback ловится.
- **`Notification.status='failed'`** при нулевом числе выбранных каналов означает либо «ensureInAppForUser не сработал» (легаси-ветка), либо «W4.3 dataclass gate отверг все каналы, включая in_app». Запись в логах warn — единственная видимость.
- **`@Global` модули** — все четыре адаптера `InApp/EmailSmtp/TelegramBot/MaxBot` регистрируются в `ChannelRegistry` через `onModuleInit`; падение регистрации = silent для одного типа. `ChannelRegistry.require(kind)` бросает явно, `get(kind)` — `null`.

**Кнопки админки:**
- `/admin/platform/channels` (если страница есть; см. [[01_projects/admin]]) — список каналов, тумблеры, `maxDataClass`.
- `/admin/platform/workers` → очередь `conversational.send` — pending / retry / failed.
- `/me/channels` — пользовательский UI настроек binding'ов (тихие часы, eventTypeAllow/Deny, maxDataClass per-binding).

## 7. Связанные процессы

- [[coo-daily-digest]] — типовой потребитель: вызывает `sendNotification({eventType: 'operations.daily_digest', payload, dataClass: 'internal'})`.
- [[probe-question-flow]] — типовой потребитель: вызывает с `eventType='probe.question'`, рассчитывает на in-app/Telegram/MAX policy.
- [[telegram-inbox-ingestion]] — inbound-зеркало: ответ-реплай в Telegram приходит через webhook → `respondToProbe` → `Notification.responseStatus='answered'`. Этот процесс начинает цикл, тот — закрывает.
- [[inapp-free-note-ingestion]] — параллельная цепочка ingest'а, не использует dispatcher.
- [[email-to-task]] — параллельный inbound, тоже не через dispatcher.

## 8. Расхождения «задумано vs реализовано»

**Реализовано полностью:**
- Public API `sendNotification` с валидацией payload через Zod registry.
- Per-eventType policy + перебивание через `preferredChannelKinds`.
- 4 адаптера: in-app, email-smtp, telegram-bot, max-bot.
- Retry с exp-backoff (cap 1ч), `maxDeliveryAttempts`-граница.
- Агрегация `Notification.status` из множества `NotificationDelivery`.
- DataClass-gate через `DataClassPolicyService.canEmit` (W4.3) + legacy fallback.
- Fallback на `in_app` если все каналы отвергнуты.

**Реализовано иначе, чем в ТЗ:**
- **«Per-user preference» не отдельная модель.** В ТЗ упомянуто «UserChannelPreference» как сущность; на практике — `ChannelBinding.preferences: Json` (Zod-схема `ChannelBindingPreferencesSchema`, allow/deny/quietHours/disabledUntil). Это per-binding, не per-user. Намеренно упростили (каждый binding сам себе предпочтения).
- **`NotificationDispatcher` как отдельный класс не выделен.** Логика dispatch'а живёт в `ConversationalService.sendNotification + selectBindingsForNotification + ConversationalSendWorker.process`. В ТЗ упоминался `NotificationDispatcher` — на практике один сервис + один worker.
- **Quiet hours — серверная TZ.** В ТЗ — per-user TZ через Person.timezone; на проде — `cfg.conversational.quietHoursDefault`. Перенос на per-user — β+.

**Реализовано, не описано в ТЗ:**
- **`sendChatReply` (SBA α-5)** — отдельный wrapper для chat-v2 ответов с `originChannelBindingId` (приоритет тому же каналу, где задан вопрос).
- **`subjectPersonId`** в `SendNotificationInput` — W4.3, нужен для private gating (recipient ≠ subject ⇒ не private).
- **`critical`** флаг — игнорирует quiet hours и rate-limit для security-уведомлений.
- **Метрика `conversational_response_time_seconds`** — измеряет время ответа на probe, не описано в α-1.

**Не реализовано (gap):**
- **`UserChannelPreference` как глобальная модель пользователя** (per-user, не per-binding) — нет. Если у пользователя 3 binding'а (in_app, email, telegram), и он хочет «вообще не получать `idea.status_changed`», ему нужно отключить это в каждом binding'е отдельно.
- **Email-IMAP канал как полноценный `IChannel`** — нет адаптера в реестре. Email-inbound идёт через отдельный `MailInboundModule` (см. [[email-to-task]]).

## 9. История изменений процесса

| Дата | Что изменилось | Коммит/рефлексия |
|---|---|---|
| 2026-05-29 | Карточка создана. Зафиксированы расхождения по `UserChannelPreference` и `NotificationDispatcher`. | этот документ |
| 2026-05-26 | TelegramApiClient через прокси `telegram.crossmark.ru` | TelegramApiClient.resolveApiBase |
| ~2026-05-23 | β-1 zero-button — slash-команды удалены, document/voice inbound через DocumentsService/VoxService | plans/archive/2026-05-23-sba-beta-1-telegram-max-zero-button-ripout.md |
| ~2026-05-21 | SBA α-1 — модуль создан (in_app + email_smtp); β-1 добавил telegram/max | plans/archive/2026-05-21-sba-alpha-1-channels-foundation.md |
