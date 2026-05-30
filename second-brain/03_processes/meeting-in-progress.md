---
name: meeting-in-progress
title: Идёт встреча (медиа, чат, события, запись)
trigger_type: webhook
status_overall: partial
last_audited: 2026-05-29
owners_human:
  - продакт встреч
  - инженер media-stack
related_plans:
  - plans/tz/2026-05-08-mvp-fullstack-tz.md
  - plans/tz/2026-05-22-final-roadmap.md
related_projects:
  - 01_projects/recording.md
  - 01_projects/meeting-types.md
---

# Идёт встреча

> **Как читать:** разделы 1–4 — для не-программиста. Раздел 5 — для разработчика. Номера шагов между разделами 3 и 5 синхронизированы.

## 1. О чём это (бытовой рассказ)

Это «живая» фаза встречи — от момента, когда первый участник зашёл в комнату, и до момента, когда последний из неё вышел. Сам поток картинки и звука идёт напрямую через медиа-сервер LiveKit — наш бэкенд в этом потоке не участвует, мы только слушаем его «оповещения» (вебхуки) и записываем в журнал встречи: кто зашёл, кто вышел, какой трек кто опубликовал, начала ли запись.

Параллельно работает текстовый чат внутри комнаты — это отдельная штука от голоса и видео: каждое сообщение уходит на наш бэкенд через обычный REST-эндпоинт, сохраняется в базу и потом включается в материалы встречи (станет частью транскрипта, и его можно будет процитировать в AI-отчёте). У сообщений есть идемпотентность по `clientMessageId`, чтобы при сетевых ретраях не задвоилось.

У хоста есть «пульт управления» комнатой: он может замьютить участника, попросить опустить руку, выгнать, поставить и снять запись, или нажать «Завершить встречу» — это не команда «остановить и сохранить всё», это команда «удали LiveKit-комнату; дальше встреча сама пройдёт по обычному циклу завершения». Запись по умолчанию стартует автоматически на событии `room_started`, если у встречи стоит флаг «писать по умолчанию» (его выбирает хост при создании). Реал-тайм субтитров в комнате сейчас нет — расшифровка приходит только постфактум, после окончания встречи.

## 2. Что запускает (триггер)

- **Тип:** входящий вебхук от LiveKit (поток событий за всё время жизни комнаты).
- **Кто инициирует:** медиа-сервер LiveKit шлёт `room_started` при первом подключившемся участнике и далее — `participant_joined/left`, `track_published/unpublished`, `egress_started/ended` на протяжении всей встречи.
- **Технический источник:** `POST /webhooks/livekit` (контроллер `LivekitWebhooksController`).
- **Параллельные пользовательские триггеры:** REST-вызовы хостом — `mute/unmute/kick/lower-hand/finish/recording start/stop`, и REST-сообщения чата — `POST /api/v1/meetings/:mid/room-messages`.

## 3. Шаги процесса (общий список)

1. **Первый участник подключился к LiveKit-комнате** — медиа-сервер шлёт `room_started`, встреча переходит из «scheduled» в «active», ставится `startedAt`. Если у встречи `recordByDefault=true` — сразу же стартует общая запись (composite).
2. **Каждый раз, когда участник заходит или выходит**, LiveKit шлёт `participant_joined`/`participant_left`. Платформа ставит `joinedAt`/`leftAt` на запись Participant'а.
3. **Когда участник публикует свой микрофон**, LiveKit шлёт `track_published`. Если запись активна — на каждый аудио-трек участника запускается отдельный egress в S3 (для последующего разделения по спикерам).
4. **Все события встречи** (включая участников, чат, host-actions) пишутся в журнал `MeetingEvent` для последующего аудита и AI-анализа.
5. **Чат комнаты:** каждое сообщение в `ChatPanel` идёт `POST` на бэкенд, валидируется по `MeetingMember`, сохраняется в БД с дедупликацией по `clientMessageId`. Throttle 30 сообщений/минуту на пользователя.
6. **Управление участниками хостом:** mute/unmute, kick, опустить руку — host вызывает REST, бэкенд дёргает LiveKit Server SDK и пишет `host_action:<тип>` в `MeetingEvent`.
7. **Запись:** хост может вручную нажать «Начать запись» / «Остановить запись» (`POST /recording/start|stop`). Auto-start работает на `room_started` если `recordByDefault=true`. Per-participant аудио-треки записываются автоматически по `track_published`.
8. **Idle-сборка:** если встреча активна больше `IDLE_MEETING_TIMEOUT_MINUTES` и в LiveKit нет участников, крон каждую минуту удаляет комнату. Webhook `room_finished` затем переведёт встречу в `completed`.
9. **Хост «Завершить встречу»:** `POST /meetings/:id/finish` → удаление room через LiveKit Server SDK → ждём `room_finished` для FSM-перехода (синхронно встречу мы не дёргаем — это всё делает webhook handler).

## 4. Что получается на выходе

- **На стороне платформы:**
  - `Meeting.status='active'`, `startedAt` — стоит, `endedAt` — пока нет.
  - `Participant.joinedAt`/`leftAt` — отражают реальное присутствие.
  - `MeetingEvent` — журнал всех событий по встрече (тип-событие + payload).
  - `MeetingChatMessage` — все сообщения в room-chat'е (mapped как `MeetingChatMessage` в `RetentionService.processExpiredChatMessages`).
  - `Recording.status='requested'` или `'recording'`, `compositeEgressId` — заполнен; `AudioTrack` — по одному на каждый опубликованный аудио-трек.
- **На стороне пользователя:** живой звук, видео, экран; чат-панель; кнопки «руку поднять», «выйти», у хоста — пульт.
- **Видно:** только в самой LiveKit-комнате (`/m/<id>`, рендерится `<MeetingRoom>`). В дашбордах активная встреча НЕ показывается отдельным виджетом — только в списке `/meetings` со статусом `active`.

## 5. Технический разрез (по шагам)

| # | Шаг | Что делает технически | Где живёт код | Очередь / cron / эндпоинт | Записывает в БД | Статус |
|---|---|---|---|---|---|---|
| 1 | `room_started` | Проверка подписи + дедуп по `eventId` → `MeetingEvent.create({eventType:'room_started'})` → `transitionStatus(scheduled→active, startedAt=now)` → если `recordByDefault && this.recordings` — `recordings.start(meetingId, ownerId)` в `catch` (non-fatal) | `backend/src/modules/webhooks/livekit-webhooks.service.ts:43-106`, `backend/src/modules/webhooks/livekit-events.handler.ts:108-144` | `POST /webhooks/livekit` (event=`room_started`) | `WebhookSeenEvent`, `MeetingEvent`, `Meeting.status='active'`, `Meeting.startedAt`, опц. `Recording`, `RecordingAction` | ✅ |
| 2 | `participant_joined` / `participant_left` | `participant_joined`: ищем `Participant` по `(meetingId, livekitIdentity)`. Если есть — `joinedAt=now`. Если нет — отказоустойчиво создаём (role вычисляется по префиксу identity `host:`/`guest:`, `isRegisteredUser=false`); `P2002` (race) → молча. `participant_left`: `updateMany({leftAt=now})` | `backend/src/modules/webhooks/livekit-events.handler.ts:171-236` | webhook events | `Participant.joinedAt`/`leftAt`, опц. новый `Participant` | ✅ |
| 3 | `track_published` (audio) | Если запись `requested`/`recording` — `ensureTrackEgress`: проверяет, есть ли уже `AudioTrack` по `livekitIdentity`; если нет — `startTrackEgress` → создаёт `AudioTrack` с placeholder URL `s3://bucket/<trackKey>`, `startedAt=now`, `endedAt=now`, `durationSeconds=0`. Реальные значения дополнятся в `egress_ended`. Non-audio треки — пропускаются (`track.kind` нормализуется по proto3: AUDIO=0/'', VIDEO=1/'video', DATA=2/'data') | `backend/src/modules/webhooks/livekit-events.handler.ts:240-260,443-465`, `backend/src/modules/recordings/recordings.service.ts:206-312`, `backend/src/modules/recordings/livekit-egress.client.ts:78-102` | webhook event + LiveKit Egress API | `AudioTrack`, опц. `Recording.status='recording'` (через `markCompositeStarted`) | ✅ |
| 4 | Журнал событий | После дедупа `LivekitWebhooksService` пишет `MeetingEvent({meetingId, eventType, payload})` для **любого** события с известным `meeting.id`. FSM-переходы добавляют `MeetingEvent({eventType:'fsm:<from>->to>'})` через `MeetingsService.transitionStatus` | `backend/src/modules/webhooks/livekit-webhooks.service.ts:77-93`, `backend/src/modules/meetings/meetings.service.ts:577-609` | webhook + inline | `MeetingEvent` | ✅ |
| 5 | In-meeting chat | REST `POST /api/v1/meetings/:meetingId/room-messages` под `MeetingMemberGuard` (проверяет, что пользователь — host или Participant). Идемпотентность по `clientMessageId` через `RoomMessagesRepository.upsert`. Throttle 30/мин на пользователя. `GET ?since=<ISO>` — лента до 1000 сообщений | `backend/src/modules/room-messages/room-messages.controller.ts`, `room-messages.service.ts`, `frontend/src/ui/components/meeting-room/ChatPanel.tsx` | `POST /api/v1/meetings/:mid/room-messages` | `MeetingChatMessage` (модель внутри `room-messages` пакета; на ретеншене эта таблица проходит как `MeetingChatMessage`) | ✅ |
| 6 | Host controls (mute/kick/lower-hand) | `POST /meetings/:id/participants/:pid/{mute,unmute,kick,lower-hand}` под `CookieAuthGuard` + `RequireSubscription`. Проверка `ownerId===userId` + `status==='active'`. Mute: `livekit.muteParticipant` (mute каждого published track через `mutePublishedTrack`). Kick: `removeParticipant`. Lower-hand: `updateParticipantAttributes({hand_raised:'false'})`. Каждое — `MeetingEvent.host_action:<тип>` | `backend/src/modules/meetings/meetings.controller.ts:249-296`, `backend/src/modules/meetings/host-controls.service.ts:33-100`, `backend/src/modules/livekit/livekit.service.ts:170-198` | `POST /meetings/:id/participants/:pid/*` | `MeetingEvent({eventType:'host_action:<action>'})` | ✅ |
| 7 | Запись (start/stop) | Auto-start на `room_started`: см. Шаг 1. Manual `POST /meetings/:id/recording/start` — проверяет `meeting.status==='active'`, `recording.status not in ('not_started','failed')` → запускает composite egress в S3 (`compositeKey(meetingId)`), upsert `Recording({status:'requested', expiresAt=now+retentionDays})`, `RecordingAction(action='created', actor='user:<uid>')`. Manual `stop` — `stopEgress(composite)` + всех track egress'ов, `Recording.status='finalizing'` | `backend/src/modules/recordings/recordings.controller.ts`, `recordings.service.ts:60-196`, `livekit-egress.client.ts:51-121` | `POST /meetings/:id/recording/start\|stop`, LiveKit Egress API | `Recording`, `RecordingAction` | ✅ |
| 8 | Idle-сборка комнаты | `@Cron('*/1 * * * *')` IdleMeetingCron: `meeting.status='active'` AND `startedAt < now - cfg.idle.timeoutMinutes`. Для каждого кандидата — `livekit.listParticipants`; если массив пустой — `livekit.deleteRoom`. Дальше — webhook `room_finished` сам сделает FSM-переход | `backend/src/modules/meetings/cron/idle-meeting.cron.ts` | cron `*/1 * * * *` | — (триггерит room_finished webhook опосредованно) | ✅ |
| 9 | Host «Завершить» | `POST /meetings/:id/finish` под `CookieAuthGuard + RequireSubscription`. `HostControlsService.finish`: проверка ownership + `status==='active'` (иначе `InvalidFsmTransitionError`) → `MeetingEvent({eventType:'host_action:finish'})` → `livekit.deleteRoom`. **FSM-переход НЕ делаем здесь** — его сделает `room_finished` webhook. Это специально: ровно один источник перехода | `backend/src/modules/meetings/meetings.controller.ts:297-306`, `backend/src/modules/meetings/host-controls.service.ts:91-100+` | `POST /meetings/:id/finish` | `MeetingEvent` | ✅ |

### 5.1 Структуры данных, через которые проходит процесс

```
Meeting (FSM: scheduled → active)
  ↓ webhook room_started
Meeting.status='active', Meeting.startedAt=now
  ↓ (если recordByDefault) recordings.start()
Recording{status='requested', compositeEgressId}
  ↓ webhook participant_joined / track_published (за всю встречу)
Participant.joinedAt/leftAt
AudioTrack (по одному на каждого спикера) — placeholder URL
MeetingChatMessage (если в чате писали)
MeetingEvent[] — журнал всего
  ↓ host finish ИЛИ idle-cron deleteRoom ИЛИ все ушли сами
LiveKit отдаёт room_finished — но этот переход уже в [[meeting-end-and-recording]]
```

### 5.2 LLM-вызовы внутри процесса

Нет. Все LLM-агенты включаются после `recording_ready` (см. [[meeting-post-processing]] Шаг 5). Concierge / AI-помощник внутри активной встречи **не интегрирован**.

## 6. Точки отказа и наблюдаемость

**Prometheus метрики:**
- `livekit_webhook_events_total{type, dedup}` — приём вебхуков (через `eventsTotal.inc` в `LivekitWebhooksService`).
- `meeting_finished_total{type}` — пишется в `room_finished` (уже за пределами этого процесса).

**BullMQ очереди:** нет — все шаги синхронные (REST + webhook).

**Логи:**
- `LivekitEventsHandler` — `room_started`/`room_finished`/`track_published`/`egress_*`.
- `LivekitWebhooksService` — `«LiveKit webhook принят»` / `«LiveKit webhook: дубликат»`.
- `RecordingsService` — `«Recording start»`, `«ensureTrackEgress: запускаем track egress»`.
- `IdleMeetingCron` — `«Idle-cron: room удалена»` / `«Idle-cron: участники ещё в room»`.

**Известные грабли:**
- LiveKit может прислать webhook **дублем** — `WebhookSeenEvent` с уникальным PK (`eventId`) спасает: вторая попытка ловит `P2002` и no-op.
- `egress_failed` — нет в `WebhookEventNames` v2 как literal-типа, но LiveKit его шлёт. Поэтому в `switch` используется `'egress_failed' as never` для совместимости (`livekit-events.handler.ts:94`).
- `track.kind` иногда приходит без поля для AUDIO (proto3 не сериализует дефолт `0`) — поэтому в `extractTrack` пустой kind трактуется как audio.
- Auto-start записи в `room_started` — non-fatal: если упало, логируется warning, встреча идёт без записи (хост может стартануть руками).
- AudioTrack создаётся с placeholder URL `s3://bucket/<key>` — реальный URL приходит только в `egress_ended`. `tryFinalizeReady` явно проверяет, что URL **не** начинается с `s3://`, иначе считает трек незаконченным.

**Кнопки админки:** `/admin/meetings/:id` — посмотреть `MeetingEvent`, состояние Recording, AudioTrack.

## 7. Связанные процессы

- [[meeting-create-and-invite]] — что было до начала встречи (хост и гости получили ссылки и host/guest-токены).
- [[meeting-end-and-recording]] — что будет после ухода последнего участника (room_finished, egress_ended).
- [[meeting-post-processing]] — пост-обработка после `recording_ready`.
- [[recording-retention]] — как с записями расстаются по истечении срока.

## 8. Расхождения «задумано vs реализовано»

**Заложено в ТЗ, но не реализовано:**
- **Live subtitles / live ASR во время встречи** — компонента субтитров в `meeting-room/` нет, hook на распознавание в реальном времени отсутствует. Расшифровка приходит только постфактум (см. [[meeting-post-processing]] Шаг 3). Для аудитории, где это критично (продажи / онбординг гостей-неносителей языка), отдельный план потребуется.
- **Concierge / AI-помощник внутри активной встречи** — `feedback_concierge_text_only_output` оставляет место для текстового помощника, но в `MeetingRoom.tsx` его нет. Concierge живёт вне встречи (только в `/dashboard`/глобально), сигналы `MeetingEvent({eventType:'concierge_signal'})` не пишутся.
- **In-meeting чек-ин / опросы** — отдельных эндпоинтов нет; `MeetingEvent` поддерживает произвольный `eventType`, но запись/чтение специальных сигналов внутри встречи (например, «сейчас поднимем руку у тех, кто согласен») не реализованы.

**Реализовано иначе:**
- **«Finish» хостом** не делает FSM-переход синхронно — только удаляет LiveKit-room и ждёт `room_finished` webhook. Это специально: ровно один источник перехода (см. [[meeting-end-and-recording]]). Минус — если LiveKit-webhook потерялся, встреча останется в `active`, пока `IdleMeetingCron` не подберёт.
- **Idle-сборка** работает по `startedAt < now - timeoutMinutes`, а не по `lastSeen < ...`. Если встреча шла часами и в момент проверки кто-то есть — мы её не трогаем; если же все ушли и никто не входит — `deleteRoom`. Подход проще, но «странные» затяжные встречи никогда не самосвернутся, пока идут.
- **Запись по умолчанию = `true`** на уровне `MeetingsRepository.create` (`recordByDefault: data.recordByDefault ?? true`). UI Wizard'а позволяет это отключить (галочка в форме создания).

**Реализовано, но не описано в ТЗ:**
- **Шумоподавление** — `frontend/src/lib/livekit/noise-suppression.ts` + `buildAudioCaptureOptions`. Включается из настроек браузера до входа в комнату, на лету не меняется (нужно пересоздать трек).
- **Fullscreen-режим** комнаты — в `MeetingRoom.tsx` через `document.requestFullscreen`. Не описан в ТЗ.
- **`MeetingMemberGuard`** для room-chat'а — отдельный гард, который определяет, кто такой пользователь относительно встречи (host или участник), для guest используется JWT-cookie. Дает room-chat доступ гостям без cookie-auth.

## 9. История изменений процесса

| Дата | Что изменилось | Коммит/рефлексия |
|---|---|---|
| 2026-05-29 | Карточка создана | этот документ |
| 2026-05-25 | recordByDefault → `true` по умолчанию | [[01_projects/recording]] |
| 2026-05-21 | Шумоподавление в `MeetingRoom` | — |
| 2026-05-08 | Базовый webhook-routing + idle-cron | [[plans/tz/2026-05-08-mvp-fullstack-tz]] |
