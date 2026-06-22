---
type: project
status: active
phase: beta-5
updated: 2026-05-22
related:
  - 02_architecture/module-map.md (β-5)
  - 01_projects/ideas.md
  - plans/archive/2026-05-21-sba-beta-5-specialist-3-6-ideas-and-layer6-probe.md
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
| `status` | ProbeStatus | pending → dispatched / dropped_dedup / dropped_rate_limit / dropped_cold_start / expired / **queued_digest** (Ф3 — deferrable отложен в дайджест) / **suppressed_stale** (Ф4 — повод закрылся между suggest и dispatch) |
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

## Фаза 1 — политика инициирования + формулировка (2026-06-11)

**Источник:** ТЗ [`plans/tz/2026-06-11-probe-system-upgrade-phase1.md`](../../plans/tz/2026-06-11-probe-system-upgrade-phase1.md) (6 под-фаз). Анализ корня «вопросы не понравились» — [`plans/analysis/2026-06-11-proactive-clarifying-questions-probe-research.md`](../../plans/analysis/2026-06-11-proactive-clarifying-questions-probe-research.md). Ветка `svdev`, коммиты `5ed78b54..fa950cd1`. Корень был не в тексте, а в **отсутствии политики инициирования** (когда/кому/как часто слать). Теперь это работает.

### Ф1 — переписан промпт `probe-formulate` (коммит `5ed78b54`)

Промпт `backend/src/modules/knowledge-core/prompts/probe-formulate.prompt.ts` переписан по методологии (§9-B анализа): SYSTEM получил **персону + правила + few-shot + self-check** и стал стабильным (cache-friendly — переменные данные в конце USER). Главное: USER больше **НЕ подаёт машинные коды** (`emittedByService`, сырой `reason`) — вместо них человеческий `reasonLabel` из нового словаря `backend/src/modules/probe/probe-reason-labels.ts` (`PROBE_REASON_LABEL` + `PROBE_REASON_FALLBACK`). Schema контракта поднята `probe_formulate_v2` → `probe_formulate_v3` (форма USER сменилась). Fallback при провале LLM теперь: `suggestedQuestion → PROBE_REASON_FALLBACK[reason] → generic` (раньше — сырой `humanizeProbeFallback(message)`, протекал техникой).

### Ф2 — политика по типу пробела (коммит `cbe129b3`)

Новый `backend/src/modules/probe/probe-reason-policy.ts`:
- `PROBE_REASON_WINDOW` (`immediate` | `deferrable`, дефолт `deferrable`) + `probeWindow(reason)` — окно срочности повода (срочное шлём сразу, прочее можно отложить в дайджест);
- `PROBE_REASON_RECHECK` — предикаты «пробел ещё открыт?»: перечитывают Decision / Idea / Regulation / Process / Policy по `contextCardId`, **tenant-изолированно** (используется в Ф4).

### Ф3 — батч-дайджест отложенных probe (коммит `7c82a0f3`)

Новое значение `ProbeStatus.queued_digest` (миграция, см. ниже): **deferrable**-probe сверх бюджета получателя больше **не дропается** (`dropped_rate_limit`), а откладывается (`queued_digest`) — гейт исправлен в **двух местах** (`ProbeService.suggest()` и `ProbeDispatcherWorker`). Новый `backend/src/modules/probe/probe-digest.cron.ts` (`ProbeDigestCron`, `@Cron('0 * * * *')`, фактически шлёт 1×/день в час `probe.digestHourUtc`): группирует `queued_digest` по `(tenantId, recipient)`, шлёт **ОДНО** уведомление `probe.digest` (≤ `probe.digestTouchCap`, дефолт 5), помечает вошедшие `dispatched` (идемпотентно — повтор = no-op). Текст собирает детерминированный билдер `backend/src/modules/probe/prompts/probe-digest.prompt.ts` (`buildProbeDigestSummary`, **без LLM**). `immediate`-probe при лимите **минует дайджест** (прежний drop, R6). Новый eventType `probe.digest` (Zod в `event-payload.registry.ts`, рендер в telegram + max-bot адаптерах, канал-политика `['telegram_bot','max_bot','in_app']`, фронт-label «Вопросы от Коры»). `ProbeDigestCron` зарегистрирован в `probe.module.ts`.

### Ф4 — recheck повода перед dispatch (коммит `9b5a026a`)

`ProbeDispatcherWorker.process()` перед `formulate()` перепроверяет повод (`PROBE_REASON_RECHECK`). Если пробел закрылся сам между `suggest` и `dispatch` → новый `ProbeStatus.suppressed_stale`, probe **НЕ шлётся**, LLM **не зовётся** (экономия + не дёргаем зря). Best-effort: ошибка предиката → probe всё равно уходит (recall важнее).

### Ф5 — adaptive fatigue (коммит `8a993edc`)

«Меньше беспокоить тех, кто не отвечает»:
- новая метрика `probe_outcome_total{outcome, reason}` (`answered` из `ProbeResponseHandler`, `ignored` из `ProbePriorityCron` на истечении) — калибровочный сигнал для Фазы 2;
- `ProbePriorityCron` пишет engagement-снимок в Redis; `ProbeService.filterByRateLimit` режет эффективный бюджет **вдвое** получателю с engagement ниже порога (kill-switch `probe.adaptiveFatigueEnabled`, ВКЛ);
- **topic cooldown:** dispatcher (на dispatch) и priority-cron (на `ignored`) ставят ключ `probe:cooldown:{tenant}:{hash}` на `probe.topicCooldownHours` (дефолт 48ч); `suggest()` дропает тему на cooldown. Общие ключи — новый `backend/src/modules/probe/probe-fatigue.util.ts`. `ProbePriorityCron` теперь инжектит `RedisService` + `TypedConfigService`.

### Ф6 — видимое следствие ответа (коммит `fa950cd1`)

`ProbeResponseHandler` после ответа шлёт получателю подтверждение `probe.answer_acknowledged` («Спасибо! Ваш ответ записан в память компании.» + название объекта `contextCardTitle`). **Только текст** (не голос). Best-effort. `ProbeResponseHandler` теперь инжектит `ConversationalService`. Новый eventType (Zod + рендер telegram / max-bot + фронт-label «Ответ записан»).

### Новые крутилки (AdminSetting, секция `probe`)

Через `getDynamic` (code-default, прод-действий не требуют), зарегистрированы в `admin-setting-schema-registry.ts` + `seed-admin-settings.ts`: `probe.digestTouchCap` (5), `probe.digestHourUtc` (9), `probe.digestEnabled` (true, kill-switch), `probe.topicCooldownHours` (48), `probe.adaptiveFatigueEnabled` (true, kill-switch). Флаги `probe.digestEnabled` и `probe.adaptiveFatigueEnabled` — оба kill-switch (тип A, ВКЛ); дайджест / промпт / recheck / ack едут **без флага** (чистая замена поведения). Реестр флагов — [[../../docs/operations/feature-flags|feature-flags]].

### Миграция

`backend/prisma/migrations/20260611120000_probe_status_digest/migration.sql` — `ALTER TYPE "ProbeStatus" ADD VALUE 'queued_digest'` + `'suppressed_stale'` (аддитивно, безопасно).

### Что осталось — Фаза 2/3 (отложено)

Фаза 2 (LLM-judge ценности вопроса + семантический дедуп через pgvector + полный graph-answer-search) и Фаза 3 (re-ask петля + память предпочтений тона) ждут калибровочных данных `probe_outcome_total` из Ф5. Порядок A→B→C доказан анализом §10 Р3. См. реестр [[../04_не-сделано/README|не-сделано]].

## Фаза 2 — РЕАЛИЗОВАНА (2026-06-18)

**Источник:** ТЗ [`plans/tz/2026-06-17-probe-system-phase2.md`](../../plans/tz/2026-06-17-probe-system-phase2.md) (Ф1–Ф6). Ветка `feature/knowledge-base-redesign-formatter`, коммиты `9430383f`/`cf9c3878`/`b7b32e64`/`855197a4`/`553c93e9`/`ea27594e`. Фаза 2 из «что осталось» выше теперь **закрыта** (LLM-судья качества + семантический дедуп через pgvector + re-ask). Процесс — [[../03_processes/probe-question-flow]], taskType — [[ai-jobs]], схема — [[../02_architecture/data-model]] §ProbeEvent.

### Ф1 — свободный ответ на probe (`probe_reply`)

Свободный текст без reply-кнопки теперь распознаётся как ответ на **открытый** probe. Интент `probe_reply` добавлен в классификатор `dialog-classify`; на стороне канала открытый probe ищется по `openProbeQuestion`, оба бот-адаптера (Telegram/MAX) пробрасывают свободный ответ в `respondToProbe`. Порог уверенности классификатора — крутилка `probe.replyClassifyMinConfidence` (0.6): ниже порога текст не засчитывается ответом. Снимает грабли «пользователь пишет „да“ в общий чат без reply → free_note/chat_query» (см. §6 в [[../03_processes/probe-question-flow]]).

### Ф2 — LLM-судья качества формулировки

Новый taskType `probe-quality-judge` (cheap-цепочка `deepseek-v4-flash` → `gpt-5.4-mini` → `ollama`, seed-route `seed-llm-task-routes-ideas-and-probe.ts`, промпт `backend/src/modules/probe/prompts/probe-quality-judge.prompt.ts`). После `formulate()` судья проверяет сформулированный вопрос; при браке заменяет **одним** улучшенным регенератом. Kill-switch `probe.qualityJudgeEnabled` (ON, тип A). Метрика `probe_quality_judged_total{verdict}`. OFF → вопрос уходит как сформулирован.

### Ф3 — выбор получателя по отзывчивости + реальный `kind`

Из кандидатов вопрос идёт **самому отзывчивому** (engagement-снимок из `ProbePriorityCron`), а не первому по списку — закрывает прежний gap «round-robin = `candidates[0]`». Kill-switch `probe.engagementRoutingEnabled` (ON, тип A); OFF → первый кандидат. Заодно метрика `probe_dispatched_total{kind}` получила **реальный** ChannelKind после dispatch (раньше был хардкод `'in_app'`).

### Ф4 — семантический дедуп через pgvector

Новая колонка `ProbeEvent.questionEmbedding vector(1536)` (миграция `add_probe_event_question_embedding`) + HNSW-индекс `idx_probeevent_qembed_hnsw` в `postgres-init.sql`. На `suggest` вопрос дедупится по эмбеддингу (KNN cosine ≥ порога в окне) — поверх прежнего content-hash дедупа (β-5 был только hash). Kill-switch `probe.semanticDedupEnabled` (ON, тип A) + крутилки `probe.semanticDedupThreshold` (0.92) / `probe.semanticDedupWindowHours` (72).

### Ф5 — re-ask (один переспрос)

При истечении неотвеченного probe вопрос **переформулируется и задаётся ещё раз** перед закрытием как `ignored`. Учёт через `payload.reaskCount` / `payload.originalProbeEventId`. Kill-switch `probe.reaskEnabled` (ON, тип A); OFF → истёкший probe сразу закрывается без переспроса.

### Ф6 — ingest-повод `attribution.unresolved_at_ingest`

Новый **deferrable** повод probe: `BlockIngestWorker` эмитит его для новых `customer`/`vendor`-`Entity` без привязки (атрибуция не разрешилась при усвоении) → точечный вопрос «кто это / с кем связано». `deferrable` (окно через `PROBE_REASON_WINDOW`) — гасится дайджестом/дедупом/recheck, не штурмует на каждой новой сущности.

### Новые крутилки (AdminSetting, секция `probe`)

Зарегистрированы в `seed-admin-settings.ts` (`phase:'seed-base'`, идёт штатно агрегатором, уважает admin-override): `probe.replyClassifyMinConfidence` (0.6), `probe.qualityJudgeEnabled` (ON), `probe.engagementRoutingEnabled` (ON), `probe.semanticDedupEnabled` (ON), `probe.semanticDedupThreshold` (0.92), `probe.semanticDedupWindowHours` (72), `probe.reaskEnabled` (ON). Все четыре `*Enabled` — kill-switch (тип A, ВКЛ, действий владельца не требуют). Реестр флагов — [[../../docs/operations/feature-flags|feature-flags]].

### Новые метрики

- `probe_quality_judged_total{verdict}` — counter (вердикт LLM-судьи качества).
- `probe_dispatched_total{kind}` — теперь с **реальным** ChannelKind (Ф3), а не хардкод `'in_app'`.

## Что отложено

- Полный flow «ответ на probe → новый RawEvent → ingest pipeline» — γ+ (нужен conversational Source `type='conversational'` для каждой Org).
- Ml-priority (engagement weight в выборе recipient'а).
- Embedding-based дедуп (β-5 — content hash).
- Quiet hours defer (re-enqueue с delay до конца quiet hours).
- Реальная активация cold-start mode после deploy.

## Умный модуль уточняющих вопросов (2026-06-20, ТЗ probe-smart-questions-module)

Вопросы всегда называют конкретный объект и никогда не пустые. Единый `ProbeFormulationService` (`probe/probe-formulation.service.ts`) — конвейер **gate → formulate → judge** для push И дайджеста:
- **Ценностный гейт** `probe-value-gate` (LLM `{ask, reason}`) ПЕРЕД формулировкой: пустой пробел (нет объекта/сути, ответ виден, общее слово) → `dropped_low_value`, метрика `probe_value_gate_total{verdict}`; сбой LLM → fail-open (не глушим). Флаг `probe.valueGateEnabled` (kill-switch ON).
- **Формулировка** = proven B (жёсткое «НАЗОВИ ОБЪЕКТ»); структурные эмиттеры (3-1/3-3/3-6/3-9, block-ingest, process-template) кладут чистый `objectName` в payload (фикс класса Д5).
- **Судья качества** видит `objectName` — бракует вопрос, потерявший имя объекта.
- **Стоп-кран дайджеста**: `deriveDigestQuestion` (humanize message) + машинный гард паритета `PROBE_REASON_LABEL ⊆ PROBE_REASON_FALLBACK` (фикс Д4, +12 ключей); дайджест формулирует через сервис за флагом `probe.digestFormulateEnabled` (OFF/сбой → детерминированный путь).

Процесс — [[../03_processes/probe-question-flow]] (changelog 2026-06-20).

## Дозапрос по задачам + исполнение ответа + обучение (2026-06-22, ТЗ tasks-subsystem-unified-fix A1/A3)

Probe обслуживает задачную подсистему — два новых reason (в `probe-reason-labels` + policy, окно immediate, recheck-предикаты `issue`/`intake_issue`):
- `task.assignee_unresolved` — задача с неясным исполнителем (создаётся ВСЕГДА как Issue без исполнителя, в ответ `needsAssignee`+candidates) поднимает уточняющий вопрос вместо 404/угадывания.
- `task.due_date_missing` — задача без срока спрашивает срок.

**Ответ на probe исполняется** (раньше probe только спрашивал): `probe-response.handler.maybeApplyTaskProbeAnswer` назначает исполнителя (резолвер → `IssuesService.addAssignee`) или выставляет срок (`parseRussianDueDate`), идемпотентно. ProbeModule импортирует TrackerModule. **Обучение:** ответ автоматически выводит правило `SubjectMemory` (отдел/роль→человек) — при повторе того же отдела/роли probe НЕ задаётся (`resolved via:'memory'`, retrieve-before-ask). Адресат при пустом исполнителе в задаче встречи — владелец встречи (`contextCardKind=intake_issue`). Kill-switch `tracker.assigneeClarifyEnabled` / `tracker.dueDateClarifyEnabled` (ON), метрика `task_assignee_clarify_total{outcome}` — [[../../docs/operations/feature-flags|feature-flags]]. Главный потребитель — [[tracker]].

## См. также

- [[ideas]] — главный потребитель Probe-Agent в β-5.
- [[channels-foundation]] (α-1) — где живёт `ConversationalService`.
- [[../02_architecture/module-map|02_architecture/module-map.md]] — раздел «SBA β-5».
