---
name: probe-question-flow
title: Пробный вопрос от специалиста Слоя 3
trigger_type: event
status_overall: implemented
last_audited: 2026-05-29
owners_human:
  - продакт памяти компании / специалистов Слоя 3
related_plans:
  - plans/tz/2026-05-23-sba-beta-5-probe-closing-loop.md
related_projects:
  - 01_projects/probe-agent.md
  - 01_projects/conversational-channels.md
  - 01_projects/knowledge-core.md
---

# Пробный вопрос от специалиста Слоя 3

> **Как читать:** разделы 1–4 — для не-программиста. Раздел 5 — для разработчика. Номера шагов синхронизированы.

## 1. О чём это (бытовой рассказ)

Специалисты Слоя 3 — это автоматические агенты внутри памяти компании. Один разбирает решения, другой следит за повторяющимися проблемами, третий собирает идеи, четвёртый собирает Skill-профиль ролей. Они постоянно читают входящие события (встречи, заметки, переписки) и пытаются обогатить граф знаний. Иногда им не хватает данных: в карточке клиента нет суммы контракта, в реестре решений непонятно, кто отвечает за исполнение, в Skill-профиле должности явно «дырка».

В таких случаях специалист **не угадывает**. Он формирует **пробный вопрос** — короткий вопрос конкретному сотруднику, который, скорее всего, знает ответ. Например: «По решению о повышении цены — кто из вас будет писать клиентам Acme и Beta?». Этот вопрос проходит через единого «привратника» — `ProbeAgent`, — который проверяет, не задавали ли мы такой же вопрос на этой неделе, не превысили ли лимит на день, не «штурмуем» ли мы пользователя только что после деплоя.

Если вопрос проходит фильтры, его формулирует помощник (LLM делает вопрос человечнее и предлагает 2-4 варианта ответа). Дальше платформа выбирает канал по предпочтению — обычно Telegram или внутри платформы — и доставляет. Когда сотрудник отвечает (одним нажатием на вариант или коротким сообщением), ответ автоматически попадает обратно в граф знаний как новое сырое событие, специалист видит ответ и пересобирает свою карточку.

**Идея:** платформа не молчит, не пишет в стол. Если у неё есть вопрос — она спрашивает живого человека, не часто и не в неподходящее время, и тут же закрывает цикл, как только получает ответ. Это и есть «второй мозг»: не только память, но и активное любопытство к фактам.

## 2. Что запускает (триггер)

- **Тип:** программное событие (вызов специалиста Слоя 3) или cron-проверка специалистов.
- **Что инициирует:** специалист 3-X нашёл пробел/конфликт/неопределённость → зовёт `ProbeService.suggest(...)`.
- **Технический источник:** прямой вызов `ProbeService.suggest({ tenantId, emittedByService, reason, payload, recipientCandidates, priorityHint?, dataClass? })`.

## 3. Шаги процесса (общий список)

1. **Специалист 3-X решил, что не хватает данных,** формирует пробный запрос со списком возможных получателей (по навыкам / роли).
2. **`ProbeAgent` считает контент-хеш** запроса и проверяет в Redis: не задавали ли мы такой же за последние 48 часов (дедуп).
3. **Проверяет лимиты** для каждого кандидата (часовой и суточный потолок «не больше N вопросов на человека») и убирает «выбывших».
4. **Проверяет «холодный старт»** Org — если это первый probe после деплоя, может отложить.
5. **Считает приоритет** (severity × свежесть × engagement-rate) и **создаёт запись `ProbeEvent`** со статусом `pending`, ставит её в очередь.
6. **Worker `ProbeDispatcher`** забирает задачу: перепроверяет лимиты, выбирает одного получателя (round-robin), просит LLM сформулировать вопрос и варианты ответа.
7. **Вызывает `notification-dispatch`** с `eventType='probe.question'` — почтальон доставляет в канал по предпочтению (см. [[notification-dispatch]]).
8. **Помечает `ProbeEvent.status='dispatched'`**, инкрементит счётчики лимитов пользователя.
9. **Пользователь отвечает** через UI (`/me/notifications`) или reply-сообщением в Telegram.
10. **Платформа эмитит `notification.responded`**, обработчик `ProbeResponseHandler` создаёт `RawEvent(kind='notification_response')` через ingest — ответ попадает обратно в граф знаний.
11. **Cron `ProbePriorityCron`** раз в 15 минут чистит истёкшие probe'ы и пересчитывает engagement-rate (доля ответов).

## 4. Что получается на выходе

- **Запись в БД:**
  - `ProbeEvent` (с историей статусов: pending → dispatched → answered/expired/dropped_*).
  - `Notification(eventType='probe.question', responseStatus='pending')` и его `NotificationDelivery`.
  - После ответа — `RawEvent(payload.kind='notification_response', payload.respondsToNotificationId, payload.response)`.
- **В каналах:**
  - Telegram: сообщение с inline-кнопками-вариантами.
  - In-app: карточка с кнопками «Ответить / Пропустить» в `/me/notifications`.
  - Email: текстовое письмо с deep-link на `/me/notifications/[id]`.
- **Видно специалисту 3-X:** через ingest ответа RawEvent попадает в его pipeline, он обновляет свою карточку (`Decision`, `Card`, `Insight`, `Skill profile`).
- **Метрики:** `probe_events_total{status}`, `probe_response_time_seconds`, `probe_closed_total` (closing-loop) — видны в Grafana / `/admin/platform/observability`.

## 5. Технический разрез (по шагам)

| # | Шаг | Что делает технически | Где живёт код | Очередь / cron / эндпоинт | Записывает в БД | Статус |
|---|---|---|---|---|---|---|
| 1 | Вызов из специалиста | Public API `ProbeService.suggest({ tenantId, emittedByService: '3-3-decisions', reason: 'decision.overdue', payload: { message, suggestedActions, contextCardId, ... }, recipientCandidates: string[], priorityHint?: number, dataClass? })` | `backend/src/modules/probe/probe.service.ts:55..213`, вызывающие: `backend/src/modules/knowledge-core/services/specialist-3-1-probe.service.ts`, `specialist-3-2-probe.service.ts`, `specialist-3-3-probe.service.ts`, `specialist-3-5-probe.service.ts`, `backend/src/modules/specialist-3-8-helpfulness/cron/helpfulness-probe.cron.ts` | прямой вызов | — | ✅ |
| 2 | Dedup по content-hash | `sha256(reason + sorted [contextBlockId, contextCardId, ...contextIds] + payload.message).slice(0,64)`; ключ `probe:dedup:{tenantId}:{hash}` в Redis, `SET NX EX ttl`, TTL = `cfg.probe.dedupTtlHours × 3600` | `backend/src/modules/probe/probe.service.ts:70..105` (`computeContentHash` 286..299) | Redis `probe:dedup:*` | — | ✅ |
| 3 | Rate-limit фильтр кандидатов | `filterByRateLimit(recipientCandidates)`: для каждого `userId` читает Redis-ключи `probe:ratelimit:{userId}:h:{hourBucket}` и `:d:{dayBucket}`; пропускает если ОБА < лимита (`cfg.probe.rateLimitPerHour`, `rateLimitPerDay`) | `backend/src/modules/probe/probe.service.ts:221..246`, `hourKey`/`dayKey` 301..309 | Redis `probe:ratelimit:*` | — | ✅ |
| 4 | Cold-start gate | `isColdStart(tenantId)` — проверяет, есть ли уже хотя бы один `ProbeEvent` в Org; если нет — пропускаем (первый probe можно); если есть и прошло < `cfg.probe.coldStartModeHours` — drop (в текущем коде формально возвращает `false`, deploy-маркер отложен в γ+) | `backend/src/modules/probe/probe.service.ts:265..283` | — | (read-only) | ⚠️ частично — текущий код всегда `return false` (см. NB в коментарии 277..282); cold-start реально не блокирует probe'ы. |
| 5 | priority + ProbeEvent.create | `priority = Math.round(clamp01(priorityHint ?? 0.4) × 100)`; `expiresAt = now + cfg.probe.expiryDays × 24h`; `prisma.probeEvent.create({ tenantId, emittedByService, reason, payload, recipientCandidates, contentHash, priority, status: 'pending', expiresAt, dataClass })` | `backend/src/modules/probe/probe.service.ts:158..187` | inline | `ProbeEvent` | ✅ |
| 6 | enqueueProbeEvent | `CoreQueueService.enqueueProbeEvent({ probeEventId })` в очередь `core.probe-events`; если падает — лог warn, cron подберёт | `backend/src/modules/probe/probe.service.ts:189..199`, `backend/src/modules/core-queue/core-queue.service.ts:553..567` | очередь `core.probe-events` | — | ✅ |
| 7 | Worker: re-check + select recipient + LLM | `ProbeDispatcherWorker.process(job)`: загрузка ProbeEvent, проверка `status='pending'` и `expiresAt`, повторный `filterByRateLimit`, выбор `candidates[0]` (round-robin; engagement weight — γ+); LLM `probe-formulate` (taskType) → `{question, options}`; fallback на `payload.suggestedQuestion / .message` если LLM падает | `backend/src/modules/probe/probe-dispatcher.worker.ts:98..183`, `formulate` 186..255; промпт `backend/src/modules/knowledge-core/prompts/probe-formulate.prompt.ts` | worker очереди `core.probe-events`, concurrency=2 | — (готовит payload) | ✅ |
| 8 | sendNotification | `ConversationalService.sendNotification({ tenantId, recipientUserId, eventType: 'probe.question', payload: { question, options, askedBy, context, ... }, dataClass, contextBlockId, contextCardId })`; policy: `['telegram_bot', 'max_bot', 'in_app']` | `backend/src/modules/probe/probe-dispatcher.worker.ts:138..151`, policy `backend/src/modules/conversational/conversational.service.ts:84..85` | прямой вызов; далее `conversational.send` (см. [[notification-dispatch]]) | `Notification(responseStatus='pending')`, `NotificationDelivery` × N | ✅ |
| 9 | ProbeEvent → dispatched | `probeService.noteSent(userId)` (Redis INCR `:h:` и `:d:` с TTL), `prisma.probeEvent.update({ status: 'dispatched', dispatchedAt, selectedRecipientId, dispatchedNotificationId })`; метрики `probe_dispatched_total{kind: 'in_app'}` (kind пока хардкод — см. раздел 8) | `backend/src/modules/probe/probe-dispatcher.worker.ts:154..172` | Redis + БД | `ProbeEvent.status='dispatched'`, `dispatchedAt`, `selectedRecipientId`, `dispatchedNotificationId` | ✅ |
| 10 | Ответ пользователя | UI: `POST /api/v1/me/notifications/:id/respond { payload }` (`ConversationalController.respond`) → `respondToProbe`; Telegram: `tryMatchReplyToProbe(reply_to_message)` → тот же `respondToProbe` | `backend/src/modules/conversational/conversational.service.ts:349..430` (`respondToProbe`), `backend/src/modules/conversational/adapters/telegram-bot/telegram-bot.adapter.ts:1080..` (`tryMatchReplyToProbe`) | REST + Telegram webhook | `Notification.responseStatus='answered'`, `responsePayload`, `respondedAt`; `NotificationDelivery.respondedAt` | ✅ |
| 11 | Closing-loop → RawEvent | `respondToProbe` эмитит `notification.responded`; `ProbeResponseHandler.@OnEvent('notification.responded')` фильтрует `eventType.startsWith('probe.')`, находит `ProbeEvent.dispatchedNotificationId`, вызывает `ConversationalIngestAdapter.ingestNotificationResponse({ tenantId, userId, notificationId, eventType, payload, sourceChannelKind, contextBlockId, contextCardId })`; `sourceExternalId='resp:{notificationId}'` для идемпотентности | `backend/src/modules/probe/probe-response.handler.ts:36..128`, `backend/src/modules/conversational/adapters/conversational-ingest.adapter.ts:84..125` | `EventEmitter2` `notification.responded` → `core.raw-events` | `RawEvent(kind='notification_response')` | ✅ |
| 12 | Cron expire + engagement | `ProbePriorityCron.@Cron('*/15 * * * *')`: (a) `probeEvent.status='pending' AND expiresAt<now AND respondedAt IS NULL` → `expired` (учитывая closing-loop: если связанный Notification уже отвечен — НЕ помечаем); (b) пересчёт `engagement_rate = answered/sent за 30 дней` на каждого получателя, gauge `probe_recipient_engagement_rate{user_id}` | `backend/src/modules/probe/probe-priority.cron.ts:31..117` | cron `*/15 * * * *` | `ProbeEvent.status='expired'` | ✅ |

### 5.1 Структура данных

```
Специалист 3-X (decisions/insights/ideas/regulations/skill/knowledge-clone/helpfulness)
  ↓ ProbeService.suggest({ tenantId, emittedByService, reason, payload, recipientCandidates, priorityHint?, dataClass? })
  ├── computeContentHash → Redis SET NX (dedup)
  ├── filterByRateLimit → Redis GET hourKey/dayKey
  ├── isColdStart (NOOP пока, см. §8)
  └── ProbeEvent.create(status='pending', priority, expiresAt)
       ↓ core.probe-events (BullMQ)
ProbeDispatcherWorker.process
  ├── re-check rate-limit
  ├── select recipient = candidates[0]
  ├── LLM probe-formulate → { question, options[2..4] } (fallback на payload.suggestedQuestion/.message)
  └── ConversationalService.sendNotification(eventType='probe.question', payload={ question, options, askedBy, context })
       ↓ (см. notification-dispatch)
       Notification + NotificationDelivery × N
       ↓ user → POST /me/notifications/:id/respond ИЛИ Telegram reply
       respondToProbe → Notification.responseStatus='answered', emit('notification.responded')
       ↓ ProbeResponseHandler (@OnEvent)
       ConversationalIngestAdapter.ingestNotificationResponse
       ↓ sourceExternalId='resp:{notificationId}'
       RawEvent(kind='notification_response') → core.raw-events
       ↓ специалист обновит свою карточку
       Card / Decision / Insight / Idea
  ├── probeService.noteSent → INCR Redis hourKey/dayKey
  └── ProbeEvent.update(status='dispatched', dispatchedAt, selectedRecipientId, dispatchedNotificationId)
```

### 5.2 LLM-вызовы внутри процесса

| Шаг | taskType | Primary модель | Fallback | Где промпт |
|---|---|---|---|---|
| 7 | `probe-formulate` | (по таблице LLM-роутера; см. `01_projects/llm-providers-verified.md`) | code-fallback: `payload.suggestedQuestion / .message`, `suggestedOptions / .suggestedActions ?? ['Да','Нет']` | `backend/src/modules/knowledge-core/prompts/probe-formulate.prompt.ts` |

Дополнительно: специалисты 3-X сами могут вызывать LLM при формировании `payload` ДО `ProbeService.suggest`. Это часть их собственных процессов (см. карточки `specialist-3-3-decisions`, `specialist-3-5-insights` — если будут).

## 6. Точки отказа и наблюдаемость

**Prometheus метрики** (`backend/src/common/metrics/business-metrics.service.ts:1624..1675`):
- `probe_events_total{emitted_by_service, reason, status}` — Counter, status ∈ `pending|dispatched|dropped_dedup|dropped_rate_limit|dropped_cold_start|dropped_dataclass_gate|expired`.
- `probe_dispatched_total{kind}` — Counter (kind пока хардкод `'in_app'`, см. раздел 8).
- `probe_response_total{event_type, kind}` — Counter.
- `probe_dedup_dropped_total{reason}` — Counter.
- `probe_rate_limit_dropped_total` — Counter.
- `probe_cold_start_dropped_total` — Counter (всегда 0 пока, см. §8).
- `probe_expired_total` — Counter.
- `probe_closed_total{tenant_top, source}` — Counter (closing-loop, β-5 sub-TZ 2026-05-23).
- `probe_recipient_engagement_rate{user_id}` — Gauge, 0..1.
- `probe_response_time_seconds{event_type, kind}` — Histogram (через `ProbeResponseHandler.observeProbeResponseTime`).
- `core_specialist_probe_events_total` — Counter, метрика на стороне специалистов (когда они зовут `suggest`).

**BullMQ очереди:**
- `core.probe-events` (`CORE_QUEUE_NAMES.PROBE_EVENTS`) — основная очередь dispatcher'а.
- `conversational.send` — далее (см. [[notification-dispatch]]).
- `core.raw-events` — closing-loop через ingest ответа.

**Cron:**
- `ProbePriorityCron @Cron('*/15 * * * *')` — expire + engagement_rate.

**ENV / тумблеры:**
- `cfg.probe.dedupTtlHours` — TTL дедупа (default 48).
- `cfg.probe.rateLimitPerHour`, `cfg.probe.rateLimitPerDay` — лимиты.
- `cfg.probe.expiryDays` — срок жизни probe (default 14).
- `cfg.probe.coldStartModeHours` — окно cold-start (формально not enforced, см. §8).

**Логи:** `ProbeService`, `ProbeDispatcherWorker`, `ProbeResponseHandler`, `ProbePriorityCron`.

**Известные грабли:**
- **`isColdStart` всегда `false`.** В текущем коде `return elapsedMs < windowHours * 3600 * 1000 ? false : false;` (см. `probe.service.ts:278`). Cold-start реально не блокирует probe'ы; счётчик `probe_cold_start_dropped_total` инкрементится только в ветке «есть запись, но cold-start» — в нынешней логике эта ветка недостижима. См. § 8.
- **Telegram reply-парсинг хрупкий.** Если пользователь не нажимает кнопку, а пишет «да» в общий чат (без reply), это будет классифицировано как `free_note` или `chat_query` (а в Telegram free_note ещё и не имеет handler'а — см. [[telegram-inbox-ingestion]]).
- **Round-robin recipient — `candidates[0]`.** Engagement weight упомянут (γ+), но не реализован. На практике первый по сортировке `userId` всегда получает все probe'ы (если массив отсортирован детерминированно).
- **Redis SET NX без `EX` повторно** при rate-limit `noteSent`: используем `multi().incr().expire()` — это два разных commands, между ними возможен gap, в котором ключ существует без TTL (если сразу после INCR упадёт expire). Прайс — лишний день жизни счётчика. Не критично.

**Кнопки админки:**
- `/admin/platform/observability` (если есть; см. [[01_projects/admin]]) — метрики probe'ов.
- `/admin/platform/workers` → очередь `core.probe-events`.
- ProbeController (`/api/v1/probe/...`) — API для админ-разреза (`backend/src/modules/probe/probe.controller.ts`).

## 7. Связанные процессы

- [[notification-dispatch]] — общий механизм доставки; этот процесс — главный потребитель.
- [[telegram-inbox-ingestion]] — Telegram reply на наш outbound probe → `tryMatchReplyToProbe` → `respondToProbe` → закрытие цикла. **Шаг 6 там — это «обратная сторона» шага 10 здесь.**
- [[coo-daily-digest]] — параллельный потребитель `notification-dispatch`, не probe.
- [[raw-event-to-graph]] — закрытие цикла: `RawEvent(kind='notification_response')` идёт по тому же конвейеру, что и заметка.
- Specialist-карточки 3-1..3-7 (если будут) — источники `suggest(...)`.

## 8. Расхождения «задумано vs реализовано»

**Реализовано полностью:**
- Pipeline `suggest → ProbeEvent → dispatcher → sendNotification` работает на проде.
- Dedup через Redis SET NX EX с контент-хешем.
- Per-user rate-limit (часовой + суточный).
- LLM-формулирование вопроса с code-fallback на `suggestedQuestion / message / suggestedOptions`.
- Closing-loop: ответ → `RawEvent(kind='notification_response')` → обратно в граф (β-5 sub-TZ 2026-05-23, ✅).
- Cron expire с защитой от гонки «истёк, но ответили».
- Engagement-rate gauge per-user.

**Реализовано иначе, чем в ТЗ:**
- **Engagement-weighted round-robin отложен.** Сейчас `candidates[0]` — всегда первый по сортировке. ТЗ предполагал weighting по `engagement_rate`. Метрика собирается, но в decision-logic не подключена. Намеренный отложенный пункт (γ+).
- **Quiet hours не учитываются на уровне `ProbeDispatcherWorker`** — комментарий в коде: «TODO(γ+) — в β-5 пропускаем». Quiet hours учитываются дальше, в `selectBindingsForNotification` (см. [[notification-dispatch]]).

**Не реализовано (gap):**
- **`isColdStart` фактически отключён.** Возвращает `false` всегда (см. `probe.service.ts:277..282`). Cold-start mode «после deploy не штурмовать» формально требует deploy-маркера; в β-5 упростили, на проде — счётчик `probe_cold_start_dropped_total` стоит на нуле. Зависит от добавления deploy-маркера + хранения первой записи как «эталона». Probe-storm после deploy всё равно ловится дедупом и rate-limit'ом, поэтому критическим этот gap не считается.
- **`probe_dispatched_total{kind}` хардкод `'in_app'`.** Реальный канал зависит от `selectBindingsForNotification`, не от dispatcher'а. Корректный label — после `Notification` создан и есть `NotificationDelivery`. Сейчас метрика не отражает реальный канал отправки.

**Реализовано, не описано в ТЗ:**
- **`payload.dataClass`** — пробрасывается в payload и используется при `sendNotification` (см. `extractDataClass(payload)` в dispatcher'е).
- **`ConversationalIngestAdapter.ingestNotificationResponse`** — детерминированный `sourceExternalId='resp:{notificationId}'`, гарантирует идемпотентность повторной обработки одного ответа.
- **`ProbePriorityCron` защищает от гонки** — если Notification.respondedAt уже есть, expired не выставляется.

## 8.1. Фаза 2 — новые гейты/шаги конвейера (2026-06-18)

**Источник:** ТЗ [`plans/tz/2026-06-17-probe-system-phase2.md`](../../plans/tz/2026-06-17-probe-system-phase2.md) (Ф1–Ф6), ветка `feature/knowledge-base-redesign-formatter`. Профильная заметка — [[../01_projects/probe-agent]] §«Фаза 2». Закрывает часть gap'ов §8 (round-robin `candidates[0]`, хардкод `kind`, хрупкий Telegram reply-парсинг для свободного ответа).

**Изменения по конвейеру (поверх шагов 1–12 выше):**

1. **`probe_reply` на входе (Ф1).** Свободный текст без reply теперь распознаётся как ответ на **открытый** probe: интент `probe_reply` в `dialog-classify`, поиск открытого probe через `openProbeQuestion`, оба бот-адаптера (Telegram/MAX) ведут свободный ответ в `respondToProbe`. Гейт — крутилка `probe.replyClassifyMinConfidence` (0.6): ниже порога ответ не засчитывается. Это **снимает** грабли «„да“ в общий чат → free_note/chat_query» из §6.
2. **LLM-судья качества после `formulate` (Ф2).** Между шагами 7 и 8 — новый taskType `probe-quality-judge` проверяет сформулированный вопрос и при браке заменяет **одним** регенератом. Kill-switch `probe.qualityJudgeEnabled` (ON). LLM-вызов — см. §5.2 (дополнение ниже).
3. **Выбор получателя по отзывчивости (Ф3).** Шаг 7 «select recipient» больше **не** `candidates[0]`: из кандидатов выбирается самый отзывчивый по engagement-снимку (`ProbePriorityCron`). Kill-switch `probe.engagementRoutingEnabled` (ON); OFF → первый кандидат. Закрывает gap §8 «Round-robin recipient — `candidates[0]`».
4. **Семантический дедуп в `suggest` (Ф4).** Поверх content-hash дедупа (шаг 2) добавлен KNN по эмбеддингу `ProbeEvent.questionEmbedding vector(1536)` (HNSW `idx_probeevent_qembed_hnsw`): cosine ≥ `probe.semanticDedupThreshold` (0.92) в окне `probe.semanticDedupWindowHours` (72) → дроп. Kill-switch `probe.semanticDedupEnabled` (ON). Закрывает «Embedding-based дедуп (β-5 — content hash)» из «Что отложено».
5. **Re-ask в cron (Ф5).** При истечении неотвеченного probe (шаг 12) вместо немедленного `ignored` вопрос **переформулируется и задаётся ещё раз** один раз (`payload.reaskCount` / `payload.originalProbeEventId`). Kill-switch `probe.reaskEnabled` (ON); OFF → старое поведение (сразу закрытие).
6. **Новый ingest-повод `attribution.unresolved_at_ingest` (Ф6).** `BlockIngestWorker` эмитит `suggest(...)` с этим **deferrable**-поводом для новых `customer`/`vendor`-`Entity` без привязки → вопрос «кто это / с чем связано». Гасится дайджестом/дедупом/recheck (deferrable-окно), не штурмует на каждой новой сущности.

**Новые метрики (Ф2/Ф3):**
- `probe_quality_judged_total{verdict}` — Counter, вердикт LLM-судьи качества.
- `probe_dispatched_total{kind}` — теперь с **реальным** ChannelKind после dispatch (раньше хардкод `'in_app'`, см. §8 gap — закрыт).

**Дополнение к §5.2 (LLM-вызовы):**

| Шаг | taskType | Primary | Fallback | Где промпт |
|---|---|---|---|---|
| 7.5 (после formulate) | `probe-quality-judge` | `deepseek-v4-flash` | `gpt-5.4-mini` → `ollama` | `backend/src/modules/probe/prompts/probe-quality-judge.prompt.ts` |

## 9. История изменений процесса

| Дата | Что изменилось | Коммит/рефлексия |
|---|---|---|
| 2026-06-18 | Фаза 2 (Ф1–Ф6): `probe_reply` (свободный ответ), LLM-судья качества `probe-quality-judge`, выбор получателя по отзывчивости (+реальный `kind`), семантический дедуп через pgvector, re-ask, повод `attribution.unresolved_at_ingest`. Закрыты gap'ы round-robin/хардкод kind/embedding-дедуп | `9430383f`..`ea27594e`, ТЗ probe-system-phase2 |
| 2026-05-29 | Карточка создана. Зафиксированы gap'ы по cold-start и хардкод label'у. | этот документ |
| 2026-05-23 | β-5 sub-TZ closing-loop: `RawEvent(kind='notification_response')`, `probe_closed_total`, защита cron'а от гонки expired | plans/tz/2026-05-23-sba-beta-5-probe-closing-loop.md |
| ~2026-05-21 | SBA β-5 — `ProbeService`, `ProbeDispatcherWorker`, `ProbePriorityCron`, `core.probe-events`, LLM `probe-formulate` | plans/tz/.../probe-agent.md |
