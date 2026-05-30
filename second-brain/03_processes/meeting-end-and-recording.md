---
name: meeting-end-and-recording
title: Окончание встречи и сохранение записи в S3
trigger_type: webhook
status_overall: implemented
last_audited: 2026-05-29
owners_human:
  - инженер media-stack
  - продакт встреч
related_plans:
  - plans/tz/2026-05-08-mvp-fullstack-tz.md
  - plans/architecture/2026-05-08-z-architecture.md
related_projects:
  - 01_projects/recording.md
  - 01_projects/meeting-report-pipeline.md
---

# Окончание встречи и сохранение записи

> **Как читать:** разделы 1–4 — для не-программиста. Раздел 5 — для разработчика. Номера шагов между разделами 3 и 5 синхронизированы. Этот процесс — детальная развёртка Шага 2 (и частично Шага 1) процесса [[meeting-post-processing]]: здесь только про FSM встречи и выкачивание медиа-файлов из LiveKit в S3.

## 1. О чём это (бытовой рассказ)

Конец встречи в Z — не одно событие, а небольшая цепочка. В какой-то момент в LiveKit-комнате не остаётся ни одного человека. Через несколько секунд медиа-сервер сам решает: «всё, никого нет, комнату закрываю» — и шлёт нам оповещение `room_finished`. Мы переводим встречу в статус «завершена» и ждём, пока медиа-сервер отдаст файлы.

Запись в Z идёт сразу в нескольких форматах. Есть общий видеофайл (composite) — то, что видно «общим взглядом со стороны»: все участники в плитках, звук смикширован вместе. И отдельно — по одной аудио-дорожке на каждого, кто включал микрофон. Это критично для AI-расшифровки: миксованный звук плохо разделяется по говорящим, а отдельные дорожки дают «кто-когда-что сказал» без ошибок.

Пока встреча идёт, LiveKit-сервер пишет эти файлы себе во временное хранилище. Когда встреча кончилась — медиа-сервер один за другим заканчивает каждую запись («egress») и шлёт нам оповещения «вот запись готова, лежит по такому-то адресу в S3». На каждое такое оповещение мы сохраняем URL, размер, длительность в базу. Когда **все** файлы — и общий, и каждый микрофон — отметились готовыми, мы переводим встречу в финальный статус для медиа: «запись готова». Это сигнал «можно запускать расшифровку», и здесь уже начинается следующий процесс — пост-обработка.

## 2. Что запускает (триггер)

- **Тип:** входящий вебхук от LiveKit (поток событий завершения).
- **Кто инициирует:**
  - LiveKit сам закрывает комнату, когда все ушли → `room_finished`.
  - LiveKit Egress сам заканчивает запись (когда комната закрылась или хост остановил вручную) → `egress_ended` для composite и для каждого track-егресса.
  - Опц.: `egress_failed` если запись фатально упала.
- **Технический источник:** `POST /webhooks/livekit`, ветки `room_finished` / `egress_ended` / `egress_failed` в `LivekitEventsHandler`.

## 3. Шаги процесса (общий список)

1. **LiveKit закрывает комнату** и шлёт нам `room_finished` — встреча переходит из «active» в «completed», ставится `endedAt`. Если есть активная запись — мы её останавливаем, но не явно; LiveKit Egress сам закроет файлы, увидев, что комнаты больше нет.
2. **LiveKit Egress присылает `egress_ended` для общего видео** (composite-MP4): мы сохраняем S3-URL, размер в байтах и длительность в секундах в `Recording`. Метрика «накопленные байты записей» инкрементируется.
3. **LiveKit Egress присылает `egress_ended` для каждой отдельной аудио-дорожки** (per-participant OGG): мы находим `AudioTrack` по `trackEgressId`, заменяем placeholder URL на реальный S3-адрес, ставим длительность, время окончания.
4. **Каждый `egress_ended` пытается «довести» запись до готовности**: проверяем, что общий видеофайл готов (есть `mainVideoUrl`) И все дорожки готовы (у каждой `bytes` есть и `audioUrl` уже не placeholder). Если да — переводим `Recording` в статус «готов».
5. **Если запись готова, протаскиваем встречу по FSM**: `completed → recording_processing → recording_ready`. Каждый переход — отдельный `MeetingEvent` (журнал).
6. **На `recording_ready` ставим в очередь следующий этап** — `AiQueueService.enqueueTranscribe(meetingId)`. С этого момента включается [[meeting-post-processing]].
7. **Если запись фатально упала** (`egress_failed`) — `Recording.status='failed'`, `RecordingAction('failed')`, опц. перевод встречи в `failed` (с `failureReason='recording_failed'`).

## 4. Что получается на выходе

- **БД:**
  - `Meeting.status` идёт по цепочке `active → completed → recording_processing → recording_ready`. Из `recording_ready` дальше пойдёт `transcription_processing` (это уже [[meeting-post-processing]] Шаг 3).
  - `Meeting.endedAt` — стоит.
  - `Recording.status='ready'` (или `failed`), `mainVideoUrl`, `bytesTotal`, `durationSeconds`, `expiresAt` (по тарифу).
  - `AudioTrack[]` с реальными `audioUrl`, `bytes`, `durationSeconds`, `endedAt`.
  - `MeetingEvent`-цепочка `fsm:completed->recording_processing`, `fsm:recording_processing->recording_ready` и оригинальные `egress_ended` payload'ы.
- **S3:**
  - Composite-видео по ключу `meetings/<meetingId>/composite.mp4` (фактический формат ключа — см. `backend/src/modules/recordings/s3-keys.ts`).
  - Один OGG-аудио на каждого спикера по ключу `meetings/<meetingId>/audio/<livekitIdentity>.ogg`.
- **Видно пользователю:**
  - На `/m/<id>` для гостя — placeholder «встреча завершена».
  - Для хоста — `/meetings/<id>/result` (или `/m/<id>` с режимом результата), где появится плеер записи и кнопка «скачать» (presigned URL).
- **Очередь:** `ai.transcribe` получает новый job — начало пост-обработки.

## 5. Технический разрез (по шагам)

| # | Шаг | Что делает технически | Где живёт код | Очередь / cron / эндпоинт | Записывает в БД | Статус |
|---|---|---|---|---|---|---|
| 1 | `room_finished` | `onRoomFinished(meetingId)`: проверяет `meeting.status==='active'` (иначе debug + no-op); `transitionStatus('completed', endedAt=now, reason='livekit:room_finished')`. После — `metrics.incMeetingFinished(meeting.type)`. Сам запись не останавливает — это сделает Egress, увидев, что комнаты нет | `backend/src/modules/webhooks/livekit-events.handler.ts:148-167` | webhook `room_finished` | `Meeting.status='completed'`, `Meeting.endedAt`, `MeetingEvent('fsm:active->completed')` | ✅ |
| 2 | `egress_ended` (composite) | `extractEgressInfo` нормализует payload (LiveKit может слать camelCase/snake_case, `request.case`/`requestType`/`request_type`). При `requestType in ('room_composite','roomComposite')` → `RecordingsService.onCompositeEnded`: обновляет `mainVideoUrl/bytesTotal/durationSeconds`, инкрементирует `recordings_bytes_total`. Длительность из payload приходит в наносекундах — делим на 1e9 и округляем до секунд | `backend/src/modules/webhooks/livekit-events.handler.ts:286-303,438-557`, `backend/src/modules/recordings/recordings.service.ts:492-526` | webhook `egress_ended` | `Recording.mainVideoUrl`, `Recording.bytesTotal`, `Recording.durationSeconds` | ✅ |
| 3 | `egress_ended` (track) | При `requestType==='track'` → `onTrackEnded(meetingId, egressId, payload)`. Находит `AudioTrack` по `trackEgressId`. Заменяет placeholder `audioUrl`(`s3://...`) на реальный, ставит `bytes`, `durationSeconds`, `endedAt`. Метрика `recordings_bytes_total` инкрементируется | `backend/src/modules/webhooks/livekit-events.handler.ts:305-318`, `backend/src/modules/recordings/recordings.service.ts:531-571` | webhook `egress_ended` | `AudioTrack.audioUrl`, `bytes`, `durationSeconds`, `endedAt` | ✅ |
| 4 | Проверка «всё готово» | `tryFinalizeReady(meetingId)`: `compositeReady = !!mainVideoUrl`, `allTracksReady = audioTracks.every(t => t.bytes!==null && t.audioUrl && !t.audioUrl.startsWith('s3://'))`. Если оба — `Recording.status='ready'`, возвращает `{status:'ready', allReady:true}`. Иначе — минимум `'finalizing'` | `backend/src/modules/recordings/recordings.service.ts:617-666` | inline | `Recording.status='ready'` или `'finalizing'` | ✅ |
| 5 | FSM-цепочка `completed → recording_processing → recording_ready` | `maybePromoteMeetingToReady(meetingId, allReady)`: при `allReady=true` читает текущий status. Если `'completed'` — `transitionStatus('recording_processing')`. Перечитывает — если `'recording_processing'`, `transitionStatus('recording_ready')`. Оба перехода в одной webhook-обработке, потому что FSM их связывает | `backend/src/modules/webhooks/livekit-events.handler.ts:355-409`, `backend/src/modules/meetings/fsm/meeting-fsm.ts:17-27` (`completed: ['recording_processing'...]`, `recording_processing: ['recording_ready'...]`) | inline в webhook | `Meeting.status`, `MeetingEvent('fsm:...')` ×2 | ✅ |
| 6 | Enqueue транскрибации | На успехе цепочки FSM — `aiQueue.enqueueTranscribe(meetingId)` (если `AiQueueService` доступен; в юнит-тестах он `@Optional`). Падение enqueue — warning, не блок. Это и есть «передача эстафеты» в [[meeting-post-processing]] | `backend/src/modules/webhooks/livekit-events.handler.ts:383-402` | BullMQ `ai.transcribe` | — | ✅ |
| 7 | `egress_failed` | `onEgressFailed`: `markFailed(meetingId, reason)` пишет `Recording.status='failed'` + `RecordingAction(action='failed', actor='system', reason=...)`. Если `meeting.status` не в `failed`/`ai_ready` — пытается `transitionStatus('failed', failureReason='recording_failed')`. FSM может отказать (уже terminal) — это норма, debug-лог | `backend/src/modules/webhooks/livekit-events.handler.ts:322-348`, `backend/src/modules/recordings/recordings.service.ts:592-610` | webhook (тип `'egress_failed' as never` — LiveKit шлёт это значение, но в `WebhookEventNames` v2 его как литерала нет) | `Recording.status='failed'`, `RecordingAction`, опц. `Meeting.status='failed'` | ✅ |

### 5.1 Структуры данных, через которые проходит процесс

```
Meeting (FSM: active)
  ↓ webhook room_finished
Meeting.status='completed', endedAt=now
  ↓ webhook egress_ended (composite) — может прийти ДО или ПОСЛЕ room_finished
Recording.mainVideoUrl/bytesTotal/durationSeconds
  ↓ webhook egress_ended (track, N штук — по числу спикеров)
AudioTrack[i].audioUrl/bytes/durationSeconds/endedAt
  ↓ tryFinalizeReady — выполнится N+1 раз (каждый egress_ended)
  ↓ как только compositeReady && allTracksReady
Recording.status='ready'
  ↓ maybePromoteMeetingToReady(allReady=true)
Meeting.status='recording_processing' → 'recording_ready'
  ↓ aiQueue.enqueueTranscribe
ai.transcribe job → [[meeting-post-processing]]
```

### 5.2 LLM-вызовы внутри процесса

Нет. Этот процесс только медиа и FSM. LLM подключается в [[meeting-post-processing]] Шаг 5.

## 6. Точки отказа и наблюдаемость

**Prometheus метрики:**
- `livekit_webhook_events_total{type, dedup}` — webhook'и.
- `meeting_finished_total{type}` — на `room_finished`.
- `recordings_bytes_total` — на каждый `egress_ended` (composite + tracks).
- `recordings_deleted_total{reason}` — здесь не пишется, см. [[recording-retention]].

**BullMQ очереди:**
- `ai.transcribe` — enqueue в самом конце (см. Шаг 6).

**Логи:**
- `LivekitEventsHandler` — `«room_finished → meeting.completed»`, `«egress_started: composite/track»`, `«recording_ready: AI-pipeline (transcribe) поставлен в очередь»` / `«AiQueueService недоступен (нет AiModule в контексте)»`.
- `RecordingsService` — `«onCompositeEnded: сохраняем данные composite в БД»`, `«tryFinalizeReady: проверяем готовность записи»` (debug).

**Известные грабли:**
- Порядок `room_finished` vs `egress_ended` **не гарантирован**. `tryFinalizeReady` запускается на каждом `egress_ended` и аккуратно проверяет «все ли готовы», независимо от того, дошёл ли уже `room_finished`. Если `egress_ended` пришёл первым — `Recording.status='ready'` уже стоит, но `Meeting.status` ещё `'active'`. Когда придёт `room_finished` — будет `transitionStatus('completed')`, а дальше `maybePromoteMeetingToReady` уже не сработает на этом событии (вызывается только из `onEgressEnded`). **Это потенциальная дыра**: если порядок именно такой, переход `completed → recording_ready` может не выполниться, и встреча застрянет в `completed`. Проверить с владельцем — возможно, есть страховка через retry/idle-cron, которую я не нашёл.
- `egress_failed` — нет в `WebhookEventNames` v2 как literal-типа, но LiveKit его шлёт. Использован `as never` (`livekit-events.handler.ts:94`).
- `AudioTrack` создаётся с placeholder `s3://bucket/<key>` — `tryFinalizeReady` явно проверяет, что URL **не** начинается с `s3://`. Если LiveKit пришлёт payload без `file.location` (`null`) — placeholder не заменится, и трек никогда не отметится готовым.
- `markCompositeStarted` — страховка на race: если `egress_started` пришёл раньше, чем `RecordingsService.start()` коммитнул запись (теоретически возможно), мы обновляем `Recording.compositeEgressId` уже из webhook'а.
- `enqueueTranscribe` падение → warning, **не** блок. Это значит, что если очередь Redis/BullMQ недоступна в момент `egress_ended`, пост-обработка для этой встречи не запустится автоматически. Нет автоматического retry-цикла на этот случай (есть ручной `POST /meetings/:id/retry-ai`).

**Кнопки админки:** `/admin/meetings/:id` — посмотреть FSM и состояние записи; `POST /meetings/:id/retry-ai` — повторить пост-обработку (host-only, лимит 3/час).

## 7. Связанные процессы

- [[meeting-in-progress]] — что было до окончания встречи (где запись стартовала).
- [[meeting-post-processing]] — главный сквозной процесс, который этот «закрывает на медиа» и передаёт дальше через `ai.transcribe`. Шаг 6 здесь = вход в шаг 3 пост-обработки.
- [[recording-retention]] — отдельный процесс по очистке записей по истечении `expiresAt`.

## 8. Расхождения «задумано vs реализовано»

**Заложено в ТЗ / архитектуре, но реализовано иначе:**
- **Документация (`recording.md` / архитектура §4.4)** говорит про статусы `not_started → requested → recording → finalizing → ready ↘ failed`. В коде `RecordingsService` оставил `finalizing` как промежуточный статус, но `tryFinalizeReady` иногда пропускает его (например, если оба egress'а отметились ENDED в одном вызове, мы сразу попадаем в `ready`). В реальности `finalizing` всё чаще «мигает» очень короткое время.
- **`stop()`** ставит `Recording.status='finalizing'` сразу после `stopEgress`, но это **не** требуется для дальнейшего: webhook `egress_ended` всё равно прилетит и сам прогонит `tryFinalizeReady`. То есть `finalizing` тут — больше для UX (хост видит «вот, остановили»).

**Реализовано, но не описано в ТЗ:**
- **Идемпотентность через `WebhookSeenEvent`** — без дедупа очень легко получить двойной переход FSM, поэтому это критический инвариант. См. `livekit-webhooks.service.ts:57-71`.
- **`maybePromoteMeetingToReady` делает оба FSM-перехода в одном webhook'е**. Это сознательно: FSM их связывает, и разрывать их между двумя webhook'ами было бы хрупко.
- **`metrics.incRecordingsBytes(payload.bytes)`** — учёт байтов записи для биллинга/мониторинга — отдельно от длительности.
- **При `egress_failed` встреча переходит в `failed`** только если ещё **не** в `failed`/`ai_ready`. Это значит: если AI-отчёт уже сгенерирован, провал записи постфактум встречу не валит.

**Потенциальный пробел:**
- Описанный выше race «`egress_ended` пришёл раньше `room_finished`» — не нашёл явной страховки в коде. Если он реален, нужен дополнительный путь FSM-перехода из `room_finished` (если запись уже `ready`, сразу пройти `completed → recording_processing → recording_ready`). **Требует подтверждения от владельца.**

## 9. История изменений процесса

| Дата | Что изменилось | Коммит/рефлексия |
|---|---|---|
| 2026-05-29 | Карточка создана | этот документ |
| 2026-05-08 | FSM (Phase 3.3), webhook-routing, composite + per-track egress | [[plans/tz/2026-05-08-mvp-fullstack-tz]], [[plans/architecture/2026-05-08-z-architecture]] |
