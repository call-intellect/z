---
date: 2026-06-03
tags: [meetings, recordings, livekit, egress, reliability, faststart, webhooks]
distilled: false
---

# Надёжность записи встреч v2 — дорожки, участники, видео (реализация)

## Что было поставлено

Реализовать ТЗ `plans/tz/2026-06-03-meeting-recording-reliability.md` (v2, поверх
PR #17) как оркестратор: P0 Фаза 1 (надёжные per-track аудиодорожки), P1 Фаза 2
(фильтр участников по ParticipantKind), P1 Фаза 3 (faststart видео). Фаза-за-фазой,
с верификацией и независимым ревью, коммиты по фазам, в отдельной ветке.

## Как решал

**Исследование перед кодом (главная ценность фазы).** Прежде чем писать, сверил по
типам в `node_modules` (правило «не угадывай LiveKit API»):
- `ParticipantInfo.{tracks: TrackInfo[], kind: ParticipantInfo_Kind}`, `TrackType.AUDIO=0`,
  `ParticipantInfo_Kind`: STANDARD=0/INGRESS=1/EGRESS=2/SIP=3/AGENT=4.
- **`ParticipantInfo_Kind` НЕ реэкспортируется** из `livekit-server-sdk`, а
  `@livekit/protocol` — не прямая зависимость → нельзя импортировать enum; использую
  числовой литерал `STANDARD=0` с кастом + `KIND_BY_NUMBER`.
- **Вебхук парсится сырым `JSON.parse`** (`livekit-signature.verifier.ts`), НЕ через
  `WebhookReceiver.receive` → `participant.kind` приходит строкой `"EGRESS"` / числом /
  **отсутствует** (proto3 опускает дефолт STANDARD=0). Это определило логику Фазы 2.
- **Топология — ОДИН процесс**: `WorkersModule` импортирован в `AppModule`, отдельного
  worker-контейнера в compose нет (CMD `bun dist/main.js`). Значит in-process Set-lock
  достаточно для идемпотентности (без Redis-лока).
- **ffmpeg НЕ в Docker-образе** (clip-render `spawn('ffmpeg')` сейчас сломался бы) →
  Фаза 3 добавляет `apk add ffmpeg`, попутно чиня clip.render.
- **Context7**: у `EncodedFileOutput` MP4 нет нативной faststart-опции → пост-обработка
  обязательна; HLS `SegmentedFileOutput` — штатный путь длинных встреч (Фаза 4).

**Фаза 1 (коммит `f6d89c80`).** Гибрид push+pull: реактивный `track_published`
оставлен; добавлены догон на старте записи (`reconcileTrackEgress` из `start()`) и
cron `recording-track-reconcile` (`*/1`, флаг `RECORDING_TRACK_RECONCILE_ENABLED` ON).
Идемпотентность: in-process `Set`-lock `meetingId:identity` + DB-дедуп; вынесен
`startTrackEgressLocked` (lock снимается в `finally` даже при ранних return). Reconcile
фильтрует `kind=STANDARD`+`TrackType.AUDIO`. Инъекция `LivekitService` в
`RecordingsService` (оба @Global, циклов нет).

**Фаза 2 (коммит `90ca4fc4`).** `extractParticipantKind` нормализует kind из protojson
(строка/число/absent) → имя/null. `onParticipantJoined`: `kind!=STANDARD` → no-op;
`kind` absent → fallback на префикс `host:`/`guest:` (PR #17, без регресса для гостей).

**Фаза 3 (коммит `d9627c28`).** `FaststartWorker` (`recording.faststart`): скачать →
`ffmpeg -c copy -movflags +faststart` → перезалить по тому же ключу. Enqueue из
webhook `egress_ended`(composite) за флагом `RECORDING_FASTSTART_ENABLED` (OFF).
Воркер тестируемый: `processMeeting` публичный + `runFfmpeg` protected (override в спеке).

**Харднинг по ревью (коммит `c57e8fc8`).** Метрика `recording_track_egress_failed_total`
в catch старта egress (observability-gap, ТЗ §117).

## Что вышло (верификация)

- `bun run typecheck` — чисто (предыдущие ошибки оказались stale Prisma client:
  enum'ы `SystemLogPipeline`/`TrustTier` были в схеме, но клиент не регенерён прошлыми
  сессиями → прогнал `prisma:generate`).
- `eslint` изменённых — чисто.
- vitest: 47 тестов зелёных (recordings 22, webhooks 19, faststart 4 + смежные).
- **Независимое strict-review субагентом**: критичных/high багов нет; P0/P1 мержабельны.
  Подтвердил мои факты (значения enum, однопроцессность, безопасность faststart-перезалива,
  корректность fallback). Из medium внедрил метрику; `@@unique([recordingId,livekitIdentity])`
  осознанно отложил (push упал бы на существующих дублях; при 1 процессе lock достаточно).
- Боевой прогон на проде НЕ делался (нужна реальная встреча 3 участника + reconnect;
  faststart за флагом OFF до прод-проверки `ffprobe`).

## Чему научился / зафиксировать

- **LiveKit webhook ≠ RoomService DTO.** На webhook-пути kind приходит сырым protojson
  (строка/absent), на pull-пути (`listParticipants`) — десериализованный protobuf
  (число с дефолтом 0). Один и тот же `kind` обрабатывается по-разному: строко-устойчиво
  в хендлере, числовым сравнением в reconcile. Нельзя слепо копировать логику между путями.
- **proto3 опускает дефолтные значения.** STANDARD=0 не попадает в JSON webhook'а →
  фильтр «только STANDARD» без fallback'а отрезал бы ВСЕХ реальных участников. Семантический
  фильтр и префикс-fallback — не альтернативы, а слои.
- **Топология процессов — load-bearing факт для идемпотентности.** Прежде чем выбирать
  механизм лока (in-memory Set vs Redis), доказал по compose+WorkersModule, что прод —
  один процесс. Заодно нашёл и поправил устаревшую фразу в `workers-queues.md` про
  `worker:dev`/`src/workers/main.ts` (которого нет).
- **clip-render был латентно сломан** — `spawn('ffmpeg')` без ffmpeg в образе. Фаза 3
  чинит попутно. Урок: грепать инфра-зависимости (бинарь в PATH) при работе с воркерами.
- **stale Prisma client маскируется под «мои» ошибки typecheck.** Ошибки про отсутствие
  enum в `@prisma/client` = клиент не регенерён, не баг кода. Первый шаг при таких —
  `prisma:generate`, не правка кода.

## Открытые хвосты (P2)

- [ ] Боевой тест: 3 участника + умышленный reconnect → 3 полные дорожки.
- [ ] Включить `RECORDING_FASTSTART_ENABLED` после `ffprobe`-проверки moov-в-конце.
- [ ] Фаза 4 — HLS `SegmentedFileOutput` для встреч 1–2 ч.
- [ ] Future-hardening: `@@unique([recordingId,livekitIdentity])` перед переходом на >1 реплику (с дедупом перед push).
- [ ] Фаза 5 — backfill merged.json (отдельно).
