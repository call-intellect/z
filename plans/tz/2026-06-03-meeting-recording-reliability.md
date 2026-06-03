# ТЗ: Надёжность записи встреч — аудиодорожки, участники, видео (v2)

**Дата:** 2026-06-03 (v2 — после PR #17 `fix/egress-phantoms-video-balance`).
**Тип:** ТЗ на реализацию (`plans/tz/`).
**Основание:** анализ `plans/analysis/2026-06-03-meeting-recording-tracks-participants-gaps.md` (корни подтверждены LiveKit-доками/issues/аудитом). Рефлексия: `second-brain/05_история/2026-06-03-transcript-fix-and-recording-gaps.md`.
**SDK:** `livekit-server-sdk ^2.15.3`.

## Принцип v2: что оставляем / что усиливаем / что новое

PR #17 (Tozix) уже закрыл два из трёх симптомов частично. Это ТЗ **не переделывает** его работу, а строится поверх: оставляем верное, усиливаем слабое (с доказательством), добавляем непокрытое.

| Проблема | Сделано в PR #17 | Наша оценка | Действие в этом ТЗ |
|---|---|---|---|
| Участники-фантомы | Фильтр `onParticipantJoined` по префиксу `host:`/`guest:` + cleanup-скрипт | Корень верный (egress = участник), но фильтр по **строковому префиксу** хрупок | **Усилить** до фильтра по `ParticipantKind` (Фаза 2) |
| Видео не играет | `ResponseContentType: video/mp4` + `inline` в presign | Необходимо, но лечит лишь `octet-stream`; главная причина (faststart) не закрыта | **Усилить** faststart-постобработкой (Фаза 3) |
| Потеря per-track дорожек | — (не трогалось) | Главная незакрытая проблема, бьёт по транскрипту | **Новое** — Фаза 1 (P0) |

---

## Фаза 1 — Надёжные per-track аудиодорожки (P0, новое) `[x]`

> **Реализовано 2026-06-03** (коммит `f6d89c80` + харднинг `c57e8fc8`). Гибрид push+pull:
> реактивный `track_published` оставлен; добавлены догон на старте записи
> (`recordings.start` → `reconcileTrackEgress`) и периодическая сверка-cron
> `recording-track-reconcile` (`*/1`, kill-switch `RECORDING_TRACK_RECONCILE_ENABLED`,
> дефолт ON). Идемпотентность: in-process `Set`-lock по `meetingId:identity`
> (прод — один процесс) + DB-дедуп `findFirst(recordingId,livekitIdentity)` +
> вынесен `startTrackEgressLocked`. Фильтр в сверке: `kind=STANDARD(0)` +
> `TrackType.AUDIO(0)`. Метрика `recording_track_egress_failed_total` на провал
> старта egress. Тесты: 6 кейсов (догон STANDARD, пропуск EGRESS/video,
> идемпотентность, неактивная запись, нет записи, метрика при провале).
>
> **Решение по «расширить окно» (п.6):** гейт оставлен на статусе ЗАПИСИ
> `{requested,recording}` (а не «пока встреча active») — это корректнее: важна
> активность записи, а догон+сверка закрывают пропуск окна без риска старта
> egress после остановки composite.
> **`@@unique([recordingId,livekitIdentity])` НЕ добавлен:** push упал бы на
> существующих дублях AudioTrack (а они вероятны — именно дубли мотивировали ТЗ);
> при однопроцессной топологии lock+findFirst достаточны. Зафиксировано как
> future-hardening для мультиреплики (см. итог).

**Проблема:** дорожки спикеров создаются реактивно на webhook `track_published`; теряются на гонке старта записи, reconnect-republish и потере webhook → неполный транскрипт. (Доказано: `ensureTrackEgress` no-op при неактивной записи + нет ретрая + нет догона; webhook'и LiveKit без гарантий доставки — livekit#3976, #3725.)

### Доказательство выбора механизма (3 варианта)

| Критерий | A. Текущий реактивный (push по webhook) | B. **Reconciliation (pull по `listParticipants`)** | C. Auto Egress (`RoomEgress.tracks` при createRoom) |
|---|---|---|---|
| Источник правды | push-webhook (без гарантий доставки) | **состояние комнаты в LiveKit (pull)** | LiveKit-сервер |
| Ловит гонку старта | ✗ | **✓** | ✓ |
| Ловит republish/reconnect | ✗ | **✓ (на следующей сверке)** | ✓ |
| Переживает потерю webhook | ✗ | **✓ (pull не зависит от push)** | ✓ |
| Пишет только AUDIO (нужное для ASR) | ✓ | **✓ (фильтр `TrackInfo.type=AUDIO`)** | ✗ (пишет и видео-треки — оверхед storage) |
| Сохраняет нашу FSM/`AudioTrack`-флоу | ✓ | **✓** | ✗ (старт при createRoom, меняет момент записи — инвазивно) |
| Объём переписывания | — | **малый** | большой (createRoom + FSM + auto-create ветка) |

**Вывод (доказательно):** для НАШЕЙ задачи (per-speaker AUDIO для транскрибации) **вариант B — reconciliation — лучший**. Он берёт надёжность pull-модели (как C), но без двух минусов C: не пишет ненужные видео-треки (C пишет КАЖДЫЙ трек, включая камеру/screenshare → лишний storage и стоимость) и не ломает FSM записи (C стартует egress при createRoom, до нашего `recordings.start`/`recordByDefault`). A проигрывает обоим — push-only структурно теряет треки. C — мощнее, но избыточен и инвазивен именно потому, что решает более общую задачу, чем наша.

### Реализация — гибрид «push для скорости + pull для гарантии»
1. **Оставить** реактивный `track_published → ensureTrackEgress` ([recordings.service.ts:206](../../backend/src/modules/recordings/recordings.service.ts#L206)) как «быстрый старт» (дорожка начинается сразу при публикации).
2. **Догон на старте записи:** в [`recordings.start`](../../backend/src/modules/recordings/recordings.service.ts#L64) после старта — `livekit.listParticipants(meeting.id)` ([livekit.service.ts:159](../../backend/src/modules/livekit/livekit.service.ts#L159)) → для каждого `participant.tracks[]` с `type=AUDIO` и без активного egress → `ensureTrackEgress`. Закрывает гонку «трек опубликован до старта».
3. **Периодическая сверка (reconciliation):** во время `active`/`recording` встречи (новый cron `recording-track-reconcile`, или подмешать в существующий [idle-meeting.cron](../../backend/src/modules/meetings/cron/idle-meeting.cron.ts)) — тот же проход `listParticipants` → создать недостающие track egress. Закрывает republish и потерю webhook. Гарантия: пока участник в комнате с аудио-треком — дорожка будет, не позже следующего тика.
4. **Идемпотентность:** перед стартом egress — проверка `AudioTrack` по `recordingId+livekitIdentity` (уже есть) + `egress.listEgress({roomName})` против дублей.
5. **Ретрай:** в [`ensureTrackEgress` catch](../../backend/src/modules/recordings/recordings.service.ts#L265) — вместо тихого `return` ставить отложенный ретрай; следующая сверка (п.3) — естественный backstop.
6. **Расширить окно:** разрешать `ensureTrackEgress`, пока встреча `active` (не только `requested`/`recording`).

### Критерии приёмки
- Встреча 3 говоривших + умышленный reconnect одного → **3** полные аудиодорожки; транскрипт со всеми тремя.
- Симуляция потери webhook `track_published` (не вызывать handler) → дорожка всё равно создаётся сверкой (п.3).
- Unit: догон вызывает `ensureTrackEgress` по audio-трекам из `listParticipants`; idempotency не плодит дубли; сверка добирает недостающее.

### Файлы
`recordings.service.ts`, `livekit.service.ts` (вернуть `tracks` в listParticipants-маппинге), `webhooks/livekit-events.handler.ts`, новый cron, `recordings.module.ts`, `env.schema.ts` (интервал/флаг сверки).

---

## Фаза 2 — Участники: усилить фильтр egress (P1, усиление PR #17) `[x]`

> **Реализовано 2026-06-03** (коммит `90ca4fc4`). `extractParticipantKind`
> нормализует `kind` из сырого protojson (строка `"EGRESS"` / число `2` /
> отсутствие) к каноничному имени или `null`. `onParticipantJoined`:
> `kind != STANDARD` → no-op; `kind` отсутствует (proto3 опускает дефолт
> STANDARD=0) → fallback на префикс `host:`/`guest:` (PR #17, без регресса для
> гостей). Подтверждено: приёмник парсит `JSON.parse`, НЕ `WebhookReceiver.receive`,
> поэтому строко-/число-/absent-устойчивость обязательна. Тесты: kind=EGRESS
> (строка/число) → no-op даже при ложном префиксе; kind=AGENT → no-op;
> kind=STANDARD → создаётся; absent + EG_ → fallback no-op.

**Оставляем:** корень PR #17 верен (egress-рекордеры = участники с `kind=EGRESS`), cleanup-скрипт хороший (dry-run, идемпотентный).

**Усиливаем — доказательство, почему лучше:** PR #17 фильтрует по **строковому префиксу** identity (`host:`/`guest:`). Это blacklist-by-convention и хрупко:
- ломается, если появится `kind=AGENT` (AI-ассистент) или `kind=SIP` (телефония) с identity без наших префиксов — их либо ошибочно отсекут, либо пропустят;
- зависит от нашей конвенции именования, а не от факта «это сервисный процесс».

LiveKit даёт **семантическое поле `ParticipantKind`** (подтверждено докой: `STANDARD` — конечный пользователь, `EGRESS` — server-side recording, `INGRESS`/`SIP`/`AGENT` — прочие сервисные). Правильный признак «создавать ли `Participant`» — **`kind === STANDARD`**, а не префикс identity. Это whitelist по семантике от самого LiveKit → не ломается на новых типах и не зависит от нашего нейминга.

### Реализация
1. Расширить [`extractParticipant`](../../backend/src/modules/webhooks/livekit-events.handler.ts#L426) — доставать `participant.kind` из webhook-payload (`ParticipantInfo.kind`).
2. В [`onParticipantJoined`](../../backend/src/modules/webhooks/livekit-events.handler.ts#L171): создавать/обновлять `Participant` только при `kind === STANDARD`; иначе no-op. **Префикс-фильтр PR #17 оставить как fallback**, если `kind` в payload отсутствует (defense-in-depth, не регрессируем).
3. Cleanup-скрипт PR #17 оставить (для прошлого префикс-критерий достаточен).

### Критерии приёмки
- Встреча с записью → ноль фантомных `Participant` от egress; список = реальные люди.
- Unit: `participant_joined` с `kind=EGRESS` → no-op; `kind=STANDARD` → создаётся; payload без `kind` + identity `EG_...` → no-op (fallback по префиксу).

### Файлы
`webhooks/livekit-events.handler.ts`, `livekit-events.handler.spec.ts`.

### P2 (опц., вне острой боли): стабильный guest identity
Для надёжности reload гостя — identity по `meetingId+guestId` (cookie/localStorage), `getAccess` читает гостевую куку → фронт авто-джойнит. Не блокирует — основной корень закрыт фильтром. Детали в анализе §1.

---

## Фаза 3 — Видео: faststart (P1, усиление PR #17) `[x]`

> **Реализовано 2026-06-03** (коммиты `d9627c28` + `ON+порог`). `FaststartWorker`
> (`recording.faststart`): скачивает composite → `ffmpeg -c copy -movflags
> +faststart` → перезаливает по тому же S3-ключу (mainVideoUrl/presign не
> меняются, idempotent). Enqueue из webhook `egress_ended`(composite) за флагом
> `RECORDING_FASTSTART_ENABLED` (**дефолт ON** — операция безопасна: `-c copy`,
> перезалив после `exit 0`) + **порог `RECORDING_FASTSTART_MIN_BYTES` (50 МиБ)**:
> мелкий composite не ремуксим (браузер и так играет сразу), экономим
> download+ffmpeg+upload на коротких встречах. `ffmpeg` добавлен в
> `backend/Dockerfile` (попутно чинит `clip.render`, который тоже шеллит ffmpeg).
> Подтверждено Context7: `EncodedFileOutput` MP4 НЕ выставляет faststart-опцию
> → пост-обработка обязательна. Тесты: воркер (skip по флагу/порогу/без URL,
> happy-path) + хендлер (enqueue gating флаг + порог).
>
> **Решение по дефолту (владелец, 2026-06-03):** включить сразу, а не «после
> ffprobe» — механизм moov-в-конце достоверен, операция идемпотентна; порог по
> размеру снимает единственный реальный минус (лишний ремукс мелких файлов).

**Оставляем:** `ResponseContentType: video/mp4` + `inline` из PR #17 ([s3.service.ts](../../backend/src/modules/recordings/s3.service.ts), [recordings.service.ts:679](../../backend/src/modules/recordings/recordings.service.ts#L679)) — необходимый санитарный фикс.

**Усиливаем — доказательство, почему Content-Type недостаточно:**
- Симптом был «**бесконечная крутилка**» (loader при растущей загрузке), а не «ошибка формата / отказ воспроизведения». Неверный `Content-Type` обычно даёт отказ (особенно вне Chrome), а «крутится, пока качается» = плеер **ждёт metadata-атом `moov`**, которого нет в начале.
- Механизм доказан: LiveKit Egress кодирует через GStreamer `qtmux`/`mp4mux`, у которого **`faststart=false` по умолчанию** → `moov` пишется в КОНЕЦ файла. Браузеру `moov` нужен до старта → на большом файле (383 МБ; на встречах 1–2 ч — гигабайты) он тянет весь файл прежде первого кадра. Маленький OGG играет, потому что потоковый и крошечный.
- Вывод: Content-Type мог быть со-фактором (octet-stream), но **для больших/длинных файлов faststart обязателен независимо** от Content-Type. Это не «или-или», а два слоя.

### Реализация
1. **Faststart-воркер** после `egress_ended`(composite): скачать MP4 → `ffmpeg -i in.mp4 -c copy -movflags +faststart out.mp4` (без перекодирования, секунды) → перезалить в S3, обновить `mainVideoUrl`. Гейтинг флагом `RECORDING_FASTSTART_ENABLED`. Идемпотентность по статусу/jobId.
   - `ffmpeg` — бинарь в Docker-образе backend (infra/build-time зависимость; **CLAUDE.md §7 не нарушает** — не Python, не бизнес-логика).
2. **Эмпирическая проверка ПЕРЕД работой:** после деплоя Content-Type фикса PR #17 проверить эту же встречу (383 МБ): играет сразу → причина была octet-stream, faststart понизить; всё ещё ждёт докачки → faststart подтверждён, делать. (DevTools: растёт ли Size к 383 МБ перед стартом; `ffprobe -v trace` — `moov` до/после `mdat`.)

### Критерии приёмки
- Composite 17-мин встречи стартует за пару секунд (не ждёт полной докачки); `ffprobe`: `moov` перед `mdat`.

### Файлы
Новый `recordings/workers/faststart.worker.ts` (+ очередь/триггер на `egress_ended`), `env.schema.ts`, Dockerfile backend (ffmpeg).

---

## Фаза 4 — HLS для длинных встреч (P2, отдельный заход) `[ ]`
Для встреч 1–2 ч рассмотреть `SegmentedFileOutput` (HLS): инкрементальные сегменты, мгновенный старт, нет лимита времени egress, Vidstack играет нативно. Решать после Фазы 3 (faststart может закрыть текущие длительности). Здесь — фиксируем как опцию, не делаем сразу.

## Фаза 5 — Backfill merged.json (опц.) `[ ]`
Скрипт `backend/scripts/backfill-merged-json.ts`: для `Transcript` с `turns != null && mergedS3Url == null` залить merged.json + проставить `mergedS3Url` (иначе старые встречи не оживят behavior/quality/custom-report до ре-merge). Регистрация в `apply-prod-deploy.ts` Шаг 8 (CLAUDE.md).

---

## Прод-аспекты
- **Флаги (Шаг 1 prod-deploy-log):** `RECORDING_FASTSTART_ENABLED`, интервал/флаг reconcile-сверки — kill-switch, дефолт off, поэтапно.
- **Egress-инфра:** контейнер egress с `--cap-add=SYS_ADMIN` (иначе Chrome-composite падает, LiveKit v1.7.5+).
- **Docker backend:** добавить `ffmpeg` (Фаза 3).
- **Мониторинг:** `livekit_egress_available` (Prometheus) — при нехватке ёмкости egress отклоняет запросы (Фаза 1: ретрай/сверка добирают).
- **Switchable endpoints:** S3 из `cfg.s3.*` (forcePathStyle), не хардкодить.

## Риски
- Reconciliation-cron: следить за idempotency (двойной egress на трек) — обязателен `listEgress`/`AudioTrack`-проверка перед стартом.
- Faststart-воркер качает/перезаливает большой файл — нагрузка на сеть/диск воркера; гейтить флагом, мониторить.
- Расширение `extractParticipant` (kind) — проверить, что поле реально приходит в webhook-payload нашей версии LiveKit; иначе работает fallback по префиксу (без регресса).

## Совместимость с prompt caching
Не релевантно — LLM-промпты не затрагиваются.

## Итог

**Реализовано 2026-06-03** (ветка `fix/meeting-recording-reliability`, коммиты
`f6d89c80`, `90ca4fc4`, `d9627c28`, `c57e8fc8`):
- ✅ **P0 Фаза 1** — надёжные аудиодорожки через reconciliation (догон + cron + lock + метрика).
- ✅ **P1 Фаза 2** — фильтр участников по `ParticipantKind` (семантика + префикс-fallback).
- ✅ **P1 Фаза 3** — faststart-воркер видео + ffmpeg в образ (флаг OFF, ждёт прод-проверки).

Верификация: `typecheck` чистый, `eslint` чистый, 47 unit-тестов зелёных
(recordings 22 + webhooks 19 + faststart 4 + др.); независимое strict-review —
критичных/high багов нет, P0/P1 мержабельны. Прод-аспекты — `docs/operations/prod-deploy-log.md`.

**Future-hardening (не блокеры, по итогам ревью):**
- `@@unique([recordingId, livekitIdentity])` на `AudioTrack` — превращает защиту от
  двойного egress из «зависит от одного процесса» в инвариант БД. Нужен ПЕРЕД
  переходом backend на >1 реплику. Перед push — дедуп существующих AudioTrack.
- faststart-маркер «уже сделано» (`Recording.faststartDoneAt`) — short-circuit
  повторного скачивания GB-файла после истечения Redis-дедупа. Только если флаг включат.

**Осталось (P2, отдельные заходы):**
- **Фаза 4** — HLS (`SegmentedFileOutput`) для встреч 1–2 ч (Context7 подтвердил как штатный путь длинных записей).
- **Фаза 2 P2** — стабильный guest identity (надёжность reload гостя).
- **Фаза 5** — backfill merged.json для старых встреч.

Доказательная база (выполнена): сверены по типам `node_modules` сигнатуры
`listParticipants`→`ParticipantInfo.{tracks,kind}`, `TrackType.AUDIO`,
`EgressClient.listEgress`; форма webhook-payload (`JSON.parse` → kind строкой/
числом/absent); отсутствие нативного faststart у `EncodedFileOutput` (Context7).
