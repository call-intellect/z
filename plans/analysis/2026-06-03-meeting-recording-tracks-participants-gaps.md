# Анализ: надёжность записи встречи — аудиодорожки, участники, видео-плеер

**Дата:** 2026-06-03
**Статус:** глубокое исследование завершено (LiveKit-доки + issues + аудит кода через 4 агента). Корни **подтверждены**, не гипотезы. Реализация — отдельным ТЗ.
**Встреча-образец:** `01KT65ZKXJRHXMT5GC4N51E52C` (прод meet.crossmark.ru). Владелец присутствовал лично, **слышал всех 3 участников** (микрофоны работали). Симптомы: видео не играет, 2 аудиодорожки вместо 3 (одна 38 сек), 6 участников вместо 3, транскрипт не подтягивался.

> ⚠️ Видео / дорожки / участники — **НЕ починены**. Починено только отображение транскрипта (см. §0). Ниже — корневой разбор и план.

---

## 0. Что уже починено (контекст)

`MergeWorker` не зеркалил `merged.json` в S3 и не проставлял `Transcript.mergedS3Url` → `/transcript` падал в 404, behavior/quality/custom-report пропускались; эндпоинт отдавал presigned-URL вместо `turns`. Исправлено (коммит `64738b49`). **Но транскрипт всё равно будет неполным, пока не починены per-track дорожки** — они вход транскрибации.

---

## 1. «6 участников вместо 3» — баг НАШЕЙ генерации identity (не LiveKit)

### Подтверждённый механизм
LiveKit **сохраняет `identity` при reconnect** — при обеих формах (resume и full reconnection). Клиент переиспользует тот же токен на всю сессию; *«Expiration time only impacts the initial connection, and not subsequent reconnects»*. Identity **уникален в комнате**: при коллизии LiveKit выкидывает старую сессию (`DUPLICATE_IDENTITY`). Вывод: **если бы identity был стабилен, дубли были бы физически невозможны.** Значит на каждый заход выдавался НОВЫЙ identity.

### Где в коде
- [participants.service.ts:197](../../backend/src/modules/participants/participants.service.ts#L197): `const guestId = nanoid(); livekitIdentity = ` + "`guest:${guestId}`" + ` — новый случайный при каждом проходе ветки создания гостя.
- Cookie-reuse МЕХАНИЗМ есть: [participants.service.ts:154-183](../../backend/src/modules/participants/participants.service.ts#L154) переиспользует identity из подписанной куки `guest_session_<meetingId>` (TTL 24ч). НО он **хрупок и не срабатывает на практике**:
- **Корень хрупкости:** [meetings.service.ts:476-487](../../backend/src/modules/meetings/meetings.service.ts#L476) `getAccess` определяет роль **только по `userId`**; для анонимного гостя всегда `role: 'none'`, куку не читает. → при reload страницы фронт ([MeetingPageShell.tsx](../../frontend/app/(public)/m/[id]/MeetingPageShell.tsx)) ведёт гостя через форму имени заново. При любом сбое доставки куки (другой поддомен/`cookieDomain`, приватный режим, очистка, истечение) → новый `nanoid` → новая строка Participant.
- `onParticipantJoined` ([livekit-events.handler.ts:171](../../backend/src/modules/webhooks/livekit-events.handler.ts#L171)) матчит по `meetingId+livekitIdentity` — новый identity = новая строка.

**Итог:** 3 человека + повторные заходы/reload (особенно участник без видео, переподключавшийся) = 6 строк. Это **наш** баг, не LiveKit. Усугубляется тем, что webhook'и LiveKit неполны/переупорядочены (livekit#4227, #1130) — строить записи участников только на `participant_joined` нельзя.

### Фикс (реализация в ТЗ)
1. `getAccess` ([meetings.service.ts:476](../../backend/src/modules/meetings/meetings.service.ts#L476)) — читать куку `guest_session_<meetingId>`, для валидной возвращать `role: 'guest'` (+ identity), чтобы фронт авто-джойнил, а не показывал форму имени. Прокинуть куку из контроллера.
2. Стабилизировать guest identity по бизнес-ключу `meetingId + guestId` (guestId генерится ОДИН раз на первом входе, сохраняется в cookie/localStorage, переиспользуется). Best practice LiveKit: identity задаёт клиент, переиспользуя сохранённое значение.
3. TTL гостевого токена ≥ длительности встречи (уже 4ч дефолт / до endedAt+5мин — приемлемо).
4. Подстраховка для накопленных дублей: дедупликация/схлопывание участников по имени+интервалу в UI и для AI.

---

## 2. «2 дорожки вместо 3 + обрывок 38 сек» — реактивная модель записи фундаментально ненадёжна

### Подтверждённый механизм
Per-track дорожки создаются **реактивно**: на webhook `track_published(audio)` вызываем `startTrackEgress`. У этого три независимых класса потери:
1. **Webhook'и не гарантированы.** Официально LiveKit: *«webhooks have no guarantees around delivery»*. Потерян `track_published` 3-го участника → дорожки нет навсегда. Подтверждающие issues: [livekit#3976](https://github.com/livekit/livekit/issues/3976) (доходит только первый webhook), [#3725](https://github.com/livekit/livekit/issues/3725) (`track_published` без room после reconnect).
2. **Гонка «опубликовал до старта записи» + reconnect-republish.** Реактивная подписка ловит только момент публикации; повторного `track_published` нет.
3. **Обрывок 38 сек** = egress стартовал поздно / участник переподключился, старая дорожка закрылась, новую не подхватили. Симптом совпадает с [agents#3197](https://github.com/livekit/agents/issues/3197) (audio missing in egress).

Дополнительно: track composite не пишет mute-нутые на старте треки ([egress#203](https://github.com/livekit/egress/issues/203)); при нехватке CPU-ёмкости egress возвращает «no response from egress service» → в нашей модели тихая потеря (нет ретрая).

### Где в коде (аудит подтвердил)
- [livekit.service.ts:113-142](../../backend/src/modules/livekit/livekit.service.ts#L113) `ensureRoom` → `createRoom({ name })` — **поле `egress` НЕ передаётся**. Auto Egress отсутствует. Хуже: при недоступности LiveKit комната auto-create при первом join — `createRoom` вообще не выполняется.
- [recordings.service.ts:206-312](../../backend/src/modules/recordings/recordings.service.ts#L206) `ensureTrackEgress`: no-op если статус ∉ {recording, requested} ([:215](../../backend/src/modules/recordings/recordings.service.ts#L215)); **нет ретрая** при ошибке startTrackEgress ([:265-277](../../backend/src/modules/recordings/recordings.service.ts#L265) — только log + return).
- **Догон уже опубликованных треков отсутствует** — `listParticipants` к записи нигде не привязан.
- Composite ([livekit-egress.client.ts:51](../../backend/src/modules/recordings/livekit-egress.client.ts#L51)) пишет полный микс → поэтому всех слышно; per-track ([:78](../../backend/src/modules/recordings/livekit-egress.client.ts#L78)) теряется.

### Правильное решение — Auto Egress (декларативно при createRoom)
LiveKit умеет писать каждый трек САМ, без реактивного webhook, через `RoomService.createRoom({ egress: RoomEgress })`:
```
RoomEgress {
  room        // RoomCompositeEgressRequest — наш текущий composite (оставить)
  tracks      // AutoTrackEgress — отдельный OGG на КАЖДЫЙ аудио-трек (нужное нам)
  participant // AutoParticipantEgress — на участника (с транскодингом, дороже)
}
AutoTrackEgress { filepath: "…/{room_name}-{publisher_identity}-{time}", output: S3Upload }
```
`AutoTrackEgress` пишет сырой Opus→OGG (идеально для ASR, без транскодинга), покрывает треки опубликованные до/во время/после старта, mute-на-старте и republish после reconnect. Это снимает всю гонку. (Proto: `livekit_room.proto` `RoomEgress egress = 6`; Node SDK `CreateOptions.egress?: RoomEgress`.)

### Фикс (реализация в ТЗ)
1. **Главное:** в `ensureRoom` ([livekit.service.ts:113](../../backend/src/modules/livekit/livekit.service.ts#L113)) добавить `egress: RoomEgress` с `AutoTrackEgress` (+ оставить composite). Сверить точный API SDK через Context7 (структура `RoomEgress` менялась между версиями). Учесть ветку auto-create — гарантировать, что комната создаётся через `createRoom` (с egress), а не неявно.
2. **Догон-fallback:** при старте записи `listParticipants(roomName)` → для каждого audio-трека без egress вызвать `startTrackEgress`. Закрывает гонку, если Auto Egress по комнате не настроен.
3. Сделать реактивный `startTrackEgress` идемпотентным (проверка `listEgress` по trackId) и с **ретраем** при ошибке (вместо тихого return).
4. Расширить окно ensureTrackEgress до статуса `active` (а не только requested/recording), чтобы republish не терялся.
5. Прод-инфра: egress-контейнер с `--cap-add=SYS_ADMIN` (иначе Chrome-composite падает, v1.7.5+); мониторить `livekit_egress_available`.

---

## 3. Видео: «вечная крутилка» большого MP4 = нет faststart (moov в конце)

### Подтверждённый механизм
LiveKit Egress кодирует через GStreamer (`qtmux`/`mp4mux`), у которого **`faststart=false` по умолчанию** → атом `moov` (оглавление/смещения кадров) пишется в КОНЕЦ файла. Браузеру `moov` нужен ДО старта → при moov-в-конце он качает весь файл прежде первого кадра.
- Маленький OGG (12 МБ) играет — потоковый контейнер, метаданные в начале.
- Большой MP4 (**383 МБ / 17 мин**) — плеер крутится всё время докачки 383 МБ. На встречах 1–2 ч — гигабайты, «бесконечно».

Это объясняет все симптомы сразу: большой ≠ играет, маленький = играет, файл в S3 целый.

### Вторичные факторы
- **Range/206:** прогрессивное video требует `Accept-Ranges: bytes` + `206`. S3-совместимые (reg.ru/MinIO) обычно поддерживают, но без faststart всё равно не заиграет.
- **Content-Type:** если egress залил MP4 как `application/octet-stream` — браузеры кроме Chrome отказывают. Лечится `ResponseContentType: 'video/mp4'` в presigned GET (дёшево, делать в любом случае).

### Фикс (реализация в ТЗ)
1. **Faststart-постобработка** после egress: `ffmpeg -i in.mp4 -c copy -movflags +faststart out.mp4` (без перекодирования, секунды), перезалить в S3. Единственный фикс, точно лечащий крутилку. *(ffmpeg = бинарь/infra-зависимость, не Python в backend-пути — CLAUDE.md §7 не нарушает; вызов subprocess из TS-воркера допустим.)*
2. **Стратегически для длинных встреч:** `SegmentedFileOutput` (HLS) вместо одного MP4 — сегменты пишутся инкрементально, плеер играет сразу, нет лимита времени egress. Vidstack играет HLS нативно.
3. **Сразу:** `ResponseContentType: 'video/mp4'` в [presignGet](../../backend/src/modules/recordings/s3.service.ts#L45) для composite.

### Диагностика (подтвердить за минуту)
DevTools → Network на `composite.mp4`: `Content-Type` (video/mp4?), `Accept-Ranges`/206, и **ползёт ли Size к ~383 МБ перед стартом** (если плеер ждёт ~100% — moov-в-конце подтверждён). Надёжнее: `ffprobe -v trace` / `ffmpeg -v trace -i` — где `moov` относительно `mdat`.

---

## Системный вывод

Это **одна проблема надёжности записи**, не три:
- Нестабильный guest identity (§1) множит участников И ломает привязку дорожек (AutoTrackEgress matchit по identity).
- Реактивная модель egress (§2) теряет per-track дорожки → неполный транскрипт и AI-отчёт.
- Видео (§3) — независимый трек про доставку больших файлов, критичный для длинных встреч.

Правильная архитектура по LiveKit: **декларативный Auto Egress при createRoom + стабильный identity + faststart/HLS**, вместо реактивной webhook-модели.

## План реализации (ТЗ, по приоритету)
- [ ] **P0** Auto Egress (AutoTrackEgress) при createRoom + догон listParticipants + ретрай. → чинит дорожки/транскрипт.
- [ ] **P0** Стабильный guest identity (getAccess читает куку + identity по meetingId+guestId). → чинит участников и привязку дорожек.
- [ ] **P1** Faststart-постобработка MP4 + `ResponseContentType: video/mp4`. → чинит видео.
- [ ] **P2** HLS SegmentedFileOutput для длинных встреч.
- [ ] (опц.) backfill merged.json для старых встреч.

## Источники (LiveKit)
- Auto Egress: https://docs.livekit.io/home/egress/autoegress/ · Track Egress: https://docs.livekit.io/home/egress/track/ · Participant: https://docs.livekit.io/home/egress/participant/ · Outputs/HLS: https://docs.livekit.io/home/egress/outputs/
- Webhooks (no delivery guarantee): https://docs.livekit.io/intro/basics/rooms-participants-tracks/webhooks-events/
- Identity/reconnect: https://docs.livekit.io/home/client/connect/ · https://docs.livekit.io/intro/basics/rooms-participants-tracks/participants/ · Tokens: https://docs.livekit.io/frontends/authentication/tokens/
- Proto RoomEgress/AutoTrackEgress: https://github.com/livekit/protocol/blob/main/protobufs/livekit_egress.proto
- GStreamer qtmux faststart/moov: https://gstreamer.freedesktop.org/documentation/isomp4/qtmux.html · https://blog.livekit.io/livekit-universal-egress-launch/
- MP4 faststart объяснение: https://cleverutils.com/mov-to-mp4/faststart-web-video · Range и video: https://www.zeng.dev/post/2023-http-range-and-play-mp4-in-browser/
- Issues: livekit/livekit#3976, #3725, #4227, #1130; livekit/agents#3197, #656, #4705; livekit/egress#203, #143, #847
