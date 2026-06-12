---
type: tz
status: ready-to-implement
feature: meeting-no-recording-notification
date: 2026-06-11
owner: sergrv80@gmail.com
source: вынос пункта D8 / Ф9 из plans/tz/2026-06-11-cabinet-inbox-nav-ui-honesty.md
---

# ТЗ — уведомление владельцу: «встреча завершена без записи — анализа не будет»

> **Контекст выноса.** Это пункт **D8 / Ф9** из ТЗ
> `plans/tz/2026-06-11-cabinet-inbox-nav-ui-honesty.md` (§Ф9). В исходном ТЗ
> Ф9 явно разрешала вынести D8 в отдельный документ, потому что «контракт
> уведомления неочевиден — нужен канал доставки». Канал найден (он уже есть —
> `ConversationalService.sendNotification`), поэтому D8 не блокирует косметику
> и оформлен здесь как самостоятельная фича.
>
> **Запуск реализации — после явного «да» владельца на канал доставки**
> (см. §3). До «да» — статус `ready-to-implement`, код не пишем.

---

## 1. Проблема + Зачем

**Симптом.** Пользователь провёл встречу, ожидает AI-отчёт. Но если встреча
завершилась **без записи и без транскрипта** (никто не включил запись /
egress не стартовал / `recordByDefault=false` и запись не запускали вручную /
все дорожки пустые), AI-конвейер **никогда не запустится** — потому что
`enqueueTranscribe` вызывается только из `promoteMeetingToReady` при готовой
записи (`allReady`), а его вообще нет смысла звать без медиа. В итоге встреча
тихо «зависает» в статусе `completed`, отчёт не появляется **никогда**, и
система об этом **молчит**.

**Зачем чинить.** Молчание — худший исход для доверия: человек ждёт отчёт,
который физически не может появиться, и думает, что «Кора тормозит» или
«сломалась». Один короткий честный сигнал «записи не было — анализировать
нечего, отчёта по этой встрече не будет» закрывает ожидание и подсказывает
действие («в следующий раз включите запись» / «загрузите файл вручную»).
Это прямой кусок продуктовой честности из ТЗ-2 (UI-honesty).

**Границы.** Мы НЕ строим полноценный модуль notifications и НЕ чиним
причины отсутствия записи — только **честно уведомляем** владельца встречи,
когда факт «записи/транскрипта нет» уже установлен.

---

## 2. REALITY-CHECK (факт по коду, проверено на ветке)

Anchors проверены чтением файлов; номера строк могут дрейфовать — ищи по
именам символов.

1. **Где встреча завершается.**
   `backend/src/modules/webhooks/livekit-events.handler.ts` → `onRoomFinished`
   (около `:211-230`). Делает ровно три вещи: FSM `active → completed`
   (`transitionStatus(..., 'completed', { endedAt, reason:'livekit:room_finished' })`),
   `metrics.incMeetingFinished(meeting.type)`, лог. **Никакого уведомления нет** —
   это и есть точка, где сейчас «молчит».

2. **Почему анализа может не быть.** AI-конвейер (`enqueueTranscribe`)
   ставится **только** в `meeting-finalization.service.ts` →
   `promoteMeetingToReady(meetingId, allReady)` (`:43-94`), и только при
   `allReady === true`. Этот метод вызывается **исключительно** из:
   - `livekit-events.handler.ts` → `onEgressEnded` (`:390-441`) — приходит при
     `egress_ended`;
   - `composite-egress-reconcile.cron.ts` → `sweep` (`:50-97`) — pull-фоллбэк.

   Реконсайл-крон фильтрует кандидатов по
   `compositeEgressId: { not: null }` и `status: { in: ['recording','finalizing'] }`
   (`:54-71`). **Встреча, где запись вообще не стартовала** (нет `Recording`
   или `compositeEgressId === null`), **не попадает ни в одну из этих веток** →
   `enqueueTranscribe` не вызывается никогда → отчёта не будет, и про это
   нигде не сигналят.

3. **Готовый канал доставки уже есть.**
   `backend/src/modules/conversational/conversational.service.ts` →
   `ConversationalService.sendNotification(input: SendNotificationInput)`
   (`:215-355`). Контракт:
   `{ tenantId, recipientUserId, eventType, payload, dataClass?, priorityTier?, critical?, preferredChannelKinds? }`.
   - `eventType` — **свободная строка**; если для неё зарегистрирована схема в
     `types/event-payload.registry.ts` — payload валидируется (`validatePayload`
     → `validateEventPayload`, `:936-954` / registry `:380-442`); если нет —
     допускается любой объект (либеральный режим).
   - Per-eventType политика каналов — `EVENT_TYPE_CHANNEL_POLICY` (`:90-151`).
     Незарегистрированный eventType падает на `DEFAULT_POLICY = ['in_app']`
     (`:153`).
   - `in_app` **гарантирован всегда**: `ensureInAppForUser` (`:985-1010`)
     создаёт канал+binding, а `selectBindingsForNotification` держит его как
     fallback «последней надежды» даже в тихие часы (`:1107-1111`).
   - Push-каналы (telegram/max/email) режутся **дневным бюджетом**
     (`NotificationBudgetService`, `:296-325`) и тихими часами — нам это
     подходит (in_app всё равно дойдёт).
   - Образцы регистрации eventType: `'meeting.invite'`, `'idea.status_changed'`,
     `'proactive.notification'`, `'system.message'` — делаем `'meeting.no_analysis'`
     по тому же образцу.

4. **Кто владелец встречи (recipient).** Модель `Meeting` (schema.prisma
   `:1243`+): `ownerId String` + `owner User @relation(...)` (`:1254-1255`).
   Это и есть получатель уведомления: `recipientUserId = meeting.ownerId`.
   Tenant — `meeting.tenantId` (NOT NULL, `:1252`).

5. **Как определить «completed без записи/транскрипта».**
   - Связи `Meeting`: `recording Recording?` (`:1320`), `transcript Transcript?`
     (`:1321`) — обе **опциональные one-to-one** (могут отсутствовать).
   - `Recording.status: RecordingStatus` (enum `:134-144`:
     `not_started|requested|recording|finalizing|ready|failed|expired|archived|deleted`),
     `mainVideoUrl String?`, `compositeEgressId String?` (`:1465-1483`).
   - `Transcript.totalWords Int?` (`:1505-1523`) — `null`/`0` = пусто.
   - **Признак «анализировать нечего»** (после грейс-периода):
     встреча в `completed`, и (`recording == null` **ИЛИ**
     `recording.mainVideoUrl == null && recording.status ∈ {not_started, requested, failed}`)
     **И** (`transcript == null` **ИЛИ** `transcript.totalWords ∈ {null, 0}`).
     `reason = 'no_recording'` если нет записи; `'no_transcript'` если запись
     формально есть, но транскрипт так и не появился. (Точные пороги — §4.)

6. **Гард идемпотентности.** Модель `MeetingEvent` (`:1679-1688`):
   `{ id, meetingId, eventType, payload, receivedAt }`, индекс
   `@@index([meetingId, receivedAt])`, **без unique-констрейнта** на
   `(meetingId, eventType)`. Образец записи —
   `ai/workers/notify.worker.ts` пишет `MeetingEvent { eventType: 'ai_notified' }`
   (`:54-64`). Значит гард «один раз на встречу» делаем через
   `meetingEvent.findFirst({ meetingId, eventType: 'no_analysis_notified' })`
   **перед** отправкой (не upsert — unique нет). `[ПРОВЕРИТЬ]` при реализации:
   если хотим строгую защиту от гонки двух кронов — можно добавить
   `@@unique([meetingId, eventType])`, но это **миграция** (см. §6, по умолчанию
   НЕ делаем — гонка между одним кроном безопасна, два параллельных воркера
   маловероятны).

7. **NotifyWorker НЕ подходит как канал.** `ai/workers/notify.worker.ts`
   пишет только `MeetingEvent ai_notified` и стоит в самом КОНЦЕ AI-pipeline
   (`QUEUE_NAMES.NOTIFY`), который для встреч-без-записи **не запускается
   вовсе**. Переиспользовать его нельзя — это часть успешной ветки.

---

## 3. Решение владельца [ASSUMPTION] — канал доставки

> Это **единственная развилка, требующая «да» владельца**. Без ответа
> реализацию не начинаем (тип флага — «решение владельца» по CLAUDE.md §8:
> меняет, что видит человек).

### Рекомендация (по умолчанию реализуем именно это)

**`ConversationalService.sendNotification({ eventType: 'meeting.no_analysis' })`**
с дефолтной политикой каналов `['in_app']` (+ опц. `telegram_bot` по выбору
владельца ниже).

**Почему именно так:**
- **Готовый канал** — не плодим новый модуль notifications (исходное ТЗ это
  прямо запрещало). Весь outbound-pipeline (bindings, dataClass-gate, бюджет,
  тихие часы, in_app-fallback) уже написан и протестирован.
- **in_app доставляется всегда** — даже если у владельца нет ни Telegram, ни
  почты: `ensureInAppForUser` + fallback гарантируют доставку в «Входящие»
  кабинета (тот самый inbox из ТЗ-2). Пользователь точно увидит сигнал.
- **Бюджет и тихие часы уже учтены** — не разбудим ночью; push-каналы режутся
  дневным лимитом, in_app не теряется.
- **Единый registry payload** — `'meeting.no_analysis'` валидируется схемой,
  как все остальные событийные типы. Один паттерн с `'meeting.invite'`.

### Подвопрос (тоже «да/нет» владельца): добавлять ли push-каналы

- **Рекомендация:** `EVENT_TYPE_CHANNEL_POLICY['meeting.no_analysis'] =
  ['in_app', 'telegram_bot']` — мгновенный пинг в Telegram тем, у кого
  привязан бот, in_app как fallback. Это не «нытик в почту» — событие
  редкое и значимое (отчёта не будет), пинг уместен. Email по умолчанию НЕ
  включаем (редкое разовое событие, почта избыточна).
- **Альтернатива (консервативно):** только `['in_app']` — тише, но
  пользователь без открытого кабинета узнает позже.

### Отвергнутые альтернативы (для протокола)

| Вариант | Почему НЕ берём |
|---|---|
| Только `MeetingEvent` + polling фронта (как `ai_notified`) | Фронт сейчас поллит статусы успешной ветки; новый «негативный» event придётся отдельно научить читать **каждую** поверхность (карточка встречи, inbox, список). Дороже и хрупче, чем готовый conversational-канал, который уже рисует inbox. |
| Только Telegram | У части владельцев бот не привязан → сигнал не дойдёт. in_app обязателен как база. |
| Только web-push | Не у всех включён; не покрывает «зашёл в кабинет — увидел». Push идёт «сверху» бесплатно через тот же `sendNotification` (если binding есть). |

**Ответ владельца фиксируется здесь при старте реализации:**
`[ ] да, канал = sendNotification('meeting.no_analysis')` · каналы:
`[ ] in_app` `[ ] + telegram_bot` `[ ] + email_smtp`.

---

## 4. Контракт

### 4.1. Новый eventType `meeting.no_analysis`

**Payload-схема** (в `conversational/types/event-payload.registry.ts`, по
образцу `MeetingInvitePayloadSchema` `:353-359`):

```ts
const MeetingNoAnalysisPayloadSchema = z
  .object({
    meetingId: z.string().min(1).max(40),
    meetingTitle: z.string().min(1).max(500),
    reason: z.enum(['no_recording', 'no_transcript']),
    occurredAt: z.string().datetime(), // ISO endedAt/now встречи
    actionUrl: z.string().max(2_000).optional(), // deep-link на карточку встречи
  })
  .strict();
```

Регистрация в `registry` Map (`:380-415`):

```ts
['meeting.no_analysis', MeetingNoAnalysisPayloadSchema],
```

**Политика каналов** в `EVENT_TYPE_CHANNEL_POLICY`
(`conversational.service.ts:90-151`) — по решению владельца из §3:

```ts
// ТЗ 2026-06-11 meeting-no-recording-notification — completed-встреча без
// записи/транскрипта: анализа не будет. in_app обязателен (виден в inbox),
// telegram_bot — мгновенный пинг тем, у кого привязан бот.
'meeting.no_analysis': ['in_app', 'telegram_bot'],
```

> Если владелец выбрал «только in_app» — строку в policy **не добавляем**:
> событие само упадёт на `DEFAULT_POLICY = ['in_app']`. Но строку лучше
> добавить явно с `['in_app']` для читаемости реестра.

**Вызов** (из детектора, §4.3):

```ts
await this.conversational.sendNotification({
  tenantId: meeting.tenantId,
  recipientUserId: meeting.ownerId,
  eventType: 'meeting.no_analysis',
  dataClass: 'internal', // факт об отсутствии записи — не sensitive/private
  priorityTier: 2,        // обычное (учитывается в дневном бюджете push)
  critical: false,        // уважать тихие часы; in_app дойдёт всё равно
  payload: {
    meetingId: meeting.id,
    meetingTitle: meeting.title,
    reason,               // 'no_recording' | 'no_transcript'
    occurredAt: (meeting.endedAt ?? new Date()).toISOString(),
    actionUrl: `/meetings/${meeting.id}`, // [ПРОВЕРИТЬ] реальный фронт-роут карточки
  },
});
```

`[ПРОВЕРИТЬ]` при реализации: точный фронт-роут карточки встречи (грепнуть
`app/(authenticated)` на маршрут вида `/meetings/[id]`). Если deep-link не
тривиален — `actionUrl` опционально, можно опустить.

### 4.2. Текст уведомления (рендер в канале)

Текст рисует адаптер канала по `eventType` + payload (как для остальных
событий). `[ASSUMPTION]`: если у `in_app`/telegram-адаптеров нет ветки рендера
для незнакомого eventType — добавить минимальный шаблон (RU, только русский):

- заголовок: «Запись встречи не велась»
- тело (`reason='no_recording'`): «Встреча «{meetingTitle}» завершена, но запись
  не велась — анализировать нечего, AI-отчёта по ней не будет. В следующий раз
  включите запись или загрузите файл встречи вручную.»
- тело (`reason='no_transcript'`): «Встреча «{meetingTitle}» записана, но речь
  распознать не удалось (пустой транскрипт) — AI-отчёта по ней не будет.»

`[ПРОВЕРИТЬ]` где живёт fallback-рендер незнакомых eventType (грепнуть адаптеры
`conversational/.../adapters` и in_app-рендер в `frontend`). Если рендер
общий по `payload.title/body` (как `system.message`) — можно отдавать готовые
`title`/`body` прямо в payload (расширив схему), это снимает потребность
трогать адаптеры. Выбор оставить реализатору; предпочтительно НЕ трогать
адаптеры, если есть generic-рендер.

### 4.3. Детектор «completed без записи спустя грейс»

**Грейс-период обязателен.** НЕ слать в `onRoomFinished`: запись может доехать
`egress_ended`-вебхуком или reconcile-кроном **позже** завершения комнаты
(на проде наблюдалась «18-минутная пауза» — см. комментарий в
`composite-egress-reconcile.cron.ts:13-18`). Отправка сразу = ложное
«анализа не будет», когда запись на самом деле едет.

**Реализация детектора — отдельный `@Cron` (рекомендация).** По образцу
`composite-egress-reconcile.cron.ts`. Раз в N минут выбираем кандидатов:

```ts
const GRACE_MIN = this.cfg... // §6, дефолт 15 мин
const candidates = await this.prisma.meeting.findMany({
  where: {
    status: 'completed',                       // ещё не ушла в recording_* / ai_*
    endedAt: { lt: new Date(Date.now() - GRACE_MIN * 60_000) },
    deletedAt: null,
    // ещё не уведомляли (гард, §4.4) — фильтруем в коде через findFirst,
    // ИЛИ через отсутствие связанного MeetingEvent (см. §4.4).
  },
  include: { recording: true, transcript: true },
  take: 50,
});
```

Для каждого кандидата — определить `reason` по правилу из §2.5:

- `recording == null` → `reason = 'no_recording'`.
- `recording != null && recording.mainVideoUrl == null &&
  recording.status ∈ {not_started, requested, failed}` И транскрипта нет →
  `reason = 'no_recording'` (запись фактически не получилась).
- `recording.status == 'ready'`/есть `mainVideoUrl`, **но**
  `transcript == null || transcript.totalWords ∈ {null,0}` спустя грейс →
  `reason = 'no_transcript'`.
- Иначе (запись едет / транскрипт есть / статус `recording`/`finalizing`) —
  **пропустить** (не наш случай, пусть AI-ветка отработает).

> **Почему `status: 'completed'` достаточно как фильтр «застряла».** Любая
> встреча с реальной записью уходит из `completed` в `recording_processing →
> recording_ready` (через `promoteMeetingToReady`). Если спустя 15 мин она всё
> ещё `completed` — запись не финализировалась. Дополнительная проверка
> `recording`/`transcript` отсекает редкий гонок-кейс (промоут вот-вот).

**Альтернатива размещения детектора** (на выбор реализатора, эквивалентны):
- (a) отдельный `@Cron('*/5 * * * *', { name: 'meeting-no-analysis-detector' })`
  в `meetings/cron/` или `webhooks/cron/` — **рекомендация** (изолированно,
  легко kill-switch'ить, не трогает горячий путь вебхука);
- (b) delayed BullMQ-job, поставленный в `onRoomFinished` с задержкой
  `GRACE_MIN` — точнее по времени, но добавляет очередь и job-data; для
  редкого события избыточно.

Берём **(a)**.

### 4.4. Идемпотентность (гард «один раз на встречу»)

Перед отправкой — проверить, не уведомляли ли уже:

```ts
const already = await this.prisma.meetingEvent.findFirst({
  where: { meetingId: meeting.id, eventType: 'no_analysis_notified' },
  select: { id: true },
});
if (already) continue;
```

После успешного `sendNotification` — записать маркер (по образцу
`notify.worker.ts:54-64`):

```ts
await this.prisma.meetingEvent.create({
  data: {
    meetingId: meeting.id,
    eventType: 'no_analysis_notified',
    payload: { reason } as Prisma.InputJsonValue,
  },
});
```

`MeetingEvent` без unique → теоретическая гонка двух одновременных тиков. Для
одного крона невозможна (последовательный sweep). Если позже понадобится
строгость — добавить `@@unique([meetingId, eventType])` миграцией (НЕ в этом
ТЗ, см. §6).

---

## 5. Фазы

### Ф1 — Контракт eventType + payload `[ ]`
- Добавить `MeetingNoAnalysisPayloadSchema` в
  `conversational/types/event-payload.registry.ts` + строку в `registry` Map.
- Добавить строку в `EVENT_TYPE_CHANNEL_POLICY`
  (`conversational.service.ts`) по решению владельца §3.
- **Acceptance:** `sendNotification({ eventType:'meeting.no_analysis', payload:{валидный} })`
  проходит `validatePayload` без ошибки; невалидный payload (нет `reason`)
  → `BadRequestException invalid_payload`. `typecheck` + `lint` зелёные.

### Ф2 — Детектор completed-без-записи спустя грейс + отправка `[ ]`
- Новый `@Cron` (`meeting-no-analysis-detector`) по §4.3: выборка кандидатов,
  определение `reason`, вызов `sendNotification` владельцу
  (`recipientUserId = meeting.ownerId`, `tenantId = meeting.tenantId`).
- Зарегистрировать cron-класс в нужном module (`MeetingsModule` или
  `WebhooksModule`), убедиться, что `ConversationalService` доступен в
  контексте (импорт `ConversationalModule`/exports — `[ПРОВЕРИТЬ]`).
- **Acceptance:** на сид-данных — встреча `completed`, `endedAt` старше грейса,
  без `Recording` → крон отправляет ровно одно уведомление владельцу
  (проверяемо: создан `Notification(eventType='meeting.no_analysis')` +
  `NotificationDelivery` на in_app). Встреча с `recording.status='ready'` и
  непустым транскриптом — уведомление НЕ отправляется. Встреча моложе грейса —
  не отправляется.

### Ф3 — Идемпотентность + тест `[ ]`
- Гард §4.4: `findFirst` по `MeetingEvent eventType='no_analysis_notified'`
  до отправки; запись маркера после.
- Unit/integration-тест (vitest): (1) первый прогон шлёт + пишет маркер;
  (2) повторный прогон — no-op (второго `Notification` нет); (3)
  `reason='no_recording'` vs `'no_transcript'` выбираются по состоянию
  Recording/Transcript.
- **Acceptance:** повторный `sweep()` по той же встрече не создаёт второй
  `Notification`; тесты зелёные (`bun run test:unit` для нового spec).

### Ф4 — Документация + реестры `[ ]`
- `second-brain/01_projects/ai-jobs.md` — добавить cron `meeting-no-analysis-detector`
  (что делает, грейс, kill-switch).
- `second-brain/01_projects/conversational-channels.md` (или профильная) —
  новый eventType `meeting.no_analysis`.
- Новая ENV (грейс/kill-switch) → `docs/operations/feature-flags.md` (реестр) +
  `prod-deploy-log.md` Шаг 1; новый cron → `prod-deploy-log.md` Шаг 12 (smoke).
- В исходном ТЗ `2026-06-11-cabinet-inbox-nav-ui-honesty.md` отметить Ф9
  `[x]` со ссылкой на это ТЗ; убрать строку D8 из «Открыто» в
  `second-brain/04_не-сделано/README.md` (если заводилась) либо обновить на
  «вынесено в это ТЗ».
- **Acceptance:** все перечисленные файлы обновлены; `git grep meeting.no_analysis`
  находит и код, и доку.

---

## 6. Идемпотентность / флаги / миграции

- **Kill-switch (тип «аварийный рубильник», ON по умолчанию).** Новая ENV
  `MEETING_NO_ANALYSIS_NOTIFY_ENABLED` (boolean, дефолт `true`) — крон в начале
  `sweep()` проверяет и `return`, если выключено (зеркало
  `compositeReconcileEnabled` в `composite-egress-reconcile.cron.ts:52`).
  Зарегистрировать в `env.schema.ts` + `TypedConfigService` + реестр флагов.
  Это **ON-фича** (Ship-On): выкатываем включённой.
- **Грейс-период.** ENV `MEETING_NO_ANALYSIS_GRACE_MINUTES` (int, дефолт `15`).
  `[ASSUMPTION]` 15 мин — достаточно (наблюдаемая «пауза» reconcile ≤2 мин +
  запас на отложенный egress). Можно вынести в AdminSetting (крутилка) вместо
  ENV — **рекомендация**: оставить ENV в v1 (простой kill-switch-сосед), в
  AdminSetting вынести при необходимости тюнинга на проде.
- **Гард «один раз на встречу»** — `MeetingEvent eventType='no_analysis_notified'`
  (§4.4), без unique-констрейнта (миграции нет). Гонка между тиками одного
  крона невозможна.
- **Миграций нет.** Все используемые поля/модели уже существуют
  (`Meeting.ownerId/tenantId/title/endedAt/status`, `Recording`, `Transcript`,
  `MeetingEvent`). Если владелец захочет строгий гард `@@unique([meetingId,
  eventType])` — это отдельная миграция, **вне** этого ТЗ.
- **Prompt caching** — не применимо (LLM не вызываем; текст детерминированный).

---

## 7. Границы

**✅ Always (делаем без переспроса):**
- Регистрация eventType + payload-схемы по образцу существующих.
- Детектор-крон по образцу `composite-egress-reconcile.cron.ts`.
- Отправка через `ConversationalService.sendNotification`.
- Гард идемпотентности через `MeetingEvent`.
- Kill-switch ON + ENV грейса; обновление реестров/доки.

**⚠️ Ask first (спросить владельца до старта):**
- **Канал доставки** (§3) — `in_app` обязателен; добавлять ли `telegram_bot` /
  `email_smtp`. Это «решение владельца» — без ответа реализацию не начинаем.
- Значение грейса, если 15 мин не устраивает.
- Тексты уведомления (если хотим иную формулировку, чем §4.2).

**🚫 Never (вне ТЗ):**
- Строить новый модуль notifications — используем готовый conversational.
- Чинить причины отсутствия записи (egress/recordByDefault) — это про
  reliability, не про уведомление.
- Трогать успешную AI-ветку (`promoteMeetingToReady`, `notify.worker`,
  `enqueueTranscribe`).
- Слать уведомление сразу в `onRoomFinished` без грейса (ложные срабатывания).
- Любые inline-кнопки/опции ответа (это не probe-вопрос — только информирование).

---

## 8. Definition of Done

- Ф1–Ф4 закрыты, acceptance каждой выполнен.
- `bun run typecheck` + `bun run lint` + `bun run build` (backend) зелёные.
- Новый spec зелёный (`bun run test:unit`).
- Проверено вручную/тестом: встреча `completed` без записи спустя грейс →
  владелец получает ровно одно in_app-уведомление; повтор `sweep` — no-op;
  встреча с записью+транскриптом не триггерит.
- Реестры обновлены: `feature-flags.md`, `prod-deploy-log.md` (Шаг 1 ENV +
  Шаг 12 smoke cron), `ai-jobs.md`, исходное ТЗ Ф9 `[x]`,
  `04_не-сделано/README.md` (строка D8 закрыта/переадресована).
- Prod-инструкция в чате: новая ENV `MEETING_NO_ANALYSIS_NOTIFY_ENABLED` /
  `MEETING_NO_ANALYSIS_GRACE_MINUTES` (дефолты, можно не задавать) + новый cron
  в smoke.

---

## 9. Картография (anchors — проверено на ветке feature/finishable-now-2026-06-11)

| Что | Файл · символ |
|---|---|
| Завершение встречи (точка «молчит») | `backend/src/modules/webhooks/livekit-events.handler.ts` · `onRoomFinished` (`:211-230`) |
| Постановка AI-конвейера (только при записи) | `backend/src/modules/webhooks/meeting-finalization.service.ts` · `promoteMeetingToReady` (`:43-94`) |
| Reconcile-крон (фильтр `compositeEgressId != null`) | `backend/src/modules/webhooks/cron/composite-egress-reconcile.cron.ts` · `sweep` (`:50-97`) |
| Готовый канал доставки | `backend/src/modules/conversational/conversational.service.ts` · `sendNotification` (`:215-355`), `EVENT_TYPE_CHANNEL_POLICY` (`:90-151`), `ensureInAppForUser` (`:985-1010`) |
| Реестр payload-схем + регистрация | `backend/src/modules/conversational/types/event-payload.registry.ts` · `registry` Map (`:380-415`), `validateEventPayload` (`:430-442`), образец `MeetingInvitePayloadSchema` (`:353-359`) |
| Образец записи MeetingEvent (гард) | `backend/src/modules/ai/workers/notify.worker.ts` · `process` (`:54-64`) |
| Модель Meeting (owner/tenant/status/recording/transcript) | `backend/prisma/schema.prisma` · `model Meeting` (`:1243`+), `recording`/`transcript` (`:1320-1321`) |
| Enum статусов | `backend/prisma/schema.prisma` · `enum MeetingStatus` (`:71-93`), `enum RecordingStatus` (`:134-144`) |
| Модели Recording/Transcript/MeetingEvent | `backend/prisma/schema.prisma` · `:1465-1483`, `:1505-1523`, `:1679-1688` |
| Источник выноса (§Ф9) | `plans/tz/2026-06-11-cabinet-inbox-nav-ui-honesty.md` · Ф9 (`:273-279`) |

---

## 10. Итог

**Реализация НЕ начата.** ТЗ готово к работе. **Блокер запуска — одно «да»
владельца** на канал доставки (§3): рекомендация —
`ConversationalService.sendNotification('meeting.no_analysis')` с каналами
`['in_app', 'telegram_bot']` (in_app обязателен, telegram опционально). Канал
существует и протестирован, новый модуль не нужен, миграций нет, фича
выкатывается включённой (kill-switch ON). После «да» — Ф1→Ф4 берёт
tz-orchestrator.

**Что осталось решить владельцу:** (1) канал (in_app vs +telegram vs +email);
(2) грейс-период (дефолт 15 мин); (3) тексты (дефолт §4.2).
