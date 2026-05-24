---
type: tz
status: done
feature: mvp-fullstack
date: 2026-05-08
supersededBy: plans/tz/2026-05-22-final-roadmap.md
---

# ТЗ: MVP Z (frontend + backend) — фазы и подфазы

> Архитектура: `plans/architecture/2026-05-08-z-architecture.md`
> Анализы: `plans/analysis/2026-05-05-mvp-meeting-flow.md`, `plans/analysis/2026-05-05-ai-pipeline-providers.md`, `plans/analysis/2026-05-06-recording-retention.md`, `plans/analysis/2026-05-06-raise-hand.md`, `plans/analysis/2026-05-05-livekit-self-hosted-deployment.md`

## Цель

Реализовать end-to-end MVP Z: от создания встречи через API Crossmark до получения AI-отчёта на странице `/meetings/:id/result`, с записью двух форматов в S3, поддержкой 9 типов встреч и кастомного промпта, гостями без регистрации, raise-hand, retention-cron и наблюдаемостью.

## Scope

**Входит:** всё из архитектурного документа §1.1 «Бизнес-цель MVP» + всё из §3 «Деплоймент-карта».
**Не входит:** §1.3 «Что в MVP НЕ входит».

## Принцип чтения этого ТЗ

- Фазы идут строго последовательно по зависимостям. Параллелить можно внутри фазы (помечено).
- Каждая фаза имеет:
  - **Цель фазы** — что должно работать после.
  - **Подфазы** — куски работы, каждый закрывается самостоятельно.
  - **DoD фазы** — общий чеклист.
- Внутри подфазы — точные файлы, эндпоинты, схемы, и DoD.
- При сомнениях — `core-engineering-standards`, `nestjs-rules`, `frontend-rules`, `prisma-db-push-rules`, `safe-seed-rules`, `z-ai-agent-rules`, `domain-business-context`.

---

# Фаза 0 — Инфраструктура (отдельное ТЗ)

> Эта фаза покрывается уже существующим документом `plans/tz/2026-05-06-infrastructure-deployment-tz.md`. Выполнить его до начала Фазы 1. Здесь — только отметка зависимости и какие артефакты должны быть готовы.

## DoD Фазы 0 (артефакты для последующих фаз)

- [ ] DNS: 6 поддоменов crossmark.ru резолвятся.
- [ ] TLS: certbot настроен и автообновляется.
- [ ] LiveKit Server: `wss://media.crossmark.ru` принимает подключения, есть API-ключ для backend.
- [ ] LiveKit Egress: смонтирован, S3-credentials прокинуты.
- [ ] PostgreSQL 16: пустая БД `z_main`, пользователь `z_app`.
- [ ] Redis 7: запущен, доступен с `vm-backend`.
- [ ] S3: bucket `meetings-prod` (Selectel) + `meetings-dev` (MinIO).
- [ ] Backend-VM: установлен Bun + Node 20 + nginx upstream на порт 3000.
- [ ] Webhook endpoint `/webhooks/livekit` принимает запросы (заглушка).
- [ ] Prometheus + Grafana: дашборды Capacity и Health.

---

# Фаза 1 — Backend каркас, Auth, Prisma-схема

**Цель фазы:** запущенный NestJS-сервис с типизированным конфигом, Prisma-схемой всех сущностей, единым AuthGuard для трёх потоков (cookie, HMAC, admin), идемпотентностью, обработкой ошибок и метриками. На выходе — `GET /health` 200, `POST /webhooks/livekit` принимает реальные события (с дедупом), Prisma-схема накатана.

## 1.1 Bootstrap проекта и зависимости

### Файлы
- `backend/package.json`
- `backend/tsconfig.json`
- `backend/bun.lockb` (committed)
- `backend/.gitignore`
- `backend/.env.example`
- `backend/Dockerfile`
- `backend/docker-compose.yml` (для локальной разработки: postgres+redis+minio)

### Что делаем
1. `bun init` в `backend/`. Сразу зафиксировать engines: `node>=20`.
2. Установить зависимости (минимальный список):
   ```
   @nestjs/core @nestjs/common @nestjs/platform-express @nestjs/config @nestjs/schedule
   @nestjs/swagger @nestjs/throttler nestjs-pino pino pino-pretty
   prisma @prisma/client zod nestjs-zod
   ioredis bullmq
   livekit-server-sdk
   @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
   @anthropic-ai/sdk
   nanoid ulid
   cookie-parser
   @willsoto/nestjs-prometheus prom-client
   class-transformer  (только для @Type над zod там, где нужно)
   ```
   dev: `@nestjs/cli @nestjs/testing vitest @types/node typescript prettier eslint`
3. `tsconfig.json`: `strict: true`, `noUncheckedIndexedAccess: true`, `paths` для `@/*`.
4. ESLint + Prettier: стандартный nest-config + ban на `any`.
5. `Dockerfile` (multi-stage: builder + runner на bun-image).
6. Скрипты в `package.json`:
   - `dev`, `build`, `start`, `test:unit`, `test:integration`, `test:e2e`,
   - `prisma:push`, `prisma:studio`, `prisma:seed`,
   - `worker:dev`, `worker:start`.

### DoD
- [ ] `bun install` без ошибок.
- [ ] `bun run dev` поднимает Nest и логирует «Application is running on: http://localhost:3000».
- [ ] `bun run typecheck` — 0 ошибок.

## 1.2 Типизированный конфиг (env-loader)

### Файлы
- `backend/src/common/config/env.schema.ts`
- `backend/src/common/config/config.module.ts`
- `backend/src/common/config/typed-config.service.ts`

### Что делаем
1. `env.schema.ts` — zod-схема всех ENV из архитектурного документа §6.7. Группы оформлены отдельными подсхемами и склеены `.merge()`.
2. `ConfigModule.forRoot({ isGlobal: true, validate: (raw) => envSchema.parse(raw) })` — падать на старте с понятным сообщением.
3. `TypedConfigService` оборачивает `ConfigService` и даёт типизированные геттеры: `cfg.s3.bucket`, `cfg.livekit.apiKey`.

### DoD
- [ ] При запуске без обязательной ENV — приложение умирает с perror, в котором перечислены недостающие ключи.
- [ ] Все обращения к ENV в коде идут через `TypedConfigService` (lint-rule запрещает `process.env.` вне `env.schema.ts`).

## 1.3 Prisma-схема и миграция

### Файлы
- `backend/prisma/schema.prisma`
- `backend/prisma/seed.ts`
- `backend/src/common/prisma/prisma.module.ts`
- `backend/src/common/prisma/prisma.service.ts`

### Что делаем
1. Полная `schema.prisma` (все таблицы из архитектурного документа §4.1):
   ```prisma
   generator client { provider = "prisma-client-js" }
   datasource db { provider = "postgresql", url = env("DATABASE_URL") }

   enum UserRole { user admin }
   enum MeetingType { team standup plan_fact project sales custdev partner interview customer_success }
   enum MeetingStatus { scheduled active completed recording_processing recording_ready transcription_processing transcription_ready ai_processing ai_ready failed }
   enum ParticipantRole { host guest }
   enum RecordingStatus { not_started requested recording finalizing ready failed expired archived deleted }

   model User {
     id            String   @id @default(cuid())
     externalId    String?  @unique
     email         String
     name          String
     role          UserRole @default(user)
     createdAt     DateTime @default(now())
     lastSeenAt    DateTime?
     meetings      Meeting[]
     @@index([email])
   }

   model Meeting {
     id            String   @id           // ULID, генерится сервисом
     title         String
     type          MeetingType
     customPrompt  String?  @db.Text
     ownerId       String
     owner         User     @relation(fields: [ownerId], references: [id])
     roomName      String   @unique       // равен id
     status        MeetingStatus @default(scheduled)
     startedAt     DateTime?
     endedAt       DateTime?
     failureReason String?
     createdAt     DateTime @default(now())

     participants  Participant[]
     recording     Recording?
     transcript    Transcript?
     aiResult      AiResult?
     events        MeetingEvent[]

     @@index([ownerId, createdAt])
     @@index([status, endedAt])
   }

   model Participant {
     id                String   @id @default(cuid())
     meetingId         String
     meeting           Meeting  @relation(fields: [meetingId], references: [id], onDelete: Cascade)
     livekitIdentity   String
     name              String
     role              ParticipantRole
     isRegisteredUser  Boolean  @default(false)
     userId            String?              // если хост или зарегистрированный
     deviceCount       Int      @default(1)
     joinedAt          DateTime?
     leftAt            DateTime?

     audioTrack        AudioTrack?
     @@unique([meetingId, livekitIdentity])
     @@index([meetingId])
   }

   model Recording {
     id                  String   @id @default(cuid())
     meetingId           String   @unique
     meeting             Meeting  @relation(fields: [meetingId], references: [id], onDelete: Cascade)
     mainVideoUrl        String?
     compositeEgressId   String?
     status              RecordingStatus @default(not_started)
     retentionDays       Int
     expiresAt           DateTime
     archivedAt          DateTime?
     deletedAt           DateTime?
     bytesTotal          BigInt?
     durationSeconds     Int?
     audioTracks         AudioTrack[]
     actions             RecordingAction[]
     @@index([expiresAt, status])
   }

   model AudioTrack {
     id                String   @id @default(cuid())
     recordingId       String
     recording         Recording @relation(fields: [recordingId], references: [id], onDelete: Cascade)
     participantId     String?  @unique
     participant       Participant? @relation(fields: [participantId], references: [id])
     participantName   String
     livekitIdentity   String
     trackId           String
     trackEgressId     String?
     audioUrl          String
     startedAt         DateTime
     endedAt           DateTime
     durationSeconds   Int
     bytes             BigInt?
     @@index([recordingId])
   }

   model Transcript {
     id                  String   @id @default(cuid())
     meetingId           String   @unique
     meeting             Meeting  @relation(fields: [meetingId], references: [id], onDelete: Cascade)
     rawIndexS3Url       String                       // объект-индекс per-track jsons
     mergedS3Url         String?
     totalWords          Int?
     totalDurationSeconds Int?
     createdAt           DateTime @default(now())
   }

   model AiResult {
     id                String   @id @default(cuid())
     meetingId         String   @unique
     meeting           Meeting  @relation(fields: [meetingId], references: [id], onDelete: Cascade)
     meetingType       MeetingType
     summary           String   @db.Text
     structuredData    Json?
     customOutputMd    String?  @db.Text
     followUpEmail     String?  @db.Text
     tasks             Json?
     modelUsed         String
     createdAt         DateTime @default(now())
   }

   model AiUsageLog {
     id              String   @id @default(cuid())
     meetingId       String?
     agentType       String                 // "transcribe" | "summary" | "report-by-type" | "follow-up" | "tasks"
     jobId           String?
     model           String
     provider        String                 // "anthropic" | "vox" | "openai"
     inputTokens     Int      @default(0)
     outputTokens    Int      @default(0)
     reasoningTokens Int?
     costUsd         Decimal  @db.Decimal(10, 6)
     durationMs      Int
     success         Boolean
     errorText       String?  @db.Text
     createdAt       DateTime @default(now())
     @@index([meetingId])
     @@index([createdAt])
   }

   model IntegrationKey {
     id            String   @id @default(cuid())
     partnerName   String
     keyHash       String   @unique
     createdAt     DateTime @default(now())
     revokedAt     DateTime?
     @@index([revokedAt])
   }

   model WebhookSeenEvent {
     eventId    String   @id
     eventType  String
     receivedAt DateTime @default(now())
   }

   model CrossmarkIdempotency {
     key          String   @id
     responseHash String
     responseBody Json
     httpStatus   Int
     createdAt    DateTime @default(now())
     @@index([createdAt])
   }

   model MeetingEvent {
     id          String   @id @default(cuid())
     meetingId   String
     meeting     Meeting  @relation(fields: [meetingId], references: [id], onDelete: Cascade)
     eventType   String
     payload     Json
     receivedAt  DateTime @default(now())
     @@index([meetingId, receivedAt])
   }

   model RecordingAction {
     id          String   @id @default(cuid())
     recordingId String
     recording   Recording @relation(fields: [recordingId], references: [id], onDelete: Cascade)
     action      String                       // 'created' | 'extended' | 'archived' | 'deleted' | 'exported'
     actor       String                       // 'user:<id>' | 'cron' | 'admin:<id>'
     reason      String?
     createdAt   DateTime @default(now())
     @@index([recordingId])
   }

   model AdminAuditLog {
     id          String   @id @default(cuid())
     actorId     String
     action      String
     targetType  String
     targetId    String
     payload     Json?
     createdAt   DateTime @default(now())
     @@index([actorId, createdAt])
   }
   ```
2. `PrismaService` — `OnModuleInit/OnModuleDestroy`, обёртка над `PrismaClient`. Включить middleware: логировать длительные запросы (>500 ms).
3. `seed.ts` — создать одного админа из `ADMIN_BOOTSTRAP_EMAIL` (если БД пуста). Никаких массовых сидов — см. `safe-seed-rules`.
4. **Применение схемы:** `bunx prisma db push` (правило проекта — никаких `prisma migrate`).

### DoD
- [ ] `bunx prisma db push` создаёт все таблицы.
- [ ] `bun run prisma:seed` создаёт первого админа.
- [ ] `prisma studio` показывает все таблицы.

## 1.4 Логирование, request-id, фильтр ошибок, метрики

### Файлы
- `backend/src/common/logger/logger.module.ts`
- `backend/src/common/middleware/request-id.middleware.ts`
- `backend/src/common/filters/all-exceptions.filter.ts`
- `backend/src/common/errors/domain-errors.ts`
- `backend/src/common/metrics/metrics.module.ts`
- `backend/src/common/metrics/business-metrics.service.ts`

### Что делаем
1. **Logger:** `nestjs-pino` с конфигом из ENV. В prod — json, в dev — pretty.
2. **RequestId middleware:** читать `X-Request-Id`, иначе генерить (`nanoid`). Класть в `req.id` и в логи через `pinoHttp.customProps`.
3. **Domain errors** (все наследуют `DomainError`):
   - `MeetingNotFoundError`, `NotAuthorizedError`, `InvalidFsmTransitionError(from, to)`,
   - `RecordingNotReadyError`, `IntegrationKeyInvalidError`, `IdempotencyConflictError`,
   - `QuotaExceededError(resource)`.
4. **AllExceptionsFilter:** мапит `DomainError → 4xx`, `Prisma.*KnownRequestError → 4xx по коду`, всё остальное → 500. В ответ — `{ ok: false, error: { code, message, requestId } }` без stack.
5. **Метрики:**
   - `@willsoto/nestjs-prometheus` ставит `/metrics` с default-collectors.
   - Кастомные:
     ```
     meetings_created_total{type=}
     meetings_finished_total{type=}
     meetings_failed_total{stage=}
     ai_pipeline_duration_seconds{stage=,type=,model=}
     ai_cost_usd_total
     recordings_bytes_total
     crossmark_api_requests_total{endpoint=,status=}
     livekit_webhook_events_total{type=}
     ```

### DoD
- [ ] Любой HTTP-ответ содержит `X-Request-Id`.
- [ ] `GET /metrics` возвращает дефолтные + кастомные метрики.
- [ ] Бросок `MeetingNotFoundError` в контроллере → 404 с json `{ ok:false, error:{code:'meeting_not_found', message:'Встреча не найдена', requestId } }`.

## 1.5 Health & Readiness

### Файлы
- `backend/src/modules/health/health.module.ts`
- `backend/src/modules/health/health.controller.ts`

### Что делаем
- `GET /health` → `{ status:'ok', version }`.
- `GET /health/ready` → проверка коннекта к Postgres (`SELECT 1`), Redis (`PING`), доступности LiveKit (`POST /twirp/livekit.RoomService/ListRooms`).
- Liveness (для k8s в будущем) — простой endpoint без зависимостей.

### DoD
- [ ] `GET /health/ready` отвечает 503 при остановленной БД.
- [ ] При здоровом стеке — 200.

## 1.6 Auth: три потока (cookie, HMAC, admin)

### Файлы
- `backend/src/modules/auth/auth.module.ts`
- `backend/src/modules/auth/services/jwt.service.ts`
- `backend/src/modules/auth/services/hmac.service.ts`
- `backend/src/modules/auth/guards/cookie-auth.guard.ts`
- `backend/src/modules/auth/guards/hmac.guard.ts`
- `backend/src/modules/auth/guards/admin.guard.ts`
- `backend/src/modules/auth/decorators/current-user.decorator.ts`
- `backend/src/modules/auth/decorators/current-partner.decorator.ts`

### Что делаем
1. **JwtService:**
   - подписывает session JWT: `{ sub:userId, email, role, exp }`, секрет `JWT_SESSION_SECRET`, TTL `SESSION_TTL_SECONDS`.
   - подписывает deep-link JWT: `{ sub:userId, meetingId, exp }`, секрет `JWT_DEEP_LINK_SECRET`, TTL `DEEP_LINK_TTL_SECONDS`.
2. **HmacService:** `verify(body, signature, timestamp, key)` — bcrypt-style timing-safe сравнение, проверка окна `CROSSMARK_HMAC_TIMESTAMP_WINDOW_SECONDS`.
3. **CookieAuthGuard:**
   - Читает cookie `z_session` (jwt). Валидирует. Вешает `req.user = { id, email, role }`.
   - Если нет cookie или невалид — 401.
   - Опциональный режим (`@OptionalAuth()` декоратор) — пропускает дальше с `req.user = null`.
4. **HmacGuard:**
   - Читает headers `Authorization`, `X-Crossmark-Signature`, `X-Crossmark-Timestamp`, `X-Idempotency-Key`.
   - Достаёт ключ по `Bearer ...` → ищет `IntegrationKey.keyHash = sha256(token)` (не revoked).
   - Сверяет HMAC + timestamp.
   - При успехе — `req.partner = { id, partnerName }`.
   - При conflict idempotency-key (уже есть с тем же hash) — отдаёт сохранённый ответ без вызова контроллера.
5. **AdminGuard:** требует `req.user.role === 'admin'`. Проверка дублируется на уровне роута.

### DoD
- [ ] Юнит-тесты HmacService: правильная подпись принимается, неправильная — отклоняется, старый timestamp — отклоняется.
- [ ] Запрос `POST /integrations/crossmark/v1/meetings` без подписи → 401.
- [ ] Запрос `GET /api/v1/meetings` без cookie → 401.
- [ ] Один и тот же `X-Idempotency-Key` с теми же params → один и тот же ответ; с разными params → 409 `idempotency_conflict`.

## 1.7 Webhook handler с дедупом и проверкой подписи

### Файлы
- `backend/src/modules/webhooks/webhooks.module.ts`
- `backend/src/modules/webhooks/livekit-webhooks.controller.ts`
- `backend/src/modules/webhooks/livekit-webhooks.service.ts`
- `backend/src/modules/webhooks/livekit-signature.verifier.ts`

### Что делаем
1. **Verifier:** парсит JWT из `Authorization`, валидирует подпись `LIVEKIT_WEBHOOK_API_SECRET`, сверяет sha256 body с claim `sha256` в JWT.
2. **Service:**
   - Парсит body как `WebhookEvent` (тип LiveKit SDK).
   - Дедуп: `INSERT INTO webhook_seen_events (event_id, event_type) ON CONFLICT DO NOTHING` — если 0 строк, считаем дубликат и возвращаем 200 без работы.
   - Логирует событие (`livekit_webhook_events_total{type}` ++).
   - Делегирует в `MeetingsService` (Фаза 2) — но в Фазе 1 делегата ещё нет, пока просто пишем в `meeting_event` если есть `meetingId` в payload.
3. **Контроллер:** `POST /webhooks/livekit`, raw body для подписи, всегда возвращает 200 (на ошибки дедупа/обработки — лог + 200, чтобы LiveKit не ретраил вечно). Исключение: 401 на невалидную подпись.

### DoD
- [ ] Реальный запрос от LiveKit (или сэмулированный с правильной подписью) → 200, событие в `webhook_seen_events`.
- [ ] Повтор того же события → 200, но без второй записи.
- [ ] Запрос с битым sha256 → 401.

## 1.8 Глобальные настройки приложения

### Файлы
- `backend/src/main.ts`
- `backend/src/app.module.ts`
- `backend/src/common/swagger/swagger.config.ts`

### Что делаем
- `cookieParser`, `helmet`, jsonLimit 1mb, enableCors (whitelist из ENV).
- Глобальный `ZodValidationPipe`, `AllExceptionsFilter`.
- `ThrottlerModule` (rate-limit на anonymous endpoints — 60 rpm на IP).
- Swagger: `/api/docs` (под basic-auth в prod), генерится из zod-схем (через `nestjs-zod`).
- Раздел "Crossmark Integration" в Swagger — отдельный document `/api/integrations/docs` (отдают только публикуемое API партнёру).

### DoD
- [ ] `GET /api/docs` показывает все эндпоинты с типами.
- [ ] CORS preflight: `Origin: https://meet.crossmark.ru` пропускается, `https://evil.com` отбрасывается.

## DoD Фазы 1

- [ ] Все подфазы Done.
- [ ] `bun run typecheck` — 0 ошибок.
- [ ] `bun run test:unit` — зелёный.
- [ ] При деплое на dev — health/ready 200, webhooks/livekit принимают реальные события от тестовой LiveKit.

---

# Фаза 2 — Domain: Users, Meetings, Participants, Crossmark API

**Цель фазы:** через Crossmark API можно создать встречу, получить deep-link; пользователь по deep-link обменивает JWT на cookie, попадает на страницу-заглушку; гость по той же ссылке видит «введите имя» и через `POST /meetings/:id/join` получает `Participant`. Никакого LiveKit ещё нет — на этом этапе фронт только проверяет роль.

## 2.1 Users-модуль

### Файлы
- `backend/src/modules/users/users.module.ts`
- `backend/src/modules/users/users.service.ts`
- `backend/src/modules/users/users.repository.ts`
- `backend/src/modules/users/dto/upsert-user.dto.ts`

### Что делаем
- `UsersService.upsertFromCrossmark({ externalId, email, name })`:
  - найти по `externalId`; если есть — обновить email/name, если изменились;
  - если нет — создать.
  - вернуть `User`.
  - всё в одной транзакции.
- `UsersService.touchLastSeen(userId)` — обновить `lastSeenAt`.

### DoD
- [ ] Юнит-тесты `upsertFromCrossmark` (новый, существующий с теми же данными, существующий с обновлённым именем).

## 2.2 Meetings-модуль: создание + чтение

### Файлы
- `backend/src/modules/meetings/meetings.module.ts`
- `backend/src/modules/meetings/meetings.controller.ts`         (cookie endpoints)
- `backend/src/modules/meetings/meetings.crossmark.controller.ts` (HMAC endpoints)
- `backend/src/modules/meetings/meetings.service.ts`
- `backend/src/modules/meetings/meetings.repository.ts`
- `backend/src/modules/meetings/fsm/meeting-fsm.ts`
- `backend/src/modules/meetings/dto/...`
- `backend/src/modules/meetings/domain/meeting.domain.ts`

### Что делаем

**FSM:**
```ts
const allowed: Record<MeetingStatus, MeetingStatus[]> = {
  scheduled: ['active', 'failed'],
  active: ['completed', 'failed'],
  completed: ['recording_processing', 'failed', 'transcription_processing'],  // если запись не велась — сразу transcription_processing скипается; на MVP completed = терминал, если recording.status === not_started
  recording_processing: ['recording_ready', 'failed'],
  recording_ready: ['transcription_processing', 'failed'],
  transcription_processing: ['transcription_ready', 'failed'],
  transcription_ready: ['ai_processing', 'failed'],
  ai_processing: ['ai_ready', 'failed'],
  ai_ready: [],
  failed: [],
};
function transition(meeting, to) { if (!allowed[meeting.status].includes(to)) throw new InvalidFsmTransitionError(meeting.status, to); }
```

**MeetingsService:**

```ts
createFromCrossmark(input: { host, type, title, customPrompt? }): { meetingId, deepLink }
  — upsertFromCrossmark
  — генерим id = ulid()
  — Meeting.create({ id, roomName: id, type, customPrompt, ownerId, status: scheduled, retentionDays = DEFAULT_RETENTION_DAYS })
  — создаём deep-link JWT (15 min) на хоста
  — формируем url = `${PUBLIC_FRONTEND_URL}/m/${id}?t=${jwt}`
  — return { meetingId: id, deepLink: url, expiresAt: jwt.exp }
  — всё в транзакции

getMeetingForCrossmark(id): { id, title, type, status, startedAt, endedAt, owner: { externalId, email, name } }
getMeetingForUser(id, userId): включая participants[]
listMeetingsForUser(userId, { page, limit, status?, type? }): paginated

cancelScheduled(id, partnerId): только если status=scheduled
```

**Crossmark Controller (HmacGuard):**

| Метод | Путь | Тело/Query | Ответ |
|---|---|---|---|
| POST | `/integrations/crossmark/v1/meetings` | `CreateMeetingDto` | `{ meeting_id, deep_link, expires_at }` |
| GET | `/integrations/crossmark/v1/meetings/:id` | — | `MeetingPublicDto` |
| DELETE | `/integrations/crossmark/v1/meetings/:id` | — | `{ ok: true }` (только scheduled) |

`CreateMeetingDto` (zod):
```ts
{
  host: { external_id: string, email: string.email(), name: string.min(1).max(120) },
  type: enum(MeetingType),
  title: string.min(1).max(200),
  custom_prompt: string.max(10000).optional()
}
```

**Cookie Controller:**

| Метод | Путь | Auth | Ответ |
|---|---|---|---|
| GET | `/api/v1/meetings/:id/access` | optional cookie | `{ role: 'host'\|'guest'\|'none', meeting: { id, title, type, status } }` |
| GET | `/api/v1/meetings` | cookie | пагинация |
| GET | `/api/v1/meetings/:id` | cookie (host only) | детали |

### DoD
- [ ] Через Crossmark API (с правильной подписью) можно создать встречу — проверено curl-сценарием.
- [ ] Возвращаемый deep-link содержит JWT; декодинг даёт `{ sub: ownerId, meetingId }`.
- [ ] Повторный POST с тем же `X-Idempotency-Key` отдаёт **тот же** `deep_link` и не создаёт второй Meeting.
- [ ] `GET /access` без cookie → `role: 'none'`; с cookie владельца → `role: 'host'`.

## 2.3 Deep-link обмен JWT → cookie (page route)

### Файлы
- `backend/src/modules/auth/auth.controller.ts`
- `backend/src/modules/auth/services/deep-link.service.ts`

### Что делаем
- `GET /api/v1/auth/exchange?token=<jwt>&meeting_id=<id>` (вызывается фронтом из page handler):
  1. Валидируем JWT (sub, meetingId, exp).
  2. Сверяем `meetingId` с query `meeting_id`.
  3. Создаём session JWT, ставим cookie `z_session` (`Secure; HttpOnly; SameSite=Lax; Domain=.crossmark.ru`).
  4. Возвращаем `{ ok: true, redirect: `/m/${meetingId}` }`.
- На фронте page-handler вызывает этот endpoint и делает 302 на чистый URL — детали в Фазе 6.

### DoD
- [ ] Валидный токен → cookie выставлен, ответ ok.
- [ ] Просроченный токен → 401 `deep_link_expired`.
- [ ] Token с другим meetingId → 401 `deep_link_mismatch`.

## 2.4 Гостевой join

### Файлы
- `backend/src/modules/participants/participants.module.ts`
- `backend/src/modules/participants/participants.service.ts`
- `backend/src/modules/participants/participants.controller.ts`
- `backend/src/modules/participants/dto/join-meeting.dto.ts`

### Что делаем
**`POST /api/v1/meetings/:id/join`** (CookieAuthGuard optional)
Body:
```ts
{ guest_name?: string }   // нужен только если cookie нет или это не host
```

Логика:
1. Достать meeting. Если нет — 404. Если status `failed`/`completed` после ended_at — 410 `meeting_finished`.
2. Если есть валидный `req.user` и он `meeting.ownerId` — это **host**:
   - найти/создать `Participant` с `role: host`, `livekitIdentity: 'host:<userId>'`, `name: user.name`, `userId: user.id`, `isRegisteredUser: true`.
3. Иначе — это **guest**:
   - `guest_name` обязателен (1..80 chars, sanitize).
   - Проверяем cookie `guest_session_<meetingId>` — если есть, переиспользуем `participant_id`.
   - Иначе создаём `Participant` с `role: guest`, `livekitIdentity: 'guest:<cuid>'`, `name`, ставим cookie `guest_session_<meetingId>`.
4. Возвращаем `{ participant_id, role, livekit_identity, livekit: { url: env.LIVEKIT_API_URL, token: '<placeholder>' }, meeting: {...} }`.
   - В Фазе 2 `livekit.token` — `null`/заглушка. В Фазе 3 заменим на реальный token.

### DoD
- [ ] Хост по cookie создаёт Participant `role=host`.
- [ ] Гость с `guest_name` создаёт Participant `role=guest`.
- [ ] Гость без `guest_name` → 400 `guest_name_required`.
- [ ] Имя XSS (`<script>`) — strip, в БД чистое.

## 2.5 Тесты Crossmark integration end-to-end

### Файлы
- `backend/test/e2e/crossmark.e2e.spec.ts`

### Что делаем
- Сценарий «создать-получить-отменить»:
  1. Создаём IntegrationKey программно.
  2. Делаем `POST /integrations/crossmark/v1/meetings` с правильной подписью.
  3. Проверяем 201 + поля.
  4. `GET /integrations/crossmark/v1/meetings/:id` → 200, статус scheduled.
  5. `DELETE /integrations/crossmark/v1/meetings/:id` → 200.

### DoD
- [ ] e2e зелёный в CI с testcontainers postgres+redis.

## DoD Фазы 2

- [ ] Crossmark может создать встречу через API.
- [ ] Хост по deep-link получает cookie и видит свою встречу.
- [ ] Гость по той же ссылке вводит имя и создаётся `Participant`.
- [ ] Все операции идемпотентны.

---

# Фаза 3 — LiveKit интеграция (токены, room, host-controls, raise-hand)

**Цель фазы:** реальный LiveKit токен для хоста и гостя; `room_started/finished/participant_joined/left` → меняют FSM встречи; host может mute/kick через backend; raise-hand работает через `participant.attributes`.

## 3.1 LivekitService — обёртка над Server SDK

### Файлы
- `backend/src/modules/livekit/livekit.module.ts`
- `backend/src/modules/livekit/livekit.service.ts`
- `backend/src/modules/livekit/types.ts`

### Что делаем
```ts
class LivekitService {
  // токены
  generateHostToken(meeting, user) → JWT (canPublish=true, canSubscribe=true, roomAdmin=true, ttl=меньше из (meeting.endedAt+5min) и сессии)
  generateGuestToken(meeting, participant) → JWT (canPublish=true, canSubscribe=true, roomAdmin=false)

  // комнаты
  ensureRoom(meeting): создаёт room если нет
  deleteRoom(meeting)
  listParticipants(meeting)

  // управление
  muteParticipant(meeting, identity, trackSid?)
  removeParticipant(meeting, identity)
  updateParticipantAttributes(meeting, identity, attributes)
}
```

Реализация через `livekit-server-sdk`. URL — `LIVEKIT_API_URL`, ключи — `LIVEKIT_API_KEY/SECRET`.

### DoD
- [ ] Юнит-тесты на корректное содержимое JWT (decoded payload).
- [ ] Интеграционно: `ensureRoom` создаёт Room на тестовом LiveKit, `deleteRoom` удаляет.

## 3.2 Реальные токены в `/join`

### Что делаем
В `participants.service.ts` (Фаза 2.4) теперь:
- для хоста — `LivekitService.generateHostToken`;
- для гостя — `generateGuestToken`;
- `LivekitService.ensureRoom(meeting)` перед выдачей.

Возвращаем:
```json
{
  "participant_id": "...",
  "role": "host" | "guest",
  "livekit": {
    "url": "https://media.crossmark.ru",
    "token": "<jwt>",
    "identity": "host:<userId> | guest:<cuid>"
  }
}
```

### DoD
- [ ] Реальный браузер с `livekit-client` SDK подключается к комнате с этим токеном.

## 3.3 Webhook → FSM-переходы

### Файлы
- `backend/src/modules/webhooks/livekit-events.handler.ts`

### Что делаем
Внутри `LivekitWebhooksService` после дедупа маршрутизируем:

| Event | Действие |
|---|---|
| `room_started` | `meeting.status: scheduled → active`, `startedAt = now` |
| `room_finished` | `meeting.status: active → completed`, `endedAt = now`. Если `recording.status in (recording, finalizing)` — оставляем нынешний переход; иначе если запись была — `→ recording_processing`; если не велась — на этом всё. |
| `participant_joined` | upsert `Participant.joinedAt`. Запись `meeting_event`. |
| `participant_left` | `Participant.leftAt = now`. Если все участники ушли и meeting в `active` — НЕ финишим (ждём `room_finished` или idle-cron). |
| `track_published` | если audio — пишем в `meeting_event` (используется AI-пайплайном для подтверждения наличия дорожек). |
| `egress_started` / `egress_ended` / `egress_failed` | в Фазе 4. |

Все апдейты статуса — через `MeetingsService.transition()`.

### DoD
- [ ] При реальной встрече `room_started` ставит `active`, `room_finished` — `completed`.
- [ ] Дубль `room_started` не падает (idempotent).

## 3.4 Host controls (mute/kick/finish)

### Файлы
- `backend/src/modules/meetings/meetings.controller.ts` (extend)
- `backend/src/modules/meetings/host-controls.service.ts`

### Что делаем
- `POST /api/v1/meetings/:id/participants/:pid/mute` → `LivekitService.muteParticipant`. Только `host`.
- `POST /api/v1/meetings/:id/participants/:pid/kick` → `LivekitService.removeParticipant`. Только `host`.
- `POST /api/v1/meetings/:id/finish` → проверяем что у юзера host, `LivekitService.deleteRoom`. Webhook `room_finished` дотолкнёт FSM.
- Все эти действия логируются в `meeting_event`.

### DoD
- [ ] Хост может мьютить и выкидывать гостя.
- [ ] Гость не может (403).
- [ ] `finish` — удаляет room, FSM → `completed` через webhook.

## 3.5 Raise hand backend

### Файлы
- `backend/src/modules/meetings/host-controls.service.ts` (extend)
- `backend/src/modules/meetings/meetings.controller.ts` (extend)

### Что делаем
- `POST /api/v1/meetings/:id/participants/:pid/lower-hand` (host only) — `updateParticipantAttributes(identity, { hand_raised: 'false', hand_raised_at: '' })`.
- Поднимать/опускать **свою** руку — frontend дёргает сам через `livekit-client` `setAttributes`. Backend не нужен.

### DoD
- [ ] Хост может опустить чужую руку. Чужая рука действительно опустилась (атрибут проверяется на втором клиенте).

## 3.6 Idle-meeting cron

### Файлы
- `backend/src/modules/meetings/cron/idle-meeting.cron.ts`

### Что делаем
- `@Cron(env.IDLE_MEETING_CRON)`:
  - найти `Meeting.status = active` где `startedAt + IDLE_MEETING_TIMEOUT_MINUTES < NOW` И никто из participants не `joined` или все `left`.
  - дёрнуть `LivekitService.deleteRoom`.
  - Webhook `room_finished` придёт асинхронно и зафиксирует `completed`.

### DoD
- [ ] Встреча, где никто не остался, через 15 минут авто-закрывается.

## DoD Фазы 3

- [ ] Реальная встреча с двумя браузерами. Хост и гость зашли. FSM прошла `scheduled → active → completed`. Журнал `meeting_event` содержит все ключевые шаги. Raise-hand работает у обоих.

---

# Фаза 4 — Recording: запуск/остановка, S3, retention

**Цель фазы:** хост по кнопке запускает запись (composite + N×track), файлы доезжают в S3, метаданные оседают в `Recording`/`AudioTrack`, retention-cron знает про expires_at и при наступлении удаляет.

## 4.1 RecordingService — запуск и остановка

### Файлы
- `backend/src/modules/recordings/recordings.module.ts`
- `backend/src/modules/recordings/recordings.service.ts`
- `backend/src/modules/recordings/recordings.controller.ts`
- `backend/src/modules/recordings/livekit-egress.client.ts`
- `backend/src/modules/recordings/dto/...`

### Что делаем

**Endpoints (host only):**
- `POST /api/v1/meetings/:id/recording/start` → `RecordingService.start(meeting, user)`.
- `POST /api/v1/meetings/:id/recording/stop` → `RecordingService.stop(meeting, user)`.

**`RecordingService.start(meeting):`**
1. Проверки: `meeting.status === 'active'`, `recording.status in (not_started, failed)`.
2. В транзакции — upsert `Recording`:
   - `retentionDays = env.DEFAULT_RETENTION_DAYS`
   - `expiresAt = NOW() + retentionDays * 24h` (пересчитывается на финале от `endedAt`).
   - `status = requested`.
3. Запускаем **composite egress** через `livekit-egress.client.startRoomCompositeEgress`:
   - `roomName: meeting.id`,
   - `output: S3Upload({ bucket, accessKey, secretKey, endpoint, key: `meetings/${id}/composite.mp4`})`,
   - `layout: 'grid'`, audioOnly: false.
4. Запускаем **track egress на участников по мере track_published** — лучше: при `start` ставим планку в Redis `meeting:<id>:track-egress-pending=true`, и обработчик `track_published` (Фаза 3.3) для audio-tracks дёргает `RecordingService.ensureTrackEgress(meeting, track)`.
5. Сохраняем `compositeEgressId`, audio-track egress ID в `AudioTrack` (через webhook `egress_started`).

**`RecordingService.stop(meeting):`**
1. Проверки: `recording.status in (recording)`.
2. Дёргаем `stopEgress(compositeEgressId)` и все `track_egress_id` по audio_tracks.
3. `recording.status: recording → finalizing`. Дальше webhook `egress_ended` → `ready`.

### DoD
- [ ] Стартует composite + track-egress(ы), процесс отображается в LiveKit Egress UI (если есть).

## 4.2 Webhook egress → recording FSM

### Файлы
- `backend/src/modules/webhooks/livekit-events.handler.ts` (extend)

### Что делаем
- `egress_started`:
  - если `egressInfo.requestType === 'room_composite'` → `recording.status: requested → recording`, save `compositeEgressId`.
  - если `track` → найти `AudioTrack` по `participantIdentity` (создать заранее через track_published или upsert здесь), сохранить `trackEgressId`.
- `egress_ended`:
  - composite: сохранить `mainVideoUrl` из `fileResults[0].location`, размер `bytesTotal`, длительность, `recording.status: finalizing` (если все треки тоже ended → `ready`).
  - track: записать `audioUrl`, `bytes`, `durationSeconds`. Если все ENDED → `recording.status → ready`.
- `egress_failed`:
  - composite или track: лог, метрика, `meeting_event`. Если все остальные OK — meeting может продолжать в AI-пайплайн с тем, что есть. Если упали все — `recording.status: failed`, и `meeting → failed`.

После `recording.status → ready`:
- В транзакции выставить `meeting.status: completed → recording_processing` (если ещё не) → `recording_ready`.
- Поставить BullMQ job `transcribe` для meeting (см. Фаза 5).

### DoD
- [ ] После 5-минутной встречи с записью: composite mp4 + N audio (по числу participants) лежат в S3, recording `ready`, meeting `recording_ready`, в очереди появился `transcribe` job.

## 4.3 Скачивание (presigned URL)

### Файлы
- `backend/src/modules/recordings/s3.service.ts`
- `backend/src/modules/recordings/recordings.controller.ts` (extend)

### Что делаем
- `GET /api/v1/meetings/:id/recording/download` (host only) → `S3Service.presignGet(key, ttl=env.S3_PRESIGNED_TTL_SECONDS)` для `mainVideoUrl`. Возврат `{ url, expires_at }`.
- `GET /integrations/crossmark/v1/meetings/:id/recording-url` — то же, но HMAC.
- На audio-tracks отдельная download-ссылка не нужна для пользователя (это для AI). Но в admin есть.

### DoD
- [ ] Получаемая ссылка скачивается curl'ом.
- [ ] Ссылка истекает через TTL — повторная попытка GET → 403 от S3.

## 4.4 Retention cron

### Файлы
- `backend/src/modules/retention/retention.module.ts`
- `backend/src/modules/retention/retention.cron.ts`
- `backend/src/modules/retention/retention.service.ts`

### Что делаем
- `@Cron(env.RETENTION_CRON)`:
  - найти `Recording` где `expiresAt < NOW` AND `status NOT IN (deleted, archived)`.
  - на каждое:
    - удалить объекты из S3 (`composite.mp4` + все audio).
    - проставить `recording.status = deleted`, `deletedAt = NOW`.
    - записать `recording_action` (`actor: 'cron'`, `reason: 'tariff_expired'`).
- Метрика: `recordings_deleted_total{reason=}`.

### DoD
- [ ] Тестово: создать запись с `expiresAt = NOW - 1m` → cron-проход удалил из S3 и проставил deleted.

## 4.5 Soft-delete и продление (опционально для MVP-shell)

В MVP без UI на это:
- API: `POST /integrations/crossmark/v1/meetings/:id/extend-retention` (HMAC) — `body: { add_days: number }` → `expiresAt += add_days*24h`, `recording_action(extended)`.
- API: `DELETE /api/v1/meetings/:id/recording` (host) — мгновенное удаление, `recording_action(deleted, actor: user)`.

### DoD
- [ ] Продление: `expiresAt` сдвигается, лог появляется.
- [ ] Досрочное удаление: файлы из S3 уходят, статус deleted.

## DoD Фазы 4

- [ ] End-to-end сценарий: хост стартует запись → запись идёт → стопает → файлы в S3 → recording_ready → meeting_event лог полный.
- [ ] Retention cron работает.
- [ ] Качество per-track audio проверено на отсутствие потрескивания (см. `code-pitfalls.md` п.1).

---

# Фаза 5 — AI Pipeline (transcribe → merge → analyze → notify)

**Цель фазы:** после `recording_ready` автоматически запускается цепочка из 4 BullMQ-задач, на выходе — `AiResult` с `summary`, `structured_data` или `custom_output_md`, `tasks` и `follow_up_email` (где применимо), `AiUsageLog`-записи на каждый вызов.

## 5.1 BullMQ модуль и общие воркеры-инфраструктура

### Файлы
- `backend/src/modules/ai/ai.module.ts`
- `backend/src/modules/ai/queues.ts`
- `backend/src/workers/main.ts`
- `backend/src/workers/worker-bootstrap.ts`

### Что делаем
- Конфигурируем 4 очереди: `ai.transcribe`, `ai.merge`, `ai.analyze`, `ai.notify`.
- Default options: `attempts: 5`, `backoff: { type: 'exponential', delay: 8000 }`, `removeOnComplete: { age: 86400 }`, `removeOnFail: false`.
- `workers/main.ts` — отдельный entrypoint Nest standalone application, регистрирует только нужные модули (без HTTP), запускает воркеры.
- Метрики: `bullmq-prometheus` или вручную gauge `bullmq_active`, `bullmq_waiting`, `bullmq_failed`.

### DoD
- [ ] `node dist/workers/main.js` стартует, видит очереди.
- [ ] Тестовый job обрабатывается.

## 5.2 Vox-клиент (ASR)

### Файлы
- `backend/src/modules/ai/services/vox.service.ts`
- `backend/src/modules/ai/services/vox.types.ts`

### Что делаем
```ts
class VoxService {
  submit(audioStream, opts: { language: 'ru', punctuationMode: 'pro', diarizationEnabled: false }): Promise<{ taskId: string }>
  poll(taskId, opts: { intervalMs: 2000, maxAttempts: 60 }): Promise<VoxResult>
  // result содержит word-timestamps: [{ word, startMs, endMs, speaker? }]
}
```

Реализация — multipart `submit` → poll по `GET /tasks/:taskId` каждые 2 сек.

Retry стратегия (внутри submit/poll): 3 попытки с задержками `[3000, 8000, 15000] ms` на сетевые ошибки.

Логи в `AiUsageLog` (`agentType: 'transcribe'`, `provider: 'vox'`, без costUsd — внутренняя цена).

### DoD
- [ ] Тестовый wav → текст с временами. Вернулся в формате `VoxResult`.

## 5.3 Anthropic-клиент (LLM)

### Файлы
- `backend/src/modules/ai/services/anthropic.service.ts`
- `backend/src/modules/ai/services/llm-fallback.service.ts`

### Что делаем
- `AnthropicService.complete({ system, messages, tools?, model })`:
  - сначала streaming через `@anthropic-ai/sdk`.
  - на ошибку 403 (РФ-IP) или сетевую — fallback на non-stream через тот же SDK.
  - на устойчивую недоступность → `LlmFallbackService` (MiniMax / OpenAI-via-proxy).
- Использовать prompt caching: `system` блок отмечать `cache_control: { type: 'ephemeral' }`.
- На каждый вызов — `AiUsageLog`: `model`, `provider: 'anthropic'`, `inputTokens`, `outputTokens`, `costUsd` (рассчитан по таблице цен из reference в memory: `claude-sonnet-4-6` $3/1M in, $15/1M out).

### DoD
- [ ] Юнит: маппинг tokens → cost корректный.
- [ ] При намеренном 403 на mock — fallback срабатывает, AiUsageLog содержит `provider: 'minimax'` или `'openai-via-proxy'`.

## 5.4 Промпты по типам

### Файлы
- `backend/src/modules/ai/services/prompts/index.ts`
- `backend/src/modules/ai/services/prompts/system-summary.ts`
- `backend/src/modules/ai/services/prompts/type-{team,standup,plan_fact,project,sales,custdev,partner,interview,customer_success}.ts`
- `backend/src/modules/ai/services/prompts/follow-up.ts`
- `backend/src/modules/ai/services/prompts/tasks.ts`

### Что делаем
Каждый файл экспортирует:
```ts
export type PromptInput = { meeting: { id, title, type, startedAt, endedAt, customPrompt? }, dialog: DialogTurn[] };
export type DialogTurn = { speaker: string, text: string, startSec: number, endSec: number };
export const buildPrompt: (input: PromptInput) => { system: string, user: string, jsonSchema?: ZodSchema };
```

**JSON-схемы по типам** (Zod) — соответствуют `01_projects/ai-analysis-by-type.md`. Пример для `sales`:
```ts
const SalesSchema = z.object({
  pain: z.string(),
  interest_level: z.enum(['low','medium','high']),
  objections: z.array(z.string()),
  budget: z.string().nullable(),
  decision_maker: z.string().nullable(),
  urgency: z.string().nullable(),
  next_step: z.string()
});
```

Аналогично для остальных 8 типов. Точные поля — из `01_projects/ai-analysis-by-type.md` § «Шаблоны по типу».

`system-summary.ts` — общий, генерит 2-3 предложения, **не зависит от типа**.

`follow-up.ts` — для типов `sales` и `customer_success`. `tasks.ts` — для `team`, `standup`, `plan_fact`, `project`.

### DoD
- [ ] Юнит-тесты на структурные промпты (что schema валидирует синтетический ответ).

## 5.5 transcribe.worker

### Файлы
- `backend/src/modules/ai/workers/transcribe.worker.ts`

### Что делаем

Job payload: `{ meetingId, attempt }`.

Логика:
1. `meeting = MeetingsService.get(meetingId)`. Если status не `recording_ready` — выйти (idempotent).
2. `meeting.status: recording_ready → transcription_processing`.
3. Найти все `AudioTrack` для `meeting.recording`.
4. Параллельно (concurrency 4 на воркер): для каждого трека:
   - Стянуть аудио из S3 streaming (`GetObjectCommand`).
   - `vox.submit(stream, opts)`.
   - `vox.poll(taskId)`.
   - Получить json: `{ track_id, participant_id, words: [...], full_text }`.
   - Загрузить json в S3 `meetings/<id>/transcripts/track_<participant>.json`.
5. После всех — записать `Transcript`:
   - `rawIndexS3Url` = `meetings/<id>/transcripts/index.json` (массив ссылок на per-track json).
6. Поставить job в `ai.merge`.

Идемпотентность: если уже есть `Transcript.rawIndexS3Url` — не перезаписывать без принудительного `force` флага.

### DoD
- [ ] На live-встрече с 2 участниками транскрибация двух дорожек проходит, JSON в S3, статус `transcription_processing`.

## 5.6 merge.worker

### Файлы
- `backend/src/modules/ai/workers/merge.worker.ts`
- `backend/src/modules/ai/services/merger.ts`

### Что делаем
1. Читаем все per-track jsons (с поправкой на абсолютное время `track.startedAt`).
2. Склеиваем по абсолютной шкале:
   - каждый word → `{ speaker: participant_name, word, abs_start, abs_end }`.
   - группируем подряд идущие words одного speaker в turn'ы (gap > 1.5 сек = новый turn).
3. Получаем `merged: DialogTurn[]`.
4. Загружаем в S3 `meetings/<id>/transcripts/merged.json`.
5. Обновляем `Transcript.mergedS3Url`, `totalWords`, `totalDurationSeconds`.
6. `meeting.status → transcription_ready`.
7. Ставим job в `ai.analyze`.

### DoD
- [ ] merged.json содержит читабельный диалог в правильной последовательности.
- [ ] При двух одновременных репликах — чьи слова в каком turn'е однозначно.

## 5.7 analyze.worker

### Файлы
- `backend/src/modules/ai/workers/analyze.worker.ts`
- `backend/src/modules/ai/services/ai-orchestrator.service.ts`

### Что делаем

`meeting.status: transcription_ready → ai_processing`.

Шаги:
1. Загрузить `merged.json`.
2. Сгенерить `summary` (общий промпт, всегда). Записать в `AiResult.summary` (ещё нет — создаём пустой AiResult и постепенно заполняем).
3. Если `meeting.customPrompt` задан:
   - вызвать LLM с `system = customPrompt`, `user = диалог`.
   - сохранить markdown в `customOutputMd`.
   - `structuredData = null`.
4. Иначе — вызвать LLM с `prompts/type-<type>` + tool-call с `JSON-schema`:
   - первый attempt: tool use, парсим JSON, валидируем zod.
   - на ошибку парсинга — повтор с подсказкой «вернуть валидный JSON по схеме» (макс 2 retries).
   - на 3-й — fail.
   - сохранить в `structuredData`.
5. Если type ∈ `{sales, customer_success}` — вызвать `prompts/follow-up`. Сохранить в `followUpEmail`.
6. Если type ∈ `{team, standup, plan_fact, project}` — вызвать `prompts/tasks`. Сохранить в `tasks` (массив `{title, assignee, dueDate}`).
7. Все вызовы → `AiUsageLog`.
8. `meeting.status → ai_ready`.
9. Ставим job в `ai.notify`.

### DoD
- [ ] На тестовой встрече типа `sales` без customPrompt — `AiResult.structured_data` содержит валидный JSON с обязательными полями.
- [ ] На той же встрече с `customPrompt = 'Сделай краткий отчёт в формате Markdown'` — `customOutputMd` заполнен, `structured_data` = null.

## 5.8 notify.worker

### Файлы
- `backend/src/modules/ai/workers/notify.worker.ts`

### Что делаем
- Пометить `meeting_event` тип `ai_notified`.
- В MVP — никаких email, push, etc. Frontend узнаёт через polling.
- Hook для будущих интеграций (Resend, SES, Telegram).

### DoD
- [ ] Job завершается успехом, событие записано.

## 5.9 Retry from failed

### Файлы
- `backend/src/modules/ai/services/retry.service.ts`
- `backend/src/modules/meetings/meetings.controller.ts` (extend)

### Что делаем
- `POST /api/v1/meetings/:id/retry-ai` (host) и `POST /admin/api/v1/meetings/:id/retry-ai` (admin):
  - проверяем что `meeting.status === 'failed'`.
  - смотрим на `Transcript`/`AiResult` — на каком этапе упало:
    - нет Transcript → вернуть на `recording_ready`, поставить `transcribe`.
    - есть Transcript без mergedS3Url → `transcription_processing` → `merge`.
    - есть mergedS3Url, нет AiResult → `transcription_ready` → `analyze`.
    - AiResult есть — нечего повторять.
  - rate limit для пользовательского endpoint: 3 попытки в час.

### DoD
- [ ] failed после mock-ошибки в analyze → retry-ai → пайплайн идёт с analyze, ai_ready.

## DoD Фазы 5

- [ ] Sales-встреча типа на 5 минут → через ~3 минуты после `room_finished` есть `ai_ready`, на странице видны summary, структурированный отчёт, follow-up email.
- [ ] Custom-promt вариант — отчёт markdown.
- [ ] AiUsageLog накопил записи на все 4 LLM-вызова + transcribe.

---

# Фаза 6 — Frontend каркас, auth, layout, API-client

**Цель фазы:** Next.js-приложение с App Router, единым apiClient, AuthContext, layout-ами, базовыми UI-элементами и обработкой 4 состояний (loading/empty/error/success). Фронт умеет обмениваться deep-link JWT на cookie и держит сессию.

## 6.1 Bootstrap Next.js

### Файлы
- `frontend/package.json`
- `frontend/tsconfig.json`
- `frontend/next.config.js`
- `frontend/app/layout.tsx`
- `frontend/app/page.tsx`
- `frontend/middleware.ts`
- `frontend/.env.example`

### Что делаем
1. `bunx create-next-app@latest frontend --ts --eslint --app --src-dir=false --tailwind` (или вручную с минимумом).
2. Зависимости: `livekit-client @livekit/components-react @livekit/components-styles zod swr clsx`.
3. ENV (фронт):
   ```
   NEXT_PUBLIC_API_BASE_URL=https://api.crossmark.ru
   NEXT_PUBLIC_LIVEKIT_URL=https://media.crossmark.ru
   ```
4. `next.config.js`: `transpilePackages: ['@livekit/components-react']`, security headers (CSP, frame-ancestors none).
5. `middleware.ts`: для public страниц `/m/[id]` пропускать без cookie; для остальных под `(authenticated)` — редиректить на «нужно открыть из Crossmark» при отсутствии cookie.
6. Базовый layout с шапкой/футером и провайдерами.

### DoD
- [ ] `bun run dev` поднимает Next на порту 3001.
- [ ] `https://meet.crossmark.ru/` открывает заглушку.

## 6.2 API-клиент

### Файлы
- `frontend/src/api/api-client.ts`
- `frontend/src/api/api-error.ts`
- `frontend/src/api/types.ts`

### Что делаем
```ts
class ApiClient {
  async get<T>(path, opts?): Promise<T>
  async post<T>(path, body, opts?): Promise<T>
  async del<T>(path): Promise<T>
}
```

Поведение:
- `credentials: 'include'`, базовый URL из `NEXT_PUBLIC_API_BASE_URL`.
- 401 → `events.emit('auth:expired')` → обработчик в AuthProvider — редирект.
- 403 → `throw ApiError({code:'forbidden'})`.
- 5xx + GET → 2 retry с экспон. backoff (1s, 3s).
- На каждый запрос — генерить `X-Request-Id` (`nanoid`).
- Ответ типизируется через zod-схему — один файл `dto/<feature>.dto.ts` импортируется и в Domain-mapper.

### DoD
- [ ] Юнит-тесты на retry-поведение, на 401-реакцию.

## 6.3 Auth-контекст и проверка сессии

### Файлы
- `frontend/src/contexts/auth-context.tsx`
- `frontend/src/api/auth.api.ts`
- `frontend/app/api/auth/me/route.ts` (next route handler как прокси к backend)

### Что делаем
- `AuthProvider`:
  - на старте дёргает `GET /api/v1/auth/me` (через cookie) → `{ user: { id, email, name, role } | null }`.
  - хранит в state, экспортирует через `useAuth()`.
  - При `auth:expired` чистит state и редиректит:
    - если пользователь на public-странице (`/m/...`) — оставляем (как guest).
    - иначе — `/m-not-authorized`.

### DoD
- [ ] При наличии cookie — `useAuth().user` заполнен.
- [ ] Без cookie — `null`.

## 6.4 Layout, токасты, общие компоненты

### Файлы
- `frontend/src/contexts/toast-context.tsx`
- `frontend/src/ui/components/shared/Button.tsx`
- `frontend/src/ui/components/shared/Modal.tsx`
- `frontend/src/ui/components/shared/Skeleton.tsx`
- `frontend/src/ui/components/shared/EmptyState.tsx`
- `frontend/src/ui/components/shared/ErrorState.tsx`

### Что делаем
- Дизайн-система — Tailwind + минимум CSS-vars. Тёмная тема не делаем в MVP.
- Все компоненты учитывают 4 состояния (loading/empty/error/success) — через primitive'ы выше.
- Toast — простая queue + `<Toaster />` в layout.

### DoD
- [ ] Storybook не делаем; вместо этого — `app/dev/components/page.tsx` (только в dev) с витриной.

## 6.5 i18n

### Файлы
- `frontend/src/lib/i18n/ru.ts`
- `frontend/src/lib/i18n/index.ts`

### Что делаем
- `t('key', vars?)` — простая функция, словарь только русский.
- Все user-facing строки в коде — через `t()`.

### DoD
- [ ] Lint-rule (или ручная проверка) — нет голого русского текста в JSX-тегах.

## DoD Фазы 6

- [ ] Frontend поднимается, AuthContext инициализируется через cookie, API-client рабочий, базовые layout/состояния/i18n настроены.

---

# Фаза 7 — Frontend pages: список, создание, /m/:id, result

**Цель фазы:** все страницы продукта работают: список встреч хоста, создание встречи (отдельно от Crossmark — для своих юзеров), страница встречи с lobby и комнатой, страница результата с прогрессом и финалом.

## 7.1 Page `/m/[id]` — обмен токена и роутинг по роли

### Файлы
- `frontend/app/(public)/m/[id]/page.tsx`
- `frontend/app/(public)/m/[id]/MeetingPageShell.tsx`
- `frontend/src/api/meetings.api.ts`
- `frontend/src/hooks/use-meeting-access.ts`

### Что делаем
1. Server component:
   - читать `?t=` из URL.
   - если есть — серверный fetch `POST /api/v1/auth/exchange?token=...&meeting_id=...` (передавая cookie через `next/headers`).
   - после exchange — `redirect(`/m/${id}`, { type: 'replace' })` (302) на чистый URL.
   - Если exchange неуспешен — рендерим страницу как guest-пользователь.
2. Client shell:
   - `useMeetingAccess(id)` — fetch `/api/v1/meetings/:id/access`.
   - В зависимости от `role` и `meeting.status`:
     - `meeting.status === scheduled` И `role === 'guest'` → `<Lobby waiting />`.
     - `meeting.status === active` → `<MeetingRoom />`.
     - `meeting.status === completed/recording_processing/...` → `<MeetingFinishedPlaceholder />` (с CTA на result для хоста).
     - `meeting.status === failed` → `<MeetingFailedPlaceholder />`.

### DoD
- [ ] Хост по deep-link → редирект на чистый URL → страница в активном состоянии.
- [ ] Гость по тому же URL → форма имени.

## 7.2 Lobby (форма имени для гостя + ожидание хоста)

### Файлы
- `frontend/src/ui/components/lobby/Lobby.tsx`
- `frontend/src/ui/components/lobby/GuestNameForm.tsx`
- `frontend/src/ui/components/lobby/WaitingHost.tsx`

### Что делаем
- `GuestNameForm`:
  - поле «Ваше имя», submit → `POST /api/v1/meetings/:id/join { guest_name }`.
  - при ошибке — toast.
  - при успехе — переходим в `MeetingRoom` с полученными `livekit.{url,token,identity}`.
- `WaitingHost`:
  - если `meeting.status === scheduled` — показываем «Встреча начнётся, когда подключится организатор», поллинг `/access` каждые 5 сек.

### DoD
- [ ] Имя `<script>...` не вылезает в DOM как HTML.
- [ ] Ожидающий гость видит обновление, когда хост подключился.

## 7.3 MeetingRoom — комната

### Файлы
- `frontend/src/ui/components/meeting-room/MeetingRoom.tsx`
- `frontend/src/ui/components/meeting-room/ControlsBar.tsx`
- `frontend/src/ui/components/meeting-room/ParticipantsPanel.tsx`
- `frontend/src/ui/components/meeting-room/ChatPanel.tsx`
- `frontend/src/ui/components/meeting-room/RaiseHandButton.tsx`
- `frontend/src/ui/components/meeting-room/RecordingIndicator.tsx`
- `frontend/src/ui/components/meeting-room/HostMenu.tsx`
- `frontend/src/hooks/use-livekit-room.ts`
- `frontend/src/hooks/use-raise-hand.ts`
- `frontend/src/hooks/use-host-controls.ts`

### Что делаем
1. Подключаемся через `<LiveKitRoom token={...} serverUrl={...}>` из `@livekit/components-react`.
2. **ControlsBar** (нижняя панель):
   - Mic toggle, Camera toggle, Screen share toggle.
   - **Raise hand button** (рука).
   - Для **хоста**: «Начать запись» / «Остановить запись» (кнопка-тоггл).
   - Для **хоста**: «Скопировать ссылку» — копирует чистый URL встречи (`navigator.clipboard.writeText(window.location.origin + '/m/' + id)`), toast «Скопировано».
   - Для **хоста**: «Завершить встречу» — confirm-modal → `POST /api/v1/meetings/:id/finish`.
3. **ParticipantsPanel**:
   - сортировка: те, у кого `hand_raised === 'true'`, наверху по `hand_raised_at`.
   - для каждого — иконка ✋ если рука поднята.
   - для **хоста** на каждом госте: «Mute», «Kick», «Опустить руку».
4. **ChatPanel**:
   - встроенный из `@livekit/components-react` (`<Chat />`) поверх DataChannel.
   - не сохраняем в БД (см. mvp-meeting-flow analysis).
5. **RecordingIndicator**:
   - красный кружок «REC» когда `recording.status in (recording, finalizing)`. Polling статуса встречи раз в 10 сек как fallback к LiveKit-state.
6. **Хуки**:
   - `useLivekitRoom(token, url)` — обёртка с обработкой ошибок connect.
   - `useRaiseHand()` — `setAttributes({hand_raised, hand_raised_at})`, на mute события не дёргается (по решению).
   - `useHostControls()` — все API-вызовы хост-актов.

### DoD
- [ ] Реальный сценарий 2 браузера: хост видит гостя, гость видит хоста, raise-hand работает у обоих, хост может опустить чужую руку, кнопка «Начать запись» меняет UI.

## 7.4 Список встреч хоста `/meetings`

### Файлы
- `frontend/app/(authenticated)/meetings/page.tsx`
- `frontend/src/ui/components/meetings-list/MeetingsTable.tsx`

### Что делаем
- Pagination + filter (status, type).
- Колонки: Тип, Название, Дата, Длительность, Статус, Действия (Открыть, Скопировать ссылку).
- Клик на «Открыть» при статусе `ai_ready/recording_ready/...` — на result; иначе — на `/m/:id`.

### DoD
- [ ] Список рендерится для авторизованного юзера, для неавторизованного — редирект.

## 7.5 Создание встречи `/meetings/create`

### Файлы
- `frontend/app/(authenticated)/meetings/create/page.tsx`
- `frontend/src/ui/components/create-meeting-form/CreateMeetingForm.tsx`

### Что делаем
- Поля: тип (radio cards с кратким описанием), название, custom_prompt (collapsible «Свой промпт отчёта»).
- Submit → `POST /api/v1/meetings` (новый endpoint в backend Фазы 2.2 — встреча для авторизованного юзера, без HMAC; использует `req.user.id` как `ownerId`).
- После создания — редирект на `/m/:id` с автоматическим обменом deep-link не нужен (host уже в cookie).

### Backend дополнение в этой фазе (extend Фазу 2.2)
- `POST /api/v1/meetings` — создаёт встречу для текущего залогиненного юзера. Возвращает `{ id, url }`.

### DoD
- [ ] Хост создаёт встречу из UI и попадает в комнату.

## 7.6 Страница результата `/meetings/:id/result`

### Файлы
- `frontend/app/(authenticated)/meetings/[id]/result/page.tsx`
- `frontend/src/ui/components/meeting-result/ResultPage.tsx`
- `frontend/src/ui/components/meeting-result/ProgressState.tsx`
- `frontend/src/ui/components/meeting-result/SummaryCard.tsx`
- `frontend/src/ui/components/meeting-result/ReportByType.tsx`
- `frontend/src/ui/components/meeting-result/CustomReportMd.tsx`
- `frontend/src/ui/components/meeting-result/FollowUpCard.tsx`
- `frontend/src/ui/components/meeting-result/TasksList.tsx`
- `frontend/src/ui/components/meeting-result/TranscriptViewer.tsx`
- `frontend/src/ui/components/meeting-result/VideoPlayer.tsx`
- `frontend/src/hooks/use-result-polling.ts`

### Что делаем
1. **ProgressState** — пока `meeting.status` не `ai_ready`:
   - визуальные шаги: `Запись` → `Распознаём речь` → `Готовим отчёт` → `Готово`.
   - текущий шаг подсвечен.
   - poll `/api/v1/meetings/:id/result/status` каждые 5 сек.
   - при `failed` — кнопка «Повторить» → `POST /retry-ai`.
2. **ResultPage** при `ai_ready`:
   - шапка: название, тип, дата, длительность, участники, кнопки «Скопировать ссылку», «Скачать запись», «Удалить».
   - VideoPlayer (`<video>` + `mainVideoUrl` через presigned).
   - SummaryCard (всегда).
   - ReportByType **или** CustomReportMd:
     - если `customOutputMd` — рендерим markdown через `react-markdown` (whitelist tags).
     - иначе — `ReportByType` рендерит карточки по `meeting.type` из `structured_data`.
   - FollowUpCard (если есть).
   - TasksList (если есть).
   - TranscriptViewer:
     - читает merged.json с S3 (через presigned-URL endpoint `/api/v1/meetings/:id/transcript`).
     - реплики с тайм-кодами; клик на тайм-код → `videoRef.currentTime = sec`.
3. **TranscriptViewer endpoint** на backend (extend Фазы 5):
   - `GET /api/v1/meetings/:id/transcript` (host) → `{ url: presigned merged.json, duration_seconds }`.

### DoD
- [ ] Sales-встреча: страница в нужный момент показывает summary + структурированный отчёт + follow-up.
- [ ] Custom-prompt-встреча: тот же layout, но с MD-блоком вместо ReportByType.
- [ ] Клик на тайм-код в транскрипте перематывает видео.

## DoD Фазы 7

- [ ] Все страницы работают, golden path для хоста и для гостя проверен в Playwright.

---

# Фаза 8 — Crossmark integration extras + Admin UI + Audit

**Цель фазы:** Crossmark может опросить статус и результат, продлить retention; в Z есть административный UI для управления ключами интеграции, мониторинга AI-затрат, ручного retry-ai и поиска зависших встреч.

## 8.1 Crossmark API: result, recording-url, extend-retention

### Файлы
- `backend/src/modules/integrations-crossmark/crossmark.controller.ts`
- `backend/src/modules/integrations-crossmark/crossmark.service.ts`

### Что делаем
- `GET /integrations/crossmark/v1/meetings/:id/result` — снэпшот AiResult + meeting summary + recording info (без полных URL — просто duration, has_recording).
- `GET /integrations/crossmark/v1/meetings/:id/recording-url` — presigned (через `S3Service`).
- `POST /integrations/crossmark/v1/meetings/:id/extend-retention` `{ add_days }` — Recording.expiresAt += N дней, audit log.
- `GET /integrations/crossmark/v1/usage?from=&to=` — агрегаты по AiUsageLog: количество встреч, токены, стоимость.

### DoD
- [ ] Все четыре endpoints с правильной HMAC-подписью отвечают.

## 8.2 Admin Backend

### Файлы
- `backend/src/modules/admin/admin.module.ts`
- `backend/src/modules/admin/integration-keys.controller.ts`
- `backend/src/modules/admin/meetings-admin.controller.ts`
- `backend/src/modules/admin/ai-usage.controller.ts`
- `backend/src/modules/admin/recordings-admin.controller.ts`
- `backend/src/modules/admin/admin.audit.ts` (interceptor)

### Что делаем
- `GET /admin/api/v1/integration-keys` — список (`partnerName, createdAt, revokedAt`, без plain key).
- `POST /admin/api/v1/integration-keys { partner_name }` — создаём, возвращаем `{ id, key }` (key — сырой, ОДИН раз).
- `DELETE /admin/api/v1/integration-keys/:id` — `revokedAt = now`.
- `GET /admin/api/v1/meetings` — фильтр по status/type/owner/dates.
- `GET /admin/api/v1/meetings/:id` — meeting + participants + recording + transcript pointer + ai-result + meeting_event журнал.
- `POST /admin/api/v1/meetings/:id/force-finish` — `LivekitService.deleteRoom`, при отсутствии webhooks force-set status `completed`.
- `POST /admin/api/v1/meetings/:id/retry-ai` — без cooldown.
- `GET /admin/api/v1/ai-usage` — агрегаты по дням, моделям, partner.
- `GET /admin/api/v1/recordings/expiring?within_hours=48` — что вот-вот удалится.
- AdminAudit — interceptor пишет каждое не-GET-действие в `admin_audit_log`.

### DoD
- [ ] Без admin role доступ к этим endpoint — 403.
- [ ] Все мутации админа в audit-log.

## 8.3 Admin Frontend

### Файлы
- `frontend/app/(admin)/admin/layout.tsx`
- `frontend/app/(admin)/admin/integration-keys/page.tsx`
- `frontend/app/(admin)/admin/meetings/page.tsx`
- `frontend/app/(admin)/admin/meetings/[id]/page.tsx`
- `frontend/app/(admin)/admin/ai-usage/page.tsx`
- `frontend/app/(admin)/admin/recordings/expiring/page.tsx`

### Что делаем
- Минималистичный, без дизайна. Таблицы + действия + confirm-модалки.
- Доступ только при `useAuth().user.role === 'admin'`.

### DoD
- [ ] Админ может создать ключ → скопировать → revoke.
- [ ] Админ может найти зависшую встречу и force-finish.
- [ ] Админ видит ai-usage за день.

## 8.4 Локальный логин для админа (без Crossmark)

### Файлы
- `backend/src/modules/auth/auth.controller.ts` (extend)
- `frontend/app/login/page.tsx`

### Что делаем
- Минимальный email+password (bcrypt hash). Только для пользователей `role=admin`.
- На MVP — без recovery, без 2FA. Пароль ставится через CLI (`bun run cli set-admin-password`).
- POST `/api/v1/auth/admin-login { email, password }` → cookie.

### DoD
- [ ] Админ заходит локально, попадает в `/admin/...`.

## DoD Фазы 8

- [ ] Crossmark может через API получать всё, что ему нужно для UI у себя.
- [ ] Админ Z может разруливать инциденты без хождения в БД.

---

# Фаза 9 — Observability, security hardening, billing, quality gate

**Цель фазы:** прод-готовность: Prometheus-дашборды, алерты, ai-cost-watch, security-обзор, перформанс-тесты, документация.

## 9.1 Prometheus dashboards & alerts

### Файлы
- `infra/grafana/dashboards/z-business.json`
- `infra/grafana/dashboards/z-ai-pipeline.json`
- `infra/grafana/dashboards/z-livekit.json`
- `infra/grafana/alerts/*.yml`

### Что делаем
1. **Дашборд business**: `meetings_created_total`, `meetings_finished_total`, `meetings_failed_total{stage=}`, average pipeline duration, success rate.
2. **Дашборд AI**: `ai_pipeline_duration_seconds{stage=,type=,model=}`, `ai_cost_usd_total` rate(), top-N most expensive meetings, fallback events.
3. **Дашборд LiveKit**: уже базово в Фазе 0; добавить `livekit_webhook_events_total{type=}`.
4. **Алерты**:
   - `meetings_failed_total / meetings_finished_total > 0.05` за 30m.
   - `ai_cost_usd_total[24h] > $X`.
   - `recordings_failed > 0` в течение 5m.
   - LiveKit / Egress / Backend / DB / Redis недоступны.
   - BullMQ `failed_jobs > 5` за 10m.

### DoD
- [ ] Дашборды импортированы в Grafana, реальные метрики идут.
- [ ] Тестовый алерт сработал (искусственно деградировать backend).

## 9.2 Backups

### Файлы
- `infra/scripts/backup-postgres.sh`
- `infra/cron/backup-postgres.cron`

### Что делаем
- Раз в сутки `pg_dump` → шифровать → `aws s3 cp` в bucket `db-backups` (Selectel).
- Retention 14 дней (lifecycle на bucket).
- Раз в неделю — тестовый restore на staging.

### DoD
- [ ] Дамп успешно создаётся, лежит в S3, шифр open-able тестовым ключом.

## 9.3 Security hardening

### Что делаем
- Запустить `npm audit` / `bun audit` — ничего критичного.
- Pen-test чек-лист (OWASP top 10):
  - [ ] HMAC: timing-safe сравнение, repeat-window 5 min.
  - [ ] JWT: невозможно подменить алгоритм (`none`).
  - [ ] CSP-заголовки на всех страницах.
  - [ ] Frame-ancestors none — нельзя встраивать в iframe (защита от clickjacking + по бизнес-решению Crossmark не использует iframe).
  - [ ] SQL injection невозможна (Prisma + parameterized).
  - [ ] XSS на guest_name — sanitize.
  - [ ] Custom prompt длина — лимит 10k символов.
  - [ ] Rate limit на public endpoints (Throttler).
  - [ ] Cookie secure flags везде.
- Запустить `/security-review` skill на основные модули (auth, webhooks, integrations-crossmark).

### DoD
- [ ] Все пункты чек-листа выполнены, `/security-review` — без блокирующих находок.

## 9.4 Performance test

### Файлы
- `infra/loadtest/scenario-meeting.js` (k6)

### Что делаем
- k6-сценарий: 50 параллельных встреч по 4 участника, 5 минут каждая.
- Проверить: SFU CPU < 70%, Egress < 80%, BullMQ queue не растёт без остановки, AI-pipeline доводит каждую до `ai_ready`.

### DoD
- [ ] 50 параллельных встреч проходят без ошибок, метрики в норме.

## 9.5 Документация

### Файлы
- `docs/api/openapi.yaml` (генерится из swagger)
- `docs/runbook/incident-meeting-stuck.md`
- `docs/runbook/incident-ai-pipeline-failed.md`
- `docs/runbook/incident-livekit-down.md`
- `docs/runbook/restore-from-backup.md`
- `docs/integrations/crossmark.md`

### Что делаем
- Каждый runbook: симптомы, шаги диагностики, шаги восстановления, escalation.
- Документ интеграции для команды Crossmark — пример HMAC, sample payloads.

### DoD
- [ ] Runbooks существуют, ревью пройдено.

## 9.6 Final smoke test (чек-лист релиза)

- [ ] Crossmark создаёт встречу через API.
- [ ] Хост открывает deep-link, попадает в комнату.
- [ ] Гость с другого браузера заходит, обмениваются речью 5 минут.
- [ ] Хост стартует запись, останавливает, завершает встречу.
- [ ] Через ~3 минуты статус `ai_ready`.
- [ ] Страница результата показывает корректный отчёт по типу.
- [ ] Запись скачивается по presigned-URL.
- [ ] Через 30 дней (имитация) — retention cron удаляет файлы.
- [ ] Crossmark API `GET /meetings/:id/result` возвращает данные.
- [ ] Все алерты Grafana — green.

## DoD Фазы 9

- [ ] Все подфазы Done.
- [ ] Smoke test 9.6 пройден.
- [ ] `second-brain/` обновлён (см. CLAUDE.md «Триггер 1: после git push»).

---

# Сводный план запуска (для понимания критического пути)

```
Фаза 0 (инфра) ──► Фаза 1 (backend каркас) ──► Фаза 2 (Crossmark + auth + meetings)
                                                       │
                              ┌────────────────────────┴────────────────┐
                              ▼                                          ▼
                       Фаза 3 (LiveKit)                          Фаза 6 (FE каркас)
                              │                                          │
                              ▼                                          ▼
                       Фаза 4 (recording)                        Фаза 7 (FE pages)
                              │
                              ▼
                       Фаза 5 (AI pipeline)
                              │
                              ▼
                       Фаза 8 (Crossmark+Admin) ────► Фаза 9 (observability+release)
```

Параллелизация:
- Frontend (Фазы 6-7) можно начать параллельно с Фазой 3, как только Фаза 2 даёт `/access` и `/join`-stub.
- AI pipeline (Фаза 5) можно драфтить параллельно с Фазой 4 на синтетических данных.

# Зависимости между фазами

| Фаза | Зависит от | Блокирует |
|---|---|---|
| 0 | — | 1 |
| 1 | 0 | 2, 3, 4, 5, 6 |
| 2 | 1 | 3, 6, 7 |
| 3 | 2 | 4, 7 |
| 4 | 3 | 5 |
| 5 | 4 | 8, 9 |
| 6 | 1, 2 | 7 |
| 7 | 2, 3, 4, 5, 6 | 9 |
| 8 | 5, 7 | 9 |
| 9 | все | релиз |

# Риски и ограничения проекта

1. **GigaAM Vox задержка/недоступность** — fallback не предусмотрен (нет второго ASR). Митигация: подняли инстанс мониторинга на vox.agent-lia.ru (внешняя инфра), при долгом простое — все встречи зависают в `transcription_processing`. На MVP — приемлемо, т.к. SLA Vox внутренний.
2. **Anthropic 403 из РФ-IP** — митигация уже заложена через fallback на MiniMax/proxy.
3. **Selectel недоступность zone ru-7** — записи не зальются. Митигация: алерт + ручной свитч на Yandex (через ENV).
4. **Egress «потрескивание»** (issue #1133) — митигация: фиксированный тег версии, тесты per-track WER перед апдейтом.
5. **Длинные встречи (>1ч × 10 ч-к)** — Vox+Claude стоят 0.4-0.6$, Token-окно Claude 200k+. На самой длинной (~8ч × 10) — дробить транскрипт на чанки в `analyze.worker` (V1.1, не блокирует MVP).
6. **Frontend в Safari** — LiveKit-React работает, но screen share имеет ограничения. Митигация: feature-detect + сообщение «не поддерживается в этом браузере».
7. **Single-region (только Новосибирск)** — задержка для UTC+3 пользователей ~50ms, приемлемо. Multi-region — V2.

# Итог

**Статус:** MVP реализован целиком (Фазы 0-9 ✅) на дату 2026-05-09.

## Что сделано

| Фаза | Содержимое | Статус |
|------|------------|--------|
| 0 | Инфраструктура (DNS, TLS, LiveKit, Postgres, Redis, S3) | ✅ |
| 1 | Backend каркас, Auth (cookie+HMAC+admin), Prisma-схема, метрики | ✅ |
| 2 | Crossmark API создания встреч, idempotency, FSM встречи | ✅ |
| 3 | LiveKit-токены, /access /join, host controls, raise-hand | ✅ |
| 4 | LiveKit Egress (общая запись + per-track audio), retention cron | ✅ |
| 5 | AI-pipeline (Vox ASR → merger → analyze LLM → notify), 9 типов отчёта, custom prompt, fallback Anthropic→MiniMax→OpenAI-via-proxy | ✅ |
| 6 | Frontend каркас (Next.js + LiveKit React Components, ApiClient, AuthContext) | ✅ |
| 7 | Frontend pages (login, /meetings, /meetings/create, /m/:id, /meetings/:id/result, /admin/*) | ✅ |
| 8 | Crossmark `GET ../result`, Admin (meetings, ai-usage, recordings, integration-keys), audit log, локальный admin-login | ✅ |
| 9 | Observability (3 Grafana-дашборда + 11 алертов + Prometheus scrape), backups (cron + restore + S3 lifecycle), security hardening (CSP/HSTS/throttle), k6 load test, 4 runbook'а + интеграционная документация Crossmark, smoke-test | ✅ |

## Тесты

- **Backend unit:** 159 тестов в 23 файлах.
- **Backend e2e:** 18 тестов в 5 файлах.
- **Backend total:** 177 тестов, все зелёные.
- **Backend typecheck + build:** 0 ошибок.
- **Frontend typecheck + build:** 0 ошибок, 13 страниц собираются.

## Метрики и observability

- `meetings_created_total{type}`, `meetings_finished_total{type}`, `meetings_failed_total{stage}`.
- `ai_pipeline_duration_seconds{stage,type,model}` (histogram), `ai_cost_usd_total`.
- `recordings_bytes_total`, `recordings_deleted_total{reason}`, `recordings_failed_total{reason}` (новая в Фазе 9).
- `crossmark_api_requests_total{endpoint,status}`, `livekit_webhook_events_total{type}`.
- `llm_fallback_total{provider}` (новая в Фазе 9, инкрементируется в `LlmFallbackService`).

## Безопасность

См. `docs/security-checklist.md` — 13 пунктов закрыто. Один отложен на pre-release: `bun audit`.

## Что отложено на V1.1 / V2

Подробно в `docs/known-issues.md`:
- Multi-region и HA LiveKit (V2).
- Полноценный LiveKit-load (Playwright + WebRTC) — V1.1.
- Webhook от Z в Crossmark (вместо polling) — V1.1.
- Чанкование длинных встреч в `analyze.worker` — V1.1.
- PITR/WAL-archiving для Postgres — V1.1.
- WAF (nginx ModSecurity / cloudflare) — V1.1.
- Pen-test внешним подрядчиком — V2.
- Автоматическая ротация JWT/HMAC ключей — V1.1.

## Артефакты Фазы 9

- `backend/src/common/metrics/business-metrics.service.ts` — добавлены `recordings_failed_total`, `llm_fallback_total`.
- `backend/src/modules/ai/services/llm-fallback.service.ts` — инкремент метрики при каждом fallback'е.
- `backend/src/modules/meetings/meetings.controller.ts`, `participants/participants.controller.ts` — `@Throttle({ttl:60_000,limit:30})` на `/access` и `/join`.
- `backend/src/main.ts` — расширен Helmet CSP (media-src, object-src, base-uri, wss://*.crossmark.ru), HSTS, X-Frame-Options DENY.
- `frontend/next.config.js` — полный whitelist CSP, HSTS под isProd.
- `backend/scripts/create-integration-key.ts` — CLI-скрипт.
- `infra/grafana/dashboards/{z-business,z-ai-pipeline,z-livekit}.json`.
- `infra/grafana/alerts/{business-alerts,infra-alerts}.yml`.
- `infra/prometheus/prometheus.yml`.
- `infra/scripts/{backup-postgres.sh,restore-postgres.sh,README.md}` + `infra/cron/backup-postgres.cron`.
- `infra/selectel/lifecycle-policy.json` (retention 14 дней).
- `infra/loadtest/{scenario-meeting.js,README.md}`.
- `infra/smoke/smoke-test.sh`.
- `docs/runbook/{incident-meeting-stuck,incident-ai-pipeline-failed,incident-livekit-down,restore-from-backup}.md`.
- `docs/integrations/crossmark.md`.
- `docs/api/openapi.yaml`.
- `docs/architecture/deployment.md`.
- `docs/dev/onboarding.md`.
- `docs/security-checklist.md`, `docs/known-issues.md`.

**MVP готов к prod-релизу.**

## Ревизия от 2026-05-24

**Статус:** done (база MVP) + superseded (дальнейшее развитие)
**Реализовано:**
- Bootstrap проекта, типизированный конфиг, Prisma-схема — `backend/src/common/config/`, `backend/prisma/schema.prisma` (модели User, Meeting, Participant, Recording, AudioTrack, Transcript, AiResult, AiUsageLog, IntegrationKey, WebhookSeenEvent, CrossmarkIdempotency, MeetingEvent).
- AuthGuard в трёх потоках: cookie (`CookieAuthGuard`), HMAC, admin — `backend/src/modules/auth/`.
- Модули meetings, livekit, recordings, ai (`analyze.worker`, `transcribe.worker`, `merger`, `task-extraction.service`, prompts по 9 типам), webhooks с дедупом — все в `backend/src/modules/`.
- AI-pipeline под 9 типов встреч с custom-prompt: `backend/src/modules/ai/services/prompts/type-*.ts` + `custom-report.worker.ts`.
- Запись + аудио-треки + retention в Recording/AudioTrack + S3.
- Frontend MVP: страница встречи, journal, гостевой вход — `frontend/app/(public)/m/[id]/page.tsx`, `frontend/app/(authenticated)/meetings/*`.
- Метрики и observability: `backend/src/common/metrics/`, Grafana дашборды в `infra/grafana/`.

**Заменён на:** [plans/tz/2026-05-22-final-roadmap.md](2026-05-22-final-roadmap.md) — зонтичный ТЗ Кора v2 (24 sub-ТЗ); MVP-базис здесь сохранён как фундамент для всех последующих фаз α/β/γ/δ. Дальнейшие изменения meetings/recordings/AI обрабатываются через final-roadmap и его sub-ТЗ.
