---
type: project
status: active
phase: beta-5
updated: 2026-05-22
related:
  - 02_architecture/module-map.md (β-5)
  - 01_projects/ideas.md
  - plans/tz/2026-05-21-sba-beta-5-specialist-3-6-ideas-and-layer6-probe.md
---

# Layer 6 — Probe-Agent (Активный уточнитель)

Новый слой архитектуры — поверх Conversational (α-1). Берёт пробелы знаний, которые находят специалисты Слоя 3, и переводит их в точечные вопросы пользователям через каналы (in_app / telegram / email).

## Зачем

Раньше каждый специалист сам слал `ConversationalService.sendNotification(eventType='specialist.probe', ...)`. Минусы:
- никакой дедупликации (один и тот же probe может уйти 5 раз про одну и ту же карточку);
- никакого rate-limit (пользователь может получить 20 уведомлений за час);
- никакого LLM-уточнения вопроса;
- никакого аудита, какие probe были созданы.

С Layer 6 это всё централизовано в `ProbeService.suggest(...)`.

## API для специалистов Слоя 3

```ts
const res = await probeService.suggest({
  tenantId,
  emittedByService: '3-3-decisions',
  reason: 'decision.overdue',
  payload: {
    message: 'Решение «X» просрочено на 7 дней — что делаем?',
    suggestedActions: ['Продлить', 'Отменить', 'Закрыть'],
    contextCardId: decisionId,
    contextCardKind: 'decision',
    contextCardTitle: decision.statement.slice(0, 100),
    actionUrl: `/decisions/${decisionId}`,
    dataClass: 'sensitive',
  },
  recipientCandidates: [ownerUserId, adminUserId],
  priorityHint: 0.7,           // 0..1; severity_weight в priority-формуле.
  dataClass: 'sensitive',
});
// → { ok: true, probeEventId } | { dropped: 'dedup' | 'rate_limit' | 'cold_start' }
```

## Внутренний pipeline

```
ProbeService.suggest:
  1. contentHash = sha256(reason + sorted contextIds + message).
  2. Redis dedup check (TTL=PROBE_DEDUP_TTL_HOURS=72ч): SET NX EX.
     → SET вернул null → dropped: dedup.
  3. Per-user rate-limit check (часовой + суточный): отфильтровать кандидатов.
     → все под лимитом → dropped: rate_limit (запись в БД для admin queue).
  4. Cold-start mode check (PROBE_COLD_START_MODE_HOURS=24).
  5. priority = round(severity_weight × 100).
  6. INSERT ProbeEvent(status='pending') + enqueue core.probe-events.

ProbeDispatcherWorker (consumer core.probe-events):
  1. Re-check rate-limit recipientCandidates.
  2. Round-robin select recipient (engagement weight — γ+).
  3. LLM probe-formulate → {question, options}.
     • fallback: payload.suggestedQuestion / payload.message.
  4. ConversationalService.sendNotification(eventType='probe.question').
  5. INC rate-limit counters (Redis multi: probe:ratelimit:<userId>:h:<bucket>).
  6. UPDATE ProbeEvent(status='dispatched', dispatchedNotificationId).

ProbeResponseHandler (@OnEvent 'notification.responded'):
  • если notification.eventType начинается с 'probe.' → метрики
    probe_response_total, probe_response_time_seconds.
  • символический «новый RawEvent через ingest pipeline» — отложен в γ+
    (нужен conversational Source).

ProbePriorityCron (*/15 * * * *):
  • UPDATE ProbeEvent SET status='expired' WHERE expiresAt < now AND status='pending'.
  • per-user engagement_rate gauge: probe_recipient_engagement_rate{user_id}.
```

## Сущность ProbeEvent

| Поле | Тип | Значение |
|---|---|---|
| `emittedByService` | varchar | `'3-3-decisions'`, `'3-5-insights'`, ... |
| `reason` | varchar | `'decision.overdue'`, `'insight.escalation_suggested'`, ... |
| `payload` | JSON | message, suggestedActions, contextCardId, contextCardKind, contextCardTitle, actionUrl, dataClass |
| `recipientCandidates` | string[] | userId[] |
| `selectedRecipientId` | string? | После dispatch |
| `status` | ProbeStatus | pending → dispatched / dropped_dedup / dropped_rate_limit / dropped_cold_start / expired |
| `dispatchedNotificationId` | string? | FK на Notification (α-1) |
| `contentHash` | varchar(80) | sha256 для дедупа |
| `priority` | int | 0..100, computed |
| `expiresAt` | DateTime? | По умолчанию +`PROBE_EXPIRY_DAYS` (14д) |

## REST API

| Метод | Эндпоинт | Доступ |
|---|---|---|
| GET | `/api/v1/probe/queue?status=&emittedByService=` | admin/owner |
| GET | `/api/v1/me/probe-history` | self (eventType LIKE 'probe.%') |

## Миграция specialist'ов

В каждом из 5 файлов `specialist-3-{1,2,3,4,5}-probe.service.ts` метод `emit()` теперь сначала пробует `ProbeService.suggest(...)`, а на ошибку/отсутствие — fallback на legacy `ConversationalService.sendNotification(eventType='specialist.probe')`. Inject — `@Optional() @Inject(ProbeService)` — на случай тестов без ProbeModule.

Маппинг payload:
- `specialist.probe.payload.specialistName` ↔ `emittedByService`.
- `specialist.probe.payload.message` ↔ `payload.message`.
- `specialist.probe.payload.suggestedActions` ↔ `payload.suggestedActions`.
- `specialist.probe.payload.cardId` ↔ `payload.contextCardId`.
- `specialist.probe.payload.actionUrl` ↔ `payload.actionUrl`.

## ENV

```
PROBE_DEDUP_TTL_HOURS=72
PROBE_RATE_LIMIT_PER_USER_PER_HOUR=5
PROBE_RATE_LIMIT_PER_USER_PER_DAY=20
PROBE_EXPIRY_DAYS=14
PROBE_PRIORITY_REFRESH_CRON="*/15 * * * *"
PROBE_QUIET_HOURS_DEFAULT_TZ_OFFSET_MIN=180
PROBE_COLD_START_MODE_HOURS=24
```

## Метрики

- `probe_events_total{emitted_by_service, reason, status}` — counter.
- `probe_dispatched_total{kind}` — kind = ChannelKind после dispatch.
- `probe_response_total{event_type, kind}` — ответ получен.
- `probe_response_time_seconds{event_type, kind}` — histogram.
- `probe_dedup_dropped_total{reason}`, `probe_rate_limit_dropped_total`,
  `probe_cold_start_dropped_total`, `probe_expired_total`.
- `probe_recipient_engagement_rate{user_id}` — gauge, обновляется cron'ом раз в 15 мин.

## LLM TaskType

`probe-formulate` — formирует question + 2–4 inline options. Promp placeholder; цепочка: deepseek-v4-flash → gpt-5.4-mini → ollama qwen3:30b. Fallback (LLM упал) — берём `payload.suggestedQuestion ?? payload.message.slice(0, 200)` + `payload.suggestedActions || ['Да','Нет']`.

## Глобальный EventEmitter

`@nestjs/event-emitter` добавлен в `package.json`; `EventEmitterModule.forRoot({wildcard:true, delimiter:'.'})` в `app.module.ts`. Используются:
- `ConversationalService.respondToProbe` → emit `notification.responded`.
- `Specialist36Service.processBlock` → emit `idea.created`.
- `Specialist36Service.changeStatus` → emit `idea.status_changed` (closing-loop).

## Что отложено

- Полный flow «ответ на probe → новый RawEvent → ingest pipeline» — γ+ (нужен conversational Source `type='conversational'` для каждой Org).
- Ml-priority (engagement weight в выборе recipient'а).
- Embedding-based дедуп (β-5 — content hash).
- Quiet hours defer (re-enqueue с delay до конца quiet hours).
- Реальная активация cold-start mode после deploy.

## См. также

- [[ideas]] — главный потребитель Probe-Agent в β-5.
- [[channels-foundation]] (α-1) — где живёт `ConversationalService`.
- [[../02_architecture/module-map|02_architecture/module-map.md]] — раздел «SBA β-5».
