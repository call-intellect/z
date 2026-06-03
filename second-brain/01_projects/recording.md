---
type: project
---

# Recording — запись встречи

Запись делаем **обязательно в двух форматах**. Это критичное архитектурное решение для AI.

## 1. Общая запись встречи

Обычная запись для человека: `видео + общий звук + screen share`.

Используется для просмотра встречи постфактум.

## 2. Отдельные аудиодорожки участников

**Это критически важно для AI.** Для каждого участника отдельный аудиофайл.

Метаданные на трек:
```
participant_id
participant_name
track_id
audio_file_url
started_at
ended_at
```

**Зачем:**
- точная расшифровка
- разделение по спикерам
- понимание, кто что сказал
- анализ продаж
- анализ собеседования
- задачи и договорённости
- AI-чат по встрече

**Правило:** не полагаться только на общий аудиомикс — он хуже для анализа.

## Хранение

- **Prod:** Yandex Object Storage (внешний облачный S3, durability 11 девяток).
- **Dev/staging:** локальный MinIO в VM на сервере B (тот же S3 API, агностичный код).
- В БД — только ссылки и метаданные, не сами файлы.

## Retention (срок жизни записей)

Записи **не хранятся вечно** — у каждой есть `expires_at`. Срок задаётся тарифом пользователя; по истечении выполняется действие (delete / archive / export).

- На запись пишется `retention_days` (снимок тарифа на момент создания) и `expires_at = meeting.ended_at + retention_days`.
- Cron-job раз в час ищет истёкшие записи и выполняет действие.
- Возможные действия: `delete` (просто удалить), `notify_then_delete` (предупреждение → удаление), `archive` (холодное хранилище Yandex), `export_to_user_s3` (выгрузка в bucket клиента — enterprise).
- API: `download` (presigned URL), `extend` (продление если разрешено тарифом), `delete` (досрочное удаление по запросу).

**MVP без тарифов:** дефолт `retention_days = 30` в env (решение от 2026-05-06, по образцу Microsoft Teams). Cron-job работает с первого дня. Остальные опции (уведомления, экспорт, soft-delete) — V2.

Полный анализ: `plans/analysis/2026-05-06-recording-retention.md`.

## Управление

- Запустить запись может только **host**.
- При запуске Backend → LiveKit Egress → файлы в S3 → webhook возвращает URL → Backend пишет в `Recording`.
- При остановке: тот же путь в обратную сторону, статус `recording_processing` → `recording_ready`.

## Какой Egress использовать

LiveKit предлагает несколько типов Egress:
- **Composite Egress** — общая запись комнаты (видео + микс аудио + screen share). Транскодинг → нужный формат. **Используем для общей записи**.
- **Track Egress** — raw отдельных треков, **без транскодинга** (самый дешёвый по CPU). **Используем для отдельных аудиодорожек на участника** — формат WebM/OGG → S3.
- **Participant Egress** — пишет конкретного участника по `identity` целиком (handles mute сам). Альтернатива Track Egress, если нужен транскодинг и обработка mute «из коробки», но дороже по CPU.

→ MVP: 1× Composite (общая) + N× Track Egress (на каждого участника отдельная аудио-дорожка).

> ⚠ Свежие версии Egress (~Feb 2026) могут давать потрескивания на отдельных дорожках — см. [[../02_architecture/code-pitfalls]] п.1.

## Надёжность записи (v2, 2026-06-03)

ТЗ `plans/tz/2026-06-03-meeting-recording-reliability.md`. Поверх PR #17.

**Per-track дорожки — гибрид push+pull (Фаза 1, P0).** Реактивного `track_published`
недостаточно: треки терялись на гонке старта записи, reconnect-republish и потере
webhook (LiveKit не гарантирует доставку). Добавлены:
- **догон на старте записи** — `RecordingsService.reconcileTrackEgress` из `start()`:
  pull `livekit.listParticipants` → для `kind=STANDARD` + `TrackType.AUDIO` догоняем `ensureTrackEgress`;
- **периодическая сверка-cron** `recording-track-reconcile` (`*/1`, kill-switch
  `RECORDING_TRACK_RECONCILE_ENABLED`, дефолт ON) — проходит по `Recording.status ∈
  {requested,recording}`, добирает недостающее. Гарантия: пока участник в комнате
  с AUDIO-треком, дорожка появится не позже следующего тика;
- **идемпотентность**: in-process `Set`-lock `meetingId:identity` (прод — один
  процесс) + DB-дедуп `findFirst(recordingId,livekitIdentity)`;
- **метрика** `recording_track_egress_failed_total` — алерт «дорожки теряются».

**Участники — фильтр по `ParticipantKind` (Фаза 2, P1).** `Participant` создаётся
только для `kind=STANDARD`; egress-рекордеры (`kind=EGRESS`), AGENT/SIP/INGRESS — no-op.
Семантика от LiveKit надёжнее строкового префикса PR #17. Fallback на префикс
`host:`/`guest:`, когда `kind` отсутствует в payload (proto3 опускает дефолт STANDARD).

**Видео — faststart (Фаза 3, P1, флаг ON).** Egress пишет MP4 с moov-atom в конце
→ браузер тянет весь файл до первого кадра. `FaststartWorker` (`recording.faststart`)
делает `ffmpeg -c copy -movflags +faststart` и перезаливает по тому же ключу. Флаг
`RECORDING_FASTSTART_ENABLED` (дефолт ON, kill-switch) + порог
`RECORDING_FASTSTART_MIN_BYTES` (50 МиБ — мелкий composite не ремуксим). Операция
идемпотентна и безопасна (`-c copy`, перезалив после `exit 0`). У `EncodedFileOutput`
нативного faststart нет (Context7). Для длинных встреч (1–2 ч) штатный путь — HLS
`SegmentedFileOutput` (Фаза 4, P2). `ffmpeg` теперь в Docker-образе (попутно чинит clip.render).

См. [[workers-queues]] (cron + очередь), [[ai-jobs]] (faststart-воркер).

## Архитектурное правило

LiveKit Egress держим **отдельно** от LiveKit SFU. Запись съедает CPU; на одной ноде роняет качество звонков.

[[../index|← index]]
