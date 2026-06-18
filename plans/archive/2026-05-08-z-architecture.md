---
type: architecture
status: draft
feature: z-architecture-overview
date: 2026-05-08
---

# Архитектура Z (AI-видеовстречи на LiveKit) — целевое состояние MVP

> Документ описывает целевую архитектуру всего продукта Z к моменту окончания MVP. Источник правды для написания ТЗ. Все принципы взяты из `second-brain/02_architecture/*` и закрытых вопросов в `plans/analysis/*` — здесь они собраны в одно полотно с реальными интерфейсами модулей, контрактами API и FSM-переходами, чтобы программист мог стартовать без перечитывания десяти файлов.

## 1. Цели и принципы

### 1.1 Бизнес-цель MVP

Пользователь Crossmark (или авторизованный пользователь Z) создаёт встречу выбранного типа, проводит её на LiveKit с записью двух форматов (общая + per-track audio), и в течение нескольких минут после завершения получает AI-отчёт, **подобранный под тип встречи** (а не универсальное саммари).

### 1.2 Архитектурные принципы (фиксируются на весь проект)

1. **LiveKit — только медиа.** Никакой бизнес-логики в LiveKit Server. Все токены — на нашем backend.
2. **Гость не получает секреты LiveKit.** Только короткоживущий access-token, выданный нашим backend.
3. **Per-track audio обязателен.** Отдельная аудиодорожка на участника. Общий микс — для человека, дорожки — для AI.
4. **Egress — отдельный сервис от SFU.** На одной ноде запись валит звонки.
5. **Switchable endpoints для всех внешних интеграций.** S3 / TURN / LLM / ASR — через ENV. Никаких хардкодов провайдера.
6. **Все идентификаторы публичных URL — длинные неугадываемые** (ULID/UUIDv4). `meet.crossmark.ru/m/<id>` без дополнительной guard'ы.
7. **Идемпотентность webhooks обязательна.** Повторная доставка от LiveKit/Crossmark — норма, дедуп по `event.id` / `idempotency_key`.
8. **AI-обработка — через очередь, не inline.** BullMQ + Redis + цепочка из 4 этапов. Любой этап может рестартовать.
9. **Цепочки слоёв на frontend и backend** (см. §6 и §7). DTO не утекают в БД, БД-сущности не утекают в UI.
10. **Plain Russian everywhere user-facing.** Английские аббревиатуры — поясняются в скобках при первом упоминании.

### 1.3 Что в MVP НЕ входит

Чтобы не плодить сомнительные фичи:

- breakout rooms;
- зал ожидания с одобрением каждого гостя;
- календарная интеграция, рассылка приглашений из Z, email-нотификации;
- co-host (несколько ведущих);
- зрители без аудио/видео;
- редактирование AI-отчёта руками;
- повторный прогон AI с другим промптом из UI;
- мобильные нативные клиенты (только web на десктопе);
- публичная страница результата для гостя;
- сохранённые промпты пользователя.

## 2. Высокоуровневая схема компонентов

```
            ┌────────────────────────────┐
            │     Crossmark Backend       │
            └──────────────┬──────────────┘
                           │ HTTPS + HMAC
                           ▼
┌────────────────────────────────────────────────────────────┐
│                   Z Backend (NestJS)                        │
│  ┌──────────┐ ┌─────────┐ ┌────────────┐ ┌────────────┐    │
│  │ Auth     │ │Meetings │ │ Recording  │ │ AI Workers │    │
│  │ (JWT/    │ │  / FSM  │ │ Manager    │ │ (BullMQ)   │    │
│  │  HMAC)   │ │         │ │            │ │            │    │
│  └──────────┘ └─────────┘ └────────────┘ └────────────┘    │
│  ┌──────────┐ ┌─────────┐ ┌────────────┐ ┌────────────┐    │
│  │ LiveKit  │ │Webhooks │ │ Retention  │ │ Admin /    │    │
│  │ Service  │ │ Handler │ │  Cron      │ │ Metrics    │    │
│  └──────────┘ └─────────┘ └────────────┘ └────────────┘    │
└──────┬──────────────┬─────────────┬──────────────┬────────┘
       │              │             │              │
       ▼              ▼             ▼              ▼
┌───────────┐  ┌────────────┐  ┌────────┐  ┌────────────┐
│PostgreSQL │  │   Redis     │  │   S3    │  │  Vox+Claude │
│ (Prisma)  │  │ (BullMQ)    │  │(Selectel│  │  (proxy/    │
└───────────┘  └────────────┘  │ /MinIO) │  │   direct)   │
                               └────────┘  └────────────┘
       ▲              ▲             ▲
       │              │             │
       │ webhooks     │ media       │ recordings
       │              │             │
┌──────┴──────┐ ┌─────┴────┐ ┌──────┴─────┐
│ LiveKit SFU │◄┤ Browsers ├►│LiveKit Egress│
└─────────────┘ └──────────┘ └────────────┘

           Frontend (Next.js, отдельная подсеть)
        ┌─────────────────────────────────────┐
        │ /meetings  /m/:id  /meetings/:id/result│
        └─────────────────────────────────────┘
```

Связи:

- **Crossmark → Z:** только REST с HMAC-SHA256 + timestamp window 5 минут.
- **Z → Crossmark:** запрос-ответ; никаких push-уведомлений в первой версии.
- **Browser ↔ Frontend:** HTTPS + cookie session (`.crossmark.ru`).
- **Frontend ↔ Backend:** REST (cookie-based). Никаких GraphQL.
- **Browser ↔ LiveKit:** WSS (wss://media.crossmark.ru) + WebRTC media (UDP 50000-60000).
- **LiveKit → Backend:** webhooks (HTTPS, `Authorization: Bearer <jwt>` + sha256 в claims).
- **Backend → LiveKit:** Server SDK (REST).
- **Backend ↔ AI Workers:** через очередь BullMQ (Redis); workers — отдельные node-процессы в той же кодбазе.
- **Workers → S3/Vox/Claude:** прямой исходящий HTTPS.

## 3. Деплоймент-карта

Окончательная разбивка на VM (по `plans/tz/2026-05-06-infrastructure-deployment-tz.md`):

| VM | Где | Что |
|---|---|---|
| `vm-livekit` | A | LiveKit SFU + встроенный TURN |
| `vm-system-a` | A | nginx + certbot + node_exporter |
| `vm-egress` | B | LiveKit Egress |
| `vm-backend` | B | NestJS API + воркеры BullMQ (отдельные процессы) |
| `vm-postgres` | B | PostgreSQL 16 |
| `vm-redis` | B | Redis 7 (BullMQ + LiveKit redis state) |
| `vm-minio` | B | MinIO (dev/staging) |
| `vm-monitoring` | B | Prometheus + Grafana |
| `vm-system-b` | B | nginx + certbot + node_exporter |

Frontend (Next.js) деплоится либо на `vm-backend` (тот же node-runtime под другим портом + nginx upstream), либо на отдельную VM при росте — для MVP пусть будет на `vm-backend`.

Воркеры BullMQ: отдельный процесс `node dist/workers/main.js` на `vm-backend`. На MVP в одном PM2/systemd рядом с API. Когда упрёмся в CPU — выносим на отдельную VM `vm-workers`.

## 4. Доменные сущности и FSM

### 4.1 ER-диаграмма

```
User ──┐
       │ owner
       ▼
Meeting ──── Participant (N)
   │            │
   │            └── audio_track (1:1, опционально)
   │
   └── Recording (1:1)
   │       │
   │       ├── audio_track (N)
   │       └── recording_action (N)
   │
   └── AiResult (1:1)
   │
   └── Transcript (1:1, S3-pointer)
   │
   └── meeting_event (N) — лог всех webhook-событий

IntegrationKey (Crossmark API key) — independent
WebhookSeenEvent (dedup) — independent
AiUsageLog — independent (FK → meeting_id, nullable)
```

### 4.2 Точные модели Prisma (см. ТЗ Фаза 1.3 — там полная schema)

Основные ключевые поля каждой сущности:

- **User**: `id (cuid)`, `external_id (unique, nullable — для лок. админов)`, `email`, `name`, `created_at`, `last_seen_at`.
- **Meeting**: `id (ulid, public-facing)`, `title`, `type (enum 9)`, `custom_prompt (text?)`, `owner_id`, `room_name (unique = id)`, `status (enum FSM)`, `started_at?`, `ended_at?`, `failure_reason?`, `created_at`.
- **Participant**: `id`, `meeting_id`, `livekit_identity (unique per meeting)`, `name`, `role ('host'|'guest')`, `is_registered_user`, `joined_at?`, `left_at?`, `device_count` (для случая «один гость с двух устройств»).
- **Recording**: `id`, `meeting_id (unique)`, `main_video_url?`, `composite_egress_id?`, `status (FSM)`, `retention_days`, `expires_at`, `archived_at?`, `deleted_at?`, `bytes_total?`, `duration_seconds?`.
- **AudioTrack**: `id`, `recording_id`, `participant_id (nullable)`, `participant_name`, `livekit_identity`, `track_id`, `audio_url`, `started_at`, `ended_at`, `duration_seconds`, `bytes`.
- **Transcript**: `id`, `meeting_id (unique)`, `s3_url` (raw.json), `merged_s3_url` (склейка по времени), `total_words`, `total_duration_seconds`.
- **AiResult**: `id`, `meeting_id (unique)`, `meeting_type`, `summary`, `structured_data (jsonb?)`, `custom_output_md (text?)`, `follow_up_email (text?)`, `tasks (jsonb?)`, `model_used`, `created_at`.
- **AiUsageLog**: `id`, `meeting_id?`, `agent_type`, `job_id`, `model`, `provider`, `input_tokens`, `output_tokens`, `reasoning_tokens?`, `cost_usd`, `duration_ms`, `success`, `error_text?`, `created_at`.
- **IntegrationKey**: `id`, `partner_name`, `key_hash (sha256)`, `created_at`, `revoked_at?`.
- **WebhookSeenEvent**: `event_id (PK)`, `event_type`, `received_at`.
- **MeetingEvent**: `id`, `meeting_id`, `event_type`, `payload (jsonb)`, `received_at` — журнал.
- **RecordingAction**: `id`, `recording_id`, `action`, `actor`, `reason?`, `created_at`.

### 4.3 Meeting FSM

```
              ┌───────────────────────────────┐
              ▼                               │
scheduled ──► active ──► completed ──► recording_processing
                              │              │
                              │              ▼
                              │         recording_ready ──► transcription_processing
                              │                                  │
                              │                                  ▼
                              │                          transcription_ready ──► ai_processing
                              │                                                       │
                              ▼                                                       ▼
                          failed ◄── (ошибка любого этапа)                        ai_ready
```

Допустимые переходы (валидируются доменным сервисом, **никаких сырых апдейтов статуса**):

- `scheduled → active`: первый `room_started` от LiveKit.
- `active → completed`: `room_finished` или ручное «завершить» от хоста или idle-cron 15 минут.
- `completed → recording_processing`: запись существовала и `egress_started` пришёл.
- `recording_processing → recording_ready`: все egress-ы (composite + per-track) ENDED + файлы в S3.
- `recording_ready → transcription_processing`: BullMQ `transcribe` поставлен.
- `transcription_processing → transcription_ready`: все треки распознаны и склеены в `merged_s3_url`.
- `transcription_ready → ai_processing`: BullMQ `analyze` поставлен.
- `ai_processing → ai_ready`: AiResult записан и summary не null.
- `* → failed`: причина в `failure_reason`. Из `failed` есть `retryFromFailed()` — вернуть на последний успешный этап.

Если запись не велась (host не нажимал «начать запись»), `completed` не идёт в `recording_processing` — встреча просто закончена. AI-результат отсутствует.

### 4.4 Recording FSM

```
not_started ──► requested ──► recording ──► finalizing ──► ready ──► (expired ──► archived | deleted)
                                  │
                                  └── failed
```

- `requested`: backend дернул LiveKit Egress API (`startRoomCompositeEgress` + N×`startTrackEgress`), ждём подтверждения.
- `recording`: пришёл `egress_started` для всех ожидаемых egress-ID.
- `finalizing`: `egress_ended` пришёл, файлы заливаются.
- `ready`: все URL проставлены, метаданные сохранены.
- `failed`: хотя бы один `egress_failed` — отметить причину; не блокирует завершение встречи, но AI-пайплайн запускается только над тем, что доехало.

## 5. Внешние API (контракты на верхнем уровне)

Полные swagger-схемы — в ТЗ соответствующих фаз. Здесь — карта.

### 5.1 Crossmark → Z (HMAC)

| Метод | Путь | Зачем |
|---|---|---|
| POST | `/integrations/crossmark/v1/meetings` | создать встречу, получить deep-link |
| GET | `/integrations/crossmark/v1/meetings/:id` | получить статус и сводку |
| GET | `/integrations/crossmark/v1/meetings/:id/result` | AI-результат (для рендера в Crossmark) |
| GET | `/integrations/crossmark/v1/meetings/:id/recording-url` | presigned-URL общей записи |
| DELETE | `/integrations/crossmark/v1/meetings/:id` | отменить scheduled / удалить артефакты |
| POST | `/integrations/crossmark/v1/meetings/:id/extend-retention` | продлить срок хранения |

Все запросы:
- `Authorization: Bearer <api-key>`
- `X-Crossmark-Signature: <hmac-sha256(secret, body)>`
- `X-Crossmark-Timestamp: <unix-seconds>` (window ±300s)
- `X-Idempotency-Key: <uuid>` (рекомендуется на POST, обязательно на ПОВТОРИМЫХ операциях создания)

### 5.2 Browser → Z (cookie)

| Метод | Путь | Зачем |
|---|---|---|
| GET | `/m/:id?t=<jwt>` | страница встречи (фронт): обмен JWT → cookie + redirect |
| GET | `/api/v1/meetings/:id/access` | проверка прав текущего юзера для встречи (host/guest/none) |
| POST | `/api/v1/meetings/:id/join` | получить LiveKit token (для хоста — без guest_name; для гостя — `guest_name` обязателен) |
| POST | `/api/v1/meetings/:id/leave` | пометить уход (опционально — LiveKit и так пришлёт webhook) |
| POST | `/api/v1/meetings/:id/recording/start` | host-only: начать запись |
| POST | `/api/v1/meetings/:id/recording/stop` | host-only: остановить запись |
| POST | `/api/v1/meetings/:id/finish` | host-only: завершить встречу (room.deleteRoom) |
| POST | `/api/v1/meetings/:id/participants/:pid/mute` | host-only: выключить чужой микрофон |
| POST | `/api/v1/meetings/:id/participants/:pid/kick` | host-only: удалить участника |
| GET | `/api/v1/meetings` | мои встречи (host) |
| GET | `/api/v1/meetings/:id/result` | AI-результат |
| GET | `/api/v1/meetings/:id/result/status` | прогресс (для поллинга) |
| GET | `/api/v1/meetings/:id/recording/download` | presigned URL общей записи (host-only) |
| POST | `/api/v1/meetings/:id/retry-ai` | повтор пайплайна из failed |
| POST | `/auth/logout` | выход |

### 5.3 LiveKit → Z (webhooks)

`POST /webhooks/livekit` — единый endpoint. JWT-валидация + sha256 body match. Дедуп по `event.id`. Минимальный набор обрабатываемых событий: `room_started`, `room_finished`, `participant_joined`, `participant_left`, `track_published`, `track_unpublished`, `egress_started`, `egress_ended`, `egress_failed`.

### 5.4 Admin (cookie + role=admin, отдельный домен поддомен `admin.crossmark.ru` или префикс `/admin/*`)

| Метод | Путь | Зачем |
|---|---|---|
| GET | `/admin/api/v1/meetings` | поиск, фильтр по статусу/типу/owner |
| GET | `/admin/api/v1/meetings/:id` | подробности + журнал meeting_event |
| POST | `/admin/api/v1/meetings/:id/force-finish` | если зависла |
| POST | `/admin/api/v1/meetings/:id/retry-ai` | без cooldown |
| GET | `/admin/api/v1/integration-keys` | список ключей Crossmark |
| POST | `/admin/api/v1/integration-keys` | создать (показывается один раз) |
| DELETE | `/admin/api/v1/integration-keys/:id` | revoke |
| GET | `/admin/api/v1/ai-usage` | сводка по дням/моделям/cost |
| GET | `/admin/api/v1/recordings/expiring` | какие записи скоро удалятся |

## 6. Backend (NestJS) — структура слоёв

### 6.1 Каталог

```
backend/
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── workers/
│   │   ├── main.ts            (отдельный entrypoint для BullMQ-процесса)
│   │   └── ...
│   ├── common/
│   │   ├── filters/           (HttpException → JSON)
│   │   ├── guards/            (CookieAuthGuard, HmacGuard, AdminGuard)
│   │   ├── interceptors/      (LoggingInterceptor, IdempotencyInterceptor)
│   │   ├── pipes/             (ZodValidationPipe — мы используем zod, не class-validator)
│   │   ├── dto/               (общие FiltersDto, PaginationDto, ApiOkDto)
│   │   ├── prisma/            (PrismaService, prisma-tx helper)
│   │   ├── logger/            (pino, корреляция request-id)
│   │   ├── metrics/           (PrometheusModule, custom counters)
│   │   ├── errors/            (DomainError классов)
│   │   └── config/            (typed env loader)
│   ├── modules/
│   │   ├── auth/
│   │   ├── users/
│   │   ├── integrations-crossmark/
│   │   ├── meetings/
│   │   ├── participants/
│   │   ├── livekit/           (LiveKit SDK wrapper, токены, room control)
│   │   ├── recordings/
│   │   ├── transcripts/
│   │   ├── ai/
│   │   │   ├── ai.module.ts
│   │   │   ├── services/
│   │   │   │   ├── vox.service.ts
│   │   │   │   ├── anthropic.service.ts
│   │   │   │   ├── ai-orchestrator.service.ts
│   │   │   │   └── prompts/
│   │   │   │       ├── system-summary.ts
│   │   │   │       ├── type-team.ts
│   │   │   │       ├── type-standup.ts
│   │   │   │       ├── type-plan-fact.ts
│   │   │   │       ├── type-project.ts
│   │   │   │       ├── type-sales.ts
│   │   │   │       ├── type-custdev.ts
│   │   │   │       ├── type-partner.ts
│   │   │   │       ├── type-interview.ts
│   │   │   │       └── type-customer-success.ts
│   │   │   └── workers/
│   │   │       ├── transcribe.worker.ts
│   │   │       ├── merge.worker.ts
│   │   │       ├── analyze.worker.ts
│   │   │       └── notify.worker.ts
│   │   ├── webhooks/
│   │   ├── admin/
│   │   ├── retention/         (cron)
│   │   └── health/
│   └── shared/
│       └── domain/            (доменные модели, использующиеся между модулями)
└── test/
    ├── e2e/
    └── unit/
```

### 6.2 Слои внутри модуля (NestJS — обязательно для всех модулей кроме самых тонких)

```
controller (HTTP/DTO в/из) ──► service (бизнес-логика) ──► repository (Prisma) ──► DB
                              │
                              └► другие сервисы (livekit, ai, ...) через DI
```

DTO-цепочка: `ApiDto → DomainModel → PersistenceModel`. Это требование `nestjs-rules` skill — не упрощаем.

- `ApiDto` — что приходит/уходит по HTTP (zod-схема + класс с `as const`).
- `DomainModel` — внутренняя бизнес-сущность (встреча в активном состоянии, валидные FSM-переходы).
- `PersistenceModel` — то, что Prisma пишет/читает.

Нет утечки Prisma-типов в контроллер. Нет `Meeting.password` или подобных полей в DTO, идущем наружу.

### 6.3 Транзакции

Любая операция, меняющая ≥2 таблицы, — в `prisma.$transaction`. Особенно: создание встречи (Meeting + Participant хоста), завершение встречи (Meeting.status + Recording + журнал), приём webhook-цепочки (WebhookSeenEvent + изменения).

### 6.4 Идемпотентность

- На все записи Crossmark API учитываем `X-Idempotency-Key`. Таблица `crossmark_idempotency(key PK, response_hash, created_at)`. Если ключ виден — возвращаем сохранённый ответ.
- Webhook от LiveKit — дедуп по `event_id`.
- BullMQ-задачи — `jobId = meetingId:stage:attempt`, опция `removeOnComplete` true.

### 6.5 Ошибки

Доменные ошибки (`InvalidFsmTransitionError`, `MeetingNotFoundError`, `NotAuthorizedError`, `RecordingNotReadyError`, ...) маппятся в HTTP-коды через единственный `AllExceptionsFilter`. Не пробрасывать наружу `PrismaClientKnownRequestError` со stack-trace — наружу только code и человеческое сообщение на русском.

### 6.6 Логирование и observability

- `pino` + `nestjs-pino`, json-логи в stdout.
- На каждый request — `request-id` через middleware (header `X-Request-Id` или генерим).
- В контексте логов всегда `meeting_id`, `user_id`, `phase`.
- Метрики Prometheus — см. `second-brain/01_projects/capacity-and-infra.md`. Дополнительно фиксируем для бизнеса: `meetings_created_total{type=}`, `meetings_failed_total{stage=}`, `ai_pipeline_duration_seconds{stage=,type=}`, `recordings_bytes_total`, `crossmark_api_requests_total{endpoint=,status=}`.

### 6.7 ENV (typed config)

`src/common/config/env.schema.ts` — zod-схема всех ENV. Падаем на старте при отсутствии обязательных. Ниже — полный список (по группам).

```
# Runtime
NODE_ENV=production|development|test
PORT=3000
LOG_LEVEL=info|debug|warn|error

# Database
DATABASE_URL=postgresql://z_app:***@vm-postgres:5432/z_main

# Redis
REDIS_URL=redis://vm-redis:6379

# Frontend / cookies
COOKIE_DOMAIN=.crossmark.ru
PUBLIC_FRONTEND_URL=https://meet.crossmark.ru
JWT_SESSION_SECRET=...                    # 64+ chars
JWT_DEEP_LINK_SECRET=...                  # 64+ chars (отдельный от session)
SESSION_TTL_SECONDS=86400                 # 24h
DEEP_LINK_TTL_SECONDS=900                 # 15min

# LiveKit
LIVEKIT_API_URL=https://media.crossmark.ru
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
LIVEKIT_WEBHOOK_API_KEY=...               # тот же, что у LiveKit Server для webhook
LIVEKIT_WEBHOOK_API_SECRET=...

# TURN (через ENV — переключатель)
TURN_MODE=builtin|external
TURN_HOST=
TURN_PORT=
TURN_USERNAME=
TURN_PASSWORD=
TURN_TLS=true

# S3 (Selectel в prod, MinIO в dev)
S3_ENDPOINT_URL=https://s3.ru-7.storage.selcloud.ru
S3_REGION=ru-7
S3_BUCKET=meetings-prod
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
S3_PRESIGNED_TTL_SECONDS=3600

# AI providers
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-6
ANTHROPIC_USE_PROXY=false
ANTHROPIC_PROXY_URL=https://proxy.agent-lia.ru

VOX_API_URL=https://vox.agent-lia.ru
VOX_API_TOKEN=...
VOX_MODEL=v3_rnnt
VOX_LANGUAGE=ru
VOX_PUNCTUATION_MODE=pro

OPENAI_API_KEY=sk-proj-...                # fallback
MINIMAX_API_KEY=...                       # fallback

# Crossmark integration
CROSSMARK_HMAC_TIMESTAMP_WINDOW_SECONDS=300

# Retention
DEFAULT_RETENTION_DAYS=30
RETENTION_CRON=0 * * * *                  # каждый час

# Idle meeting cron
IDLE_MEETING_TIMEOUT_MINUTES=15
IDLE_MEETING_CRON=*/1 * * * *

# Quotas / safety
MAX_PARTICIPANTS_PER_MEETING=10
MAX_MEETING_DURATION_HOURS=8

# Admin
ADMIN_BOOTSTRAP_EMAIL=...                 # первый админ при пустой БД
ADMIN_SESSION_TTL_SECONDS=43200           # 12h
```

## 7. Frontend (Next.js) — структура и принципы

### 7.1 Каталог

```
frontend/
├── app/                          (App Router, Next.js 14+)
│   ├── (public)/
│   │   └── m/[id]/page.tsx       (страница встречи; проверка cookie/jwt; lobby/room)
│   ├── (authenticated)/
│   │   ├── meetings/page.tsx     (список встреч хоста)
│   │   ├── meetings/create/page.tsx
│   │   └── meetings/[id]/result/page.tsx
│   ├── (admin)/
│   │   └── admin/...
│   ├── api/                      (Next route handlers — для проксирования cookie на backend)
│   │   └── proxy/[...path]/route.ts
│   ├── layout.tsx
│   └── globals.css
├── src/
│   ├── api/                      (apiClient — единый, с cookie + retry + типы)
│   │   ├── api-client.ts
│   │   ├── meetings.api.ts
│   │   ├── auth.api.ts
│   │   └── result.api.ts
│   ├── domain/                   (DomainModel — нормализованные модели)
│   │   ├── meeting.ts
│   │   ├── participant.ts
│   │   ├── recording.ts
│   │   ├── ai-result.ts
│   │   └── enums.ts
│   ├── ui/                       (UiModel + презентационные компоненты)
│   │   ├── components/
│   │   │   ├── meeting-room/
│   │   │   │   ├── meeting-room.tsx
│   │   │   │   ├── controls-bar.tsx
│   │   │   │   ├── participants-panel.tsx
│   │   │   │   ├── chat-panel.tsx
│   │   │   │   ├── raise-hand-button.tsx
│   │   │   │   └── recording-indicator.tsx
│   │   │   ├── meeting-result/
│   │   │   │   ├── result-page.tsx
│   │   │   │   ├── progress-state.tsx
│   │   │   │   ├── summary-card.tsx
│   │   │   │   ├── report-by-type.tsx
│   │   │   │   ├── custom-report-md.tsx
│   │   │   │   ├── follow-up-card.tsx
│   │   │   │   ├── tasks-list.tsx
│   │   │   │   ├── transcript-viewer.tsx
│   │   │   │   └── video-player.tsx
│   │   │   ├── meetings-list/
│   │   │   ├── create-meeting-form/
│   │   │   ├── lobby/
│   │   │   └── shared/           (button, modal, badge, ...)
│   ├── hooks/
│   │   ├── use-livekit-room.ts
│   │   ├── use-meeting-access.ts
│   │   ├── use-result-polling.ts
│   │   ├── use-raise-hand.ts
│   │   └── use-host-controls.ts
│   ├── contexts/
│   │   ├── auth-context.tsx
│   │   ├── meeting-context.tsx
│   │   └── toast-context.tsx
│   ├── lib/
│   │   ├── livekit-config.ts
│   │   ├── format.ts
│   │   ├── feature-flags.ts
│   │   └── error.ts
│   └── styles/
└── package.json
```

### 7.2 Слои данных (frontend-rules)

`ApiDto → DomainModel → UiModel`:

- `ApiDto`: то, что в JSON. Никогда не прокидывается в компоненты напрямую.
- `DomainModel`: нормализованная сущность (`MeetingDomain`), ts-Date вместо строк, enum из `enums.ts`.
- `UiModel`: то, что использует компонент (`MeetingListItemUi`), готовое к рендеру (форматированные даты, локализованные строки).

Маппинг: `apiToDomain.meeting.ts`, `domainToUi.meeting.ts` — отдельные тонкие функции, тестируются.

### 7.3 API-клиент

Один файл `api-client.ts` — обёртка над `fetch`:
- автоматически шлёт cookie (`credentials: 'include'`),
- 401 → `window.location = '/m/<id>'` (для public-страниц) или `/auth/expired` (для list/result),
- 403 → toast «нет прав»,
- 5xx → автоматический retry (2 попытки, exponential backoff) для GET,
- логирование ошибок в Sentry-подобный sink (на MVP — console + Prometheus counter через beacon).

### 7.4 Состояния UI (обязательно для всех data-fetching компонентов)

Каждый компонент с загрузкой данных рендерит четыре состояния:
1. **Loading** — скелетон, не «крутилка по центру».
2. **Empty** — иллюстрация + CTA «Создать встречу» (или контекстное действие).
3. **Error** — текст ошибки на русском + кнопка «Повторить».
4. **Success** — данные.

`use-result-polling` и подобные хуки возвращают дискриминированный union: `{state:'loading'} | {state:'error',message} | {state:'progress',percent,stage} | {state:'ready',data}`.

### 7.5 Авторизация и роли (frontend)

- `AuthProvider` инициализируется на server-side через cookie.
- Роль (`host | guest | none | admin`) известна из `/api/v1/meetings/:id/access` — не из JWT-полей напрямую.
- Маршруты `(authenticated)` гонят на `/m/:id` или показывают «Нет доступа».
- Маршруты `(admin)` доступны только при `role === 'admin'`. Сервер дублирует проверку.

## 8. AI Pipeline — детально

### 8.1 Поток

```
[trigger] meeting → completed
          (watcher на изменение FSM)
                ▼
   create AI job: { meetingId, attempt: 1 }
                ▼
[stage 1] transcribe.worker
   — для каждого AudioTrack:
       1. presign GET S3 → передаём как multipart в Vox submit
       2. poll Vox по taskId с интервалом 2с, до 60 попыток
       3. результат (json с word-timestamps) пишем в S3:
          meeting_<id>/transcripts/track_<participant>.json
   — записываем `transcript.s3_url` (объект-индекс с ссылками на per-track jsons)
   — переход FSM: transcription_processing
                ▼
[stage 2] merge.worker
   — читаем все per-track jsons
   — склеиваем по absolute time (`started_at + offset`) в единый `[ {speaker, text, start, end} ... ]`
   — пишем в S3: meeting_<id>/transcripts/merged.json
   — `transcript.merged_s3_url` обновляется
   — переход FSM: transcription_ready
                ▼
[stage 3] analyze.worker
   — читаем merged.json
   — формируем prompt:
        system = base + (custom_prompt || promptByType[meeting.type])
        user   = форматированный диалог
   — Anthropic Claude Sonnet streaming (с retry-fallback на non-stream)
   — parse: structured_data (если type-route) либо custom_output_md
   — отдельный вызов: summary (всегда) — короткий промпт, prompt caching
   — отдельный вызов для применимых типов: tasks (jsonb), follow_up_email
   — пишем AiResult, AiUsageLog
   — переход FSM: ai_processing → ai_ready
                ▼
[stage 4] notify.worker
   — отметка ai_ready_notified_at
   — на MVP: только триггер на frontend через polling (websocket — V2)
```

### 8.2 Параметры BullMQ

- Очередь `ai`. Воркеры: `transcribe`, `merge`, `analyze`, `notify` (стадии — отдельные имена очередей или name внутри одной — лучше отдельные, чтобы не блокировать analyze пока merge висит).
- `attempts: 5`, `backoff: exponential, delay: 8000ms`.
- На fail после 5 попыток — переводим Meeting → `failed`, fail_reason = `${stage}: ${message}`.
- Concurrency на ноду: `transcribe` — 4, `merge` — 8, `analyze` — 2 (ограничены rate limit Anthropic).

### 8.3 Промпты

- В коде, TS-модуль `src/modules/ai/services/prompts/`.
- Каждый файл экспортирует `(input: PromptInput) => { system: string; user: string; cacheKey?: string; }`.
- `system` — стабильная часть (роль AI, формат вывода) — кэшируется через `cache_control` Anthropic.
- `user` — переменная (диалог, тип, дата).

### 8.4 Структурированный вывод

Для каждого типа — JSON-schema через Anthropic tool use. Если модель возвращает невалидный JSON — пытаемся 2 раза с подсказкой «Ответ должен быть валидным JSON по схеме», третья попытка → `failed`.

### 8.5 Стоимость и квоты

- На каждую AI-job — лог в `AiUsageLog`.
- Алерт «суточная стоимость > $X» через метрику `ai_cost_usd_total` + Prometheus alert rule.

## 9. Гость, хост, идентификация

### 9.1 Хост

- Существует как `User` (создан Crossmark при первом вызове API).
- Cookie session JWT — `{ user_id, email, role: 'host', exp }`. TTL 24 часа.
- Cookie домен — `.crossmark.ru` (`secure; httpOnly; sameSite=lax`).
- При истечении cookie — redirect на «Войдите через Crossmark» (заглушка в MVP, V2 — собственный логин).

### 9.2 Гость

- Не существует как `User`, существует только как `Participant` (создаётся при `POST /api/v1/meetings/:id/join` с `guest_name`).
- Cookie `guest_session_<meetingId>` — короткоживущая (до конца встречи + 1 час), хранит `participant_id` и `livekit_identity`.
- Имя гостя сохраняется в `Participant.name`.
- При повторном входе по той же ссылке — переиспользуем `participant_id` (если cookie ещё валиден).

### 9.3 Конфликты ролей

Если пользователь с `host` cookie открывает чужую встречу (где он не owner) — при `/access` отдаётся `role: 'guest'`. Хостом не становится.

## 10. Рейзхенд и in-meeting state

- Транспорт: `participant.attributes` LiveKit (`hand_raised`, `hand_raised_at`).
- Frontend через `useLocalParticipant().setAttributes(...)`.
- Слушаем `RoomEvent.ParticipantAttributesChanged`.
- В БД не пишем (MVP).
- Хост может опустить чужую руку: вызов `RoomServiceClient.updateParticipant(roomName, identity, { attributes: { hand_raised: 'false' } })`.

## 11. Безопасность

### 11.1 Поверхности атаки и защита

| Поверхность | Угроза | Защита |
|---|---|---|
| Crossmark API | подмена тела, replay | HMAC-SHA256 + timestamp window 5 min + Idempotency-Key |
| Deep-link JWT | кража из истории | TTL 15 мин + одноразовый обмен на cookie + redirect без `?t=` |
| Session cookie | XSS кража | httpOnly + secure + sameSite=lax + CSP заголовки |
| LiveKit token | использование за пределами встречи | TTL = `meeting.ended_at + 5 min`; ограниченный capability set для гостя |
| Webhook от LiveKit | подделка | JWT-валидация + sha256 body match + дедуп по event_id |
| S3 download | прямая ссылка попала в чужие руки | presigned-URL TTL 1 час |
| Custom prompt | prompt injection | sanitize не нужно (это собственный пользователь даёт), но **никогда** не передавать в transient контекст системные секреты |
| Гостевой ввод имени | XSS | strip html, max 80 chars |
| Admin endpoints | unauthorized | role + IP allowlist (на MVP — basic-auth поверх) |

### 11.2 CORS

- Backend API принимает только `https://meet.crossmark.ru` и `https://*.crossmark.ru`. На preflight жёсткий matcher.
- Crossmark integration — отдельный controller, без CORS (server-to-server).

### 11.3 Хранение секретов

- Никаких секретов в git. `.env` не коммитим.
- Prod: ENV прокидываются systemd unit'ом / Docker secrets.
- Dev: `.env.local` (gitignored) + `.env.example` с пустыми значениями.

### 11.4 Аудит

- Любое admin-действие пишется в `admin_audit_log(actor_id, action, target_type, target_id, payload, created_at)`.
- DELETE / kick / force-finish / API key revoke — обязательно.

## 12. Тестирование

### 12.1 Слои

- **Unit**: domain logic (FSM, промпт-формирование, mapping ApiDto↔Domain). Vitest, без БД.
- **Integration**: модули + Prisma + Redis в Docker (`testcontainers`). Каждый PR.
- **E2E backend**: запуск всего стека docker-compose + тестовый LiveKit + happy path «создать → завершить → AI ready». Раз в день в CI.
- **E2E frontend**: Playwright — три сценария: host happy path, guest happy path, retry from failed.

### 12.2 Контрактные тесты Crossmark

Отдельный набор: pact или вручную — фиксируем формат запроса/ответа, любое его изменение требует версионирования (`/integrations/crossmark/v2/...`).

### 12.3 Quality gate перед мержем

- `bun run typecheck` — 0 ошибок.
- `bun run test:unit` + `bun run test:integration`.
- `bun run lint`.
- Никаких `--no-verify`.

## 13. CI/CD

### 13.1 Окружения

- `dev` — на `vm-backend` (тот же VM-набор, отдельные БД и bucket `meetings-dev`, MinIO).
- `staging` — позже, по образцу prod, но в карликовом размере.
- `prod` — серверы A и B.

### 13.2 Pipeline

- `bun install` (lockfile committed).
- Lint + typecheck + unit.
- Docker build (отдельные образы `z-backend`, `z-workers`, `z-frontend`).
- Push в private registry.
- На сервере: `docker compose pull && docker compose up -d`.
- Миграции БД: `prisma db push` (правило проекта — никаких `prisma migrate`, см. `prisma-db-push-rules` skill).
- Smoke test после деплоя: `GET /health`, создать тест-встречу через Crossmark API, прожить 30 сек, удалить.

## 14. Сводка решений и явных trade-offs

| Решение | Что выбрано | Почему | Что отклонено |
|---|---|---|---|
| Frontend framework | Next.js (App Router) | SSR для public-страниц, удобный роутинг, привычный стек | Vite-SPA — хуже для SEO public-страницы и cookie-авторизации |
| API стиль | REST + JSON | простота, swagger, понятность Crossmark-партнёрам | GraphQL — overkill для одного партнёра; tRPC — связывает FE+BE, нам нужна независимая интеграция Crossmark |
| Валидация DTO | zod | один источник правды для типов и валидации, идёт во frontend | class-validator — больше декораторов, дублирует типы |
| ORM | Prisma | уже зафиксировано в проекте | Drizzle / TypeORM — менять стек ради вкуса |
| Очередь | BullMQ | в стеке, простая, типобезопасная | Temporal — overkill для 4 этапов |
| WebSocket для прогресса AI | нет (поллинг 5 c) | проще, MVP | SSE/WS — V2 |
| Чат | LiveKit DataChannel | встроено в `LiveKitRoom` | свой WebSocket — лишний канал |
| Storage backups | Selectel + S3 versioning OFF | дёшево; recovery через retention | versioning ON — дороже, V2 |
| Тип idle-cron | per-minute scan | проще; до 1k встреч в час нагрузка незаметна | per-meeting scheduled job в BullMQ — больше движущихся частей |
| Custom prompt | full override (system) | максимум гибкости | merge с типом — путает |

## 15. Открытые вопросы (решены автономно для целей ТЗ)

- **Тарифы и лимиты в MVP** — нет тарификации в коде, есть `retention_days` (env-default 30) и `max_participants_per_meeting` (env 10). Тариф добавится в V2 как отдельная таблица.
- **Что Crossmark рисует у себя** — в Z API есть и `meeting/:id` (статус), и `meeting/:id/result` (полные данные), и `recording-url`. Crossmark может использовать любой набор — эта свобода берётся бесплатно.
- **Биллинг по AI** — Z считает сам, складывает в `AiUsageLog`. Crossmark позже может опрашивать `/integrations/crossmark/v1/usage?from=&to=`.
- **Email-нотификации хосту «AI готов»** — не входит в MVP. Если станет нужно — отдельный канал (Resend/SES) в V2.
- **Multi-language UI** — только русский в MVP. Тексты через i18n-словарь (`ui/i18n/ru.ts`), готово к будущему добавлению `en.ts`.

---

Этот документ — фундамент. Дальше — `plans/tz/2026-05-08-mvp-fullstack-tz.md`, где каждый кусок разрезан на фазы и под-фазы с критериями готовности.
