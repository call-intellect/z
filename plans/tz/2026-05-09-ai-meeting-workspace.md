---
type: tz
status: draft
feature: ai-meeting-workspace
date: 2026-05-09
---

# ТЗ: AI Meeting Workspace — расширенный кабинет и страница результата встречи

> Анализ: [plans/analysis/2026-05-09-ai-meeting-workspace.md](plans/analysis/2026-05-09-ai-meeting-workspace.md)
> **Дизайн-эталон (визуальная идентичность, токены, motion, кастомные паттерны):** [plans/analysis/2026-05-09-ai-meeting-workspace-design.md](plans/analysis/2026-05-09-ai-meeting-workspace-design.md) — обязателен к прочтению перед стартом фронтенд-фаз.
> Базовое ТЗ кабинета: [plans/tz/2026-05-09-standalone-product.md](plans/tz/2026-05-09-standalone-product.md) (этот ТЗ строится поверх)
> Архитектура: [plans/architecture/2026-05-08-z-architecture.md](plans/architecture/2026-05-08-z-architecture.md)

## Цель

Превратить кабинет Z из MVP-стека (журнал-таблица + статичная карточка результата) в полноценное AI-meeting-workspace уровня Otter / Fathom / Fireflies: трёхколоночная страница встречи с smart chapters и табами, AI-чат на одну встречу и cross-meeting, action items как сущность БД с inline-редактированием и отправкой в внешние destinations, highlight-клипы со смартшерингом, публичный шеринг по ссылке с тумблерами и сроком 1/7/14 дней, Public REST API + Personal API keys + Outgoing webhooks subscriptions, массовые действия в журнале с тегами и экспортом ZIP, templates как UX-объект с регенерацией пост-фактум, единый видео-плеер на Vidstack с маркерами на timeline.

## Scope

**Входит:**

- **Design Foundations** — визуальная идентичность (dark-first minimalism + mint accent + Geist typography + glass-cards для AI-цитат), motion-каталог на Framer Motion, кастомизация Vidstack под нашу систему. Все детали — в [design-документе](plans/analysis/2026-05-09-ai-meeting-workspace-design.md).
- Эталонная страница (страница результата встречи) реализуется первой и до production-quality визуала, остальные страницы калибруются по ней.
- Расширение AI-pipeline (новые этапы: smart chapters, structured tasks, embeddings, render-clip-mp4).
- `LlmRouter` поверх существующего `LlmFallbackService` с маршрутизацией по `taskType` через админку.
- `EmbeddingService` с двумя реализациями (OpenAI через прокси / локальный микросервис BGE-M3) и каскадным fallback.
- pgvector в Postgres для cross-meeting search и AI-чата по архиву.
- Сущность `Task` (action items как первоклассный объект): модель, API, UI с inline-редактированием, страница `My Tasks`.
- Сущность `MeetingChapter` (smart chapters): модель, API, UI на странице встречи.
- Сущность `MeetingHighlight` (highlight clips): модель, API, UI создания/просмотра, рендер MP4 по запросу через ffmpeg-воркер.
- Сущность `MeetingShare` (публичный шеринг): модель, генерация токена, публичные роуты `/share/<token>` и `/share/clip/<token>`, диалог шеринга с тумблерами и выбором срока 1/7/14 дней.
- Сущность `Tag` + `MeetingTag`: модель, API, UI создания/применения, фильтр по тегам в журнале.
- Сущности `MeetingChatMessage` и `MeetingTranscriptChunk` для AI-чата.
- Сущности `ApiKey` (user-level) + `WebhookSubscription` + `WebhookDelivery` + `IntegrationDestination` + `Export` + `UserTemplate`.
- Перевод страницы встречи `/meetings/<id>/result` на трёхколоночный layout с табами Overview / Chapters / Transcript / Action Items / Notes + AI-чат справа.
- Видео-плеер на Vidstack с маркерами глав/клипов и связкой с транскриптом.
- Переработка диалога создания встречи в галерею шаблонов с customizable sections.
- Регенерация отчёта с другим шаблоном пост-фактум.
- Главная-дашборд `/` для залогиненного юзера (виджеты «Сегодня», «На неделе», «Открытые задачи», «Статистика»).
- Расширение журнала встреч: чекбоксы, toolbar `Удалить / Теги / Экспорт ZIP`, фильтр по тегам, поиск по содержимому транскрипта.
- Страницы кабинета: `/tasks`, `/settings/tags`, `/settings/integrations`, `/settings/api`, `/settings/webhooks`, `/settings/exports`.
- Public REST API + Swagger UI на `/api/v1/docs`, документация всех публичных эндпоинтов.
- Outgoing webhooks: подписки, HMAC-подпись, retry с exponential backoff, журнал доставок.
- Integration destinations (Email / Slack webhook / Telegram bot / Generic webhook) и UI отправки `Отправить в...`.
- Cross-meeting AI-search и AI-чат по архиву.
- Экспорт MD / PDF / DOCX отдельной встречи и пакетный ZIP.
- Админ-страница `Admin → AI Models` для редактирования маршрутов LLM по типу задачи.

**Не входит (vNext):**

- Live-dashboard во время встречи (метрики WPM/sentiment в real-time, как у Read.ai).
- In-meeting note editor с Granola-стилем (юзер пишет — AI дополняет).
- OAuth-коннекторы Salesforce / HubSpot / Asana / Notion / Slack OAuth — реальные интеграции через OAuth-протокол. Generic webhook + Slack incoming webhook этим ТЗ покрываются.
- Multi-language autodetect (язык встречи фиксирован на уровне типа встречи).
- Manual speaker reassignment в транскрипте.
- Smart trackers (Avoma-стиль кросс-meeting tracking концептов).
- Quality rating секций (палец вверх/вниз для fine-tuning).
- Команды / организации / sharing внутри Z-аккаунтов (только публичный шеринг ссылкой).
- Биллинг и тарифы.
- Платная regenerate-задача (все юзеры могут регенерировать неограниченно в V1).

## Технические изменения

### Backend

#### Новые модули

**`modules/tasks`** — управление action items.
- `TasksController` (REST + Swagger).
- `TasksService` — создание из AI-pipeline, ручное добавление, обновление статуса/assignee/dueDate, удаление, агрегатные запросы для `My Tasks`.
- `TaskExtractionService` (вызывается из ai-pipeline) — структурированное извлечение задач через `LlmRouter` с `taskType=tasks`.

**`modules/chapters`** — smart chapters.
- `ChaptersController` (REST + Swagger).
- `ChaptersService` — CRUD, агрегация для UI.
- `ChapterExtractionService` (из ai-pipeline) — генерация глав через `LlmRouter` с `taskType=chapters`.

**`modules/highlights`** — клипы.
- `HighlightsController`.
- `HighlightsService` — CRUD клипов.
- `ClipRenderService` — постановка задачи в очередь `clip-render` (BullMQ).
- `ClipRenderWorker` — воркер ffmpeg, забирает оригинал из S3, режет, кладёт в S3, обновляет `renderStatus` и `renderedMp4Key`.

**`modules/shares`** — публичный шеринг.
- `SharesController` — авторизованный API для хоста (создать/список/отозвать).
- `PublicShareController` — публичный API без авторизации, отдаёт встречу/клип по токену.
- `SharesService` — генерация токенов, проверка expiresAt и revokedAt, инкремент viewCount.

**`modules/chat`** — AI-чат.
- `ChatController` — `POST /api/v1/meetings/:id/chat`, `POST /api/v1/chat`.
- `ChatService` — Фаза А (single-meeting context-stuffing), Фаза Б (cross-meeting RAG over pgvector).
- `ChatHistoryService` — CRUD `MeetingChatMessage`.

**`modules/embeddings`** — embedding-инфраструктура.
- `OpenAiProxyEmbeddingService` — поверх `proxy.agent-lia.ru/v1/embeddings`.
- `LocalEmbeddingService` — поверх `EMBEDDING_FALLBACK_LOCAL_URL` (опциональный).
- `EmbeddingFallbackService` — каскад по аналогии с `LlmFallbackService`.
- `TranscriptIndexerService` (из ai-pipeline) — chunk-splitting + batching + запись в `MeetingTranscriptChunk`.

**`modules/llm-router`** — расширение существующего AI-модуля.
- `LlmRouter` — обёртка над `LlmFallbackService` с маршрутизацией по `taskType` через `LlmTaskRoute`.
- Сервис маршрутов хранится в БД, кэшируется в памяти с TTL 60 секунд (для админских изменений без рестарта).

**`modules/api-keys`** — personal API keys.
- `ApiKeysController` — `GET / POST / DELETE /api/v1/api-keys`.
- `ApiKeysService` — генерация (32-символьный токен `z_<base64url>`), хеш SHA-256 в БД, scopes-проверка.
- `ApiKeyAuthGuard` — guard для публичных эндпоинтов; принимает `Authorization: Bearer <key>`, ищет в `ApiKey`, обновляет `lastUsedAt`, проставляет `req.user`.

**`modules/webhooks`** — outgoing webhooks subscriptions.
- `WebhookSubscriptionsController` — CRUD подписок.
- `WebhookDeliveriesController` — `GET /api/v1/webhook-deliveries` (журнал), `POST /api/v1/webhook-deliveries/:id/retry`.
- `WebhookDispatcherService` — постановка delivery в очередь `webhook-deliver`.
- `WebhookDeliverWorker` — выполнение POST с HMAC-подписью, retry с backoff (30 сек / 5 мин / 1 час), пометка `delivered` или `failed`. **SSRF-защита (см. раздел «Безопасность» ниже): резолвим URL через DNS, отказываем на private CIDR, требуем HTTPS в проде, max-redirects=0, отдельный egress-network.**
- `WebhookEventBus` — внутренний bus, в который публикуются доменные события (`meeting.completed`, `task.created`, и т.д.). Подписан на NestJS events (`@OnEvent`).
- **HTTP-заголовки запроса (фиксированный контракт):**
  - `Content-Type: application/json`
  - `X-Z-Event-Id: <ulid>` — стабильный для всех retry одного события (для дедупа на стороне получателя).
  - `X-Z-Delivery-Id: <ulid>` — уникальный на каждую попытку доставки.
  - `X-Z-Event: <event_name>` — например `meeting.completed`.
  - `X-Z-Timestamp: <unix>` — момент формирования payload.
  - `X-Z-Signature: t=<unix>,v1=<hmac_sha256>` — подпись тела по схеме Stripe (защищает от replay в течение 5 минут).
- **`WebhookRetentionWorker`** (cron, раз в час) — удаляет `WebhookDelivery` старше 30 дней.

**`modules/destinations`** — интеграции отправки.
- `DestinationsController` — CRUD destinations.
- `DestinationsService`.
- `DeliveryService` — единая точка `send(destinationId, payload, template)`. Внутри — диспатч по типу:
  - `EmailSender` (SMTP, поверх существующего `MailService` из standalone-product).
  - `SlackWebhookSender` (HTTP POST с markdown-блоками).
  - `TelegramBotSender` (Bot API).
  - `GenericWebhookSender` (HTTP POST JSON).
- Шаблоны сообщений в `templates/destinations/<type>.<scenario>.hbs` (или TS-литералы).

**`modules/tags`** — теги.
- `TagsController` — CRUD тегов.
- `MeetingTagsController` — навешивание/снятие тегов на встречу (одну и массово).
- `TagsService`.

**`modules/exports`** — экспорт ZIP и отдельных встреч.
- `ExportsController` — `POST /api/v1/exports/meeting/:id` (одна встреча MD/PDF/DOCX), `POST /api/v1/exports/bulk` (ZIP), `GET /api/v1/exports`, `GET /api/v1/exports/:id/download`.
- `ExportsService` — постановка в очередь. Idempotency: проверяем, что у юзера нет одновременно более одного `Export.status IN (queued, processing)` (max 1 conc). При попытке создать второй — 409 Conflict.
- `ExportZipWorker` — генерация ZIP в S3 через **multipart upload** (S3 single-PUT лимит 5GB, мы не вписываемся). Размер ZIP лимитирован `EXPORT_ZIP_MAX_SIZE_BYTES=20GB` — превышение → 413 Payload Too Large при постановке.
- `ExportDocWorker` — генерация одиночного документа (MD / PDF через `puppeteer`-render markdown / DOCX через `docx` библиотеку).
- **`ExportRetentionWorker`** (cron, раз в час) — сканирует `Export.expiresAt < now`, удаляет S3-объект, ставит `status=expired`.

**`modules/templates`** — пользовательские шаблоны.
- `UserTemplatesController` — CRUD сохранённых юзером шаблонов.
- `TemplateRegistryService` — единая точка получения шаблона по типу или `userTemplateId` (default-шаблоны 9 типов из кода + custom юзера + `custom_prompt` ad-hoc).

**`modules/dashboard`** — агрегаты для главной.
- `DashboardController` — `GET /api/v1/dashboard` (виджеты).
- `DashboardService` — агрегатные запросы.

#### Новые эндпоинты (внутренний API)

Все ниже — под `CookieAuthGuard` (внутренний фронт-API, путь `/api/v1/*`):

**Meetings (расширение существующего):**
- `GET /api/v1/meetings` — добавить query-параметры `tags[]`, `q` (поиск по транскрипту, см. Фаза 2.5), `sortBy` (createdAt / duration / type).
- `POST /api/v1/meetings/bulk/delete` `{ ids: string[] }` — **`@ArrayMaxSize(100)` на `ids`, `@ArrayMinSize(1)`**. Каждое удаление — soft-delete (`Meeting.deletedAt = now`); hard-delete через 30 дней фоновым `meeting-hard-delete-worker`. Owner-проверка: все ID должны принадлежать вызывающему юзеру (фильтр `userId = req.user.id` в WHERE), иначе 403.
- `POST /api/v1/meetings/bulk/tag` `{ ids: string[], addTagIds: string[], removeTagIds: string[] }` — **`@ArrayMaxSize(100)` на `ids`**. Owner-проверка тегов и встреч.
- `POST /api/v1/meetings/bulk/export` `{ ids: string[], options: { includeTranscript: boolean, includeAudioTracks: boolean, includeVideo: boolean } }` — **`@ArrayMaxSize(100)` на `ids`**. Owner-проверка. Лимит размера итогового ZIP = `EXPORT_ZIP_MAX_SIZE_BYTES`; при превышении превышении возвращаем 413 ещё до постановки в очередь (сумма фактических размеров медиа по выбранным встречам).
- `POST /api/v1/meetings/:id/regenerate` `{ templateType?: MeetingType, userTemplateId?: string, customPrompt?: string, sectionsConfig?: string[], expectedRecapVersion: number }` — постановка пайплайна на повторный analyze. **Optimistic lock**: если `Meeting.recapVersion != expectedRecapVersion` — 409 Conflict (другой клиент уже регенерировал). Idempotency: если `Meeting.status='ai_processing'` — 409. **Стратегия пере-генерации:** AI-результат и Chapters пере-создаются полностью; ручные правки Chapter-title теряются с warning в UI; Tasks с `createdManually=true` сохраняются, авто-извлечённые Tasks замещаются новыми; Highlights не трогаются (это юзерский контент); Embeddings не пересчитываются (текст транскрипта не менялся); `Meeting.recapVersion` инкрементируется атомарно при сохранении.

**Tasks:**
- `GET /api/v1/tasks` (фильтры: status, assignee, dueDateFrom, dueDateTo, q, meetingId).
- `POST /api/v1/meetings/:id/tasks` (ручное создание).
- `PATCH /api/v1/tasks/:id`.
- `DELETE /api/v1/tasks/:id`.
- `POST /api/v1/tasks/:id/send` `{ destinationIds: string[] }`.

**Chapters:**
- `GET /api/v1/meetings/:id/chapters`.
- `PATCH /api/v1/chapters/:id` (редактирование title/summary хостом).
- `POST /api/v1/meetings/:id/chapters/regenerate`.

**Highlights:**
- `GET /api/v1/meetings/:id/highlights`.
- `POST /api/v1/meetings/:id/highlights` `{ startMs, endMs, title, description? }` — **business-rule валидация:** `0 <= startMs < endMs <= meeting.durationMs` и `endMs - startMs <= CLIP_MAX_DURATION_SECONDS * 1000`. Нарушение — 400 с понятным сообщением. `title` — `@MaxLength(200)`, `description` — `@MaxLength(2000)`.
- `PATCH /api/v1/highlights/:id` — те же инварианты при изменении `startMs/endMs`. **Если `renderStatus IN (queued, processing, ready)` и меняем границы — сбрасываем `renderedMp4Key = null, renderStatus = none`** (старый MP4 устарел) и удаляем S3-объект через `clip-render-cleanup`.
- `DELETE /api/v1/highlights/:id` — каскадно удаляет S3-объект `renderedMp4Key` и все `HighlightShare`.
- `POST /api/v1/highlights/:id/render-mp4` — **idempotency**: если `renderStatus IN (queued, processing)` → 409 Conflict («рендер уже идёт»). Если `ready` → возвращаем существующий ключ. Юзерский лимит: `MAX_RENDER_JOBS_PER_HOUR` (см. раздел «Безопасность»).
- `GET /api/v1/highlights/:id/download` (если `renderStatus=ready` — presigned URL с TTL 1 час).

**Shares:**
- `GET /api/v1/meetings/:id/shares`.
- `POST /api/v1/meetings/:id/shares` `{ allowVideo, allowTranscript, allowTasks, allowChapters, expirationDays: 1|7|14 }`.
- `POST /api/v1/shares/:id/extend` `{ extraDays: 1|7|14 }`.
- `DELETE /api/v1/shares/:id` (отзыв).
- `POST /api/v1/highlights/:id/shares` (отдельный шеринг клипа).

**Chat:**
- `POST /api/v1/meetings/:id/chat` `{ message, history? }`.
- `GET /api/v1/meetings/:id/chat/messages`.
- `POST /api/v1/chat` `{ message, history?, scope: 'all' | { meetingIds: string[] } }`.
- `GET /api/v1/chat/messages` (cross-meeting история).

**Tags:**
- `GET / POST /api/v1/tags`.
- `PATCH / DELETE /api/v1/tags/:id`.

**API keys:**
- `GET /api/v1/api-keys`.
- `POST /api/v1/api-keys` (возвращает токен один раз).
- `DELETE /api/v1/api-keys/:id`.

**Webhooks:**
- `GET / POST /api/v1/webhook-subscriptions`.
- `PATCH /api/v1/webhook-subscriptions/:id` (URL, events, status).
- `DELETE /api/v1/webhook-subscriptions/:id`.
- `GET /api/v1/webhook-deliveries` (фильтр по subscriptionId, статусу).
- `POST /api/v1/webhook-deliveries/:id/retry`.

**Destinations:**
- `GET / POST /api/v1/destinations`.
- `PATCH / DELETE /api/v1/destinations/:id`.
- `POST /api/v1/destinations/:id/test`.

**Exports:**
- `POST /api/v1/exports/meeting/:id` `{ format: 'md'|'pdf'|'docx' }`.
- `POST /api/v1/exports/bulk` `{ meetingIds: string[], options: {...} }`.
- `GET /api/v1/exports`.
- `GET /api/v1/exports/:id/download`.

**User templates:**
- `GET / POST /api/v1/user-templates`.
- `PATCH / DELETE /api/v1/user-templates/:id`.

**Dashboard:**
- `GET /api/v1/dashboard` — виджеты для главной.

#### Публичный API (отдельный guard)

Все эндпоинты ниже — под `ApiKeyAuthGuard`, путь `/api/public/v1/*`:

- `GET /api/public/v1/meetings`.
- `GET /api/public/v1/meetings/:id`.
- `GET /api/public/v1/meetings/:id/transcript`.
- `GET /api/public/v1/meetings/:id/chapters`.
- `GET /api/public/v1/meetings/:id/tasks`.
- `GET /api/public/v1/meetings/:id/highlights`.
- `POST /api/public/v1/meetings` (write scope).
- `DELETE /api/public/v1/meetings/:id` (write scope).
- `GET /api/public/v1/tasks`.
- `PATCH /api/public/v1/tasks/:id` (write scope).
- `POST /api/public/v1/meetings/:id/chat`.
- `POST /api/public/v1/chat`.
- `GET /api/public/v1/me`.

Документация — Swagger UI на `/api/public/v1/docs`. Внутренний API оставляем под `/api/v1/docs`.

#### Публичные роуты без авторизации (только токен в URL)

- `GET /api/public/share/:token` — мета шеринга (что разрешено) + ссылки на дочерние ресурсы.
- `GET /api/public/share/:token/transcript` (только если `allowTranscript`).
- `GET /api/public/share/:token/chapters` (только если `allowChapters`).
- `GET /api/public/share/:token/tasks` (только если `allowTasks`).
- `GET /api/public/share/:token/video` (только если `allowVideo`, presigned URL с коротким TTL).
- `GET /api/public/share/clip/:token` — публичный клип.

При `expiresAt < now` или `revokedAt is not null` — статус 410 Gone, фронт показывает лендинг.

#### Изменения в существующих

- `MeetingsService.findAll` — добавить фильтры `tags`, `q` (поиск по транскрипту через pgvector + ilike по title), `sortBy`.
- `MeetingsService.delete` — добавить cleanup всех связанных embeddings, chapters, highlights, shares, tasks (cascade в schema, но логирование).
- `AiPipelineOrchestrator` — новые этапы `generateChapters`, `extractTasksStructured`, `buildEmbeddings` после успешной генерации отчёта. Параллелизуемы.
- `AnalyzeWorker` — заменить плоский tasks-array из output AI на вызов `TaskExtractionService` со структурированным схемой Zod.
- `LlmFallbackService` — без изменений в ядре, но используется через `LlmRouter`. Каскад внутри `LlmTaskRoute` определяет порядок провайдеров для каждой задачи.
- `AiUsageLog` — добавить поле `taskType String`. Существующие записи переносятся со значением `legacy`.
- `CookieAuthGuard` — без изменений.
- `MailService` — переиспользуется для destinations типа `email`.

### База данных

Все изменения через `bunx prisma db push`. Никаких migrate.

#### Новые модели

**`Task`** — структурированный action item.
```prisma
model Task {
  id                String       @id @default(cuid())
  meetingId         String
  meeting           Meeting      @relation(fields: [meetingId], references: [id], onDelete: Cascade)
  userId            String
  user              User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  title             String
  description       String?      @db.Text
  status            TaskStatus   @default(open)
  assigneeRaw       String?      // строка из транскрипта (имя спикера или явное "Иван")
  assigneeUserId    String?      // в V2 — связь с User (когда поддержим распознавание участников)
  dueDate           DateTime?
  sourceStartMs     Int?
  sourceEndMs       Int?
  sourceQuote       String?      @db.Text
  confidence        Float?
  createdManually   Boolean      @default(false)
  createdAt         DateTime     @default(now())
  updatedAt         DateTime     @updatedAt
  @@index([userId, status])
  @@index([meetingId])
  @@index([dueDate])
}

enum TaskStatus { open in_progress done cancelled }
```

**`MeetingChapter`** — smart chapter.
```prisma
model MeetingChapter {
  id          String     @id @default(cuid())
  meetingId   String
  meeting     Meeting    @relation(fields: [meetingId], references: [id], onDelete: Cascade)
  startMs     Int
  endMs       Int
  title       String
  summary     String?    @db.Text
  order       Int
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt
  @@index([meetingId, order])
}
```

**`MeetingHighlight`** — клип.
```prisma
model MeetingHighlight {
  id              String         @id @default(cuid())
  meetingId       String
  meeting         Meeting        @relation(fields: [meetingId], references: [id], onDelete: Cascade)
  createdById     String
  createdBy       User           @relation(fields: [createdById], references: [id], onDelete: Cascade)
  startMs         Int
  endMs           Int
  title           String
  description     String?
  renderedMp4Key  String?        // S3 key
  renderStatus    RenderStatus   @default(none)
  renderError     String?        @db.Text
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt
  @@index([meetingId])
}

enum RenderStatus { none queued processing ready failed }
```

**`MeetingShare`** — публичная ссылка на встречу.
```prisma
model MeetingShare {
  id                  String              @id @default(cuid())
  token               String              @unique
  meetingId           String
  meeting             Meeting             @relation(fields: [meetingId], references: [id], onDelete: Cascade)
  createdById         String
  createdBy           User                @relation(fields: [createdById], references: [id], onDelete: Cascade)
  allowVideo          Boolean             @default(false)
  allowTranscript     Boolean             @default(false)
  allowTasks          Boolean             @default(true)
  allowChapters       Boolean             @default(true)
  expiresAt           DateTime
  revokedAt           DateTime?
  viewCount           Int                 @default(0)
  lastViewedAt        DateTime?
  createdAt           DateTime            @default(now())
  views               MeetingShareView[]
  @@index([meetingId])
  @@index([expiresAt])
}

model MeetingShareView {
  id            String         @id @default(cuid())
  shareId       String
  share         MeetingShare   @relation(fields: [shareId], references: [id], onDelete: Cascade)
  ipHash        String         // sha256(ip + DAILY_SALT) — для подсчёта уникалей без хранения IP
  userAgent     String?        @db.Text
  referrer      String?
  viewedAt      DateTime       @default(now())
  @@index([shareId, viewedAt])
}
```

Уникальные просмотры в `viewCount` инкрементируются раз в сутки на одного `ipHash` (anti-cheat); каждое открытие пишется в `MeetingShareView` для admin-аналитики и расследования утечек ссылки. Retention `MeetingShareView` — 90 дней.

**`HighlightShare`** — публичная ссылка на клип.
```prisma
model HighlightShare {
  id              String              @id @default(cuid())
  token           String              @unique
  highlightId     String
  highlight       MeetingHighlight    @relation(fields: [highlightId], references: [id], onDelete: Cascade)
  createdById     String
  createdBy       User                @relation(fields: [createdById], references: [id], onDelete: Cascade)
  expiresAt       DateTime
  revokedAt       DateTime?
  viewCount       Int                 @default(0)
  lastViewedAt    DateTime?
  createdAt       DateTime            @default(now())
  @@index([highlightId])
}
```

**`Tag`** + **`MeetingTag`**.
```prisma
model Tag {
  id        String       @id @default(cuid())
  userId    String
  user      User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  name      String
  color     String       @default("#888888")
  createdAt DateTime     @default(now())
  meetings  MeetingTag[]
  @@unique([userId, name])
  @@index([userId])
}

model MeetingTag {
  meetingId String
  meeting   Meeting   @relation(fields: [meetingId], references: [id], onDelete: Cascade)
  tagId     String
  tag       Tag       @relation(fields: [tagId], references: [id], onDelete: Cascade)
  @@id([meetingId, tagId])
}
```

**`MeetingChatMessage`**.
```prisma
model MeetingChatMessage {
  id          String         @id @default(cuid())
  meetingId   String?        // null для cross-meeting чатов
  meeting     Meeting?       @relation(fields: [meetingId], references: [id], onDelete: Cascade)
  userId      String
  user        User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  role        ChatRole
  content     String         @db.Text
  citations   Json?          // {meetingId, startMs, endMs, snippet}[] для assistant
  tokensIn    Int?
  tokensOut   Int?
  modelUsed   String?
  createdAt   DateTime       @default(now())
  @@index([userId, createdAt])
  @@index([meetingId, createdAt])
}

enum ChatRole { user assistant }
```

**`MeetingTranscriptChunk`** — для cross-meeting RAG.
```prisma
model MeetingTranscriptChunk {
  id          String                          @id @default(cuid())
  meetingId   String
  meeting     Meeting                         @relation(fields: [meetingId], references: [id], onDelete: Cascade)
  userId      String                          // денормализация для filter-по-юзеру в RAG-запросе
  startMs     Int
  endMs       Int
  text        String                          @db.Text
  embedding   Unsupported("vector(1536)")?    // text-embedding-3-small
  createdAt   DateTime                        @default(now())
  @@unique([meetingId, startMs, endMs])       // защита от дублей при reindex
  @@index([meetingId])
  @@index([userId])
}
```

`TranscriptIndexerWorker` использует `delete-then-insert` в транзакции по `meetingId` при перерасчёте, чтобы не плодить дубли.

После создания таблицы — `CREATE INDEX meeting_transcript_chunk_embedding_hnsw ON "MeetingTranscriptChunk" USING hnsw (embedding vector_cosine_ops);` (раздельный SQL после `db push`, в init-скрипте).

**`ApiKey`** — personal API keys (user-level).
```prisma
model ApiKey {
  id            String        @id @default(cuid())
  userId        String
  user          User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  name          String
  hashedKey     String        @unique           // SHA-256 от полного ключа
  prefix        String                          // первые 8 символов после `z_` для отображения
  scopes        ApiKeyScope[]
  lastUsedAt    DateTime?
  revokedAt     DateTime?
  createdAt     DateTime      @default(now())
  @@index([userId])
}

enum ApiKeyScope { read write }   // admin-scope не используется на user-уровне, удалён по итогам ревью
```

**`WebhookSubscription`** + **`WebhookDelivery`**.
```prisma
model WebhookSubscription {
  id                  String              @id @default(cuid())
  userId              String
  user                User                @relation(fields: [userId], references: [id], onDelete: Cascade)
  url                 String
  secretEncrypted     String              // envelope encryption через WEBHOOK_SECRETS_ENCRYPTION_KEY (256-bit AES-GCM); plaintext секрет показывается юзеру 1 раз при создании, потом только prefix для отображения
  secretPrefix        String              // первые 4 символа открытым текстом для UI («wsk_abcd...»)
  events              String[]            // валидируется против enum-whitelist в DTO
  status              WebhookStatus       @default(active)
  lastDeliveryAt      DateTime?
  createdAt           DateTime            @default(now())
  updatedAt           DateTime            @updatedAt
  deliveries          WebhookDelivery[]
  @@index([userId])
}

model WebhookDelivery {
  id              String                 @id @default(cuid())
  subscriptionId  String
  subscription    WebhookSubscription    @relation(fields: [subscriptionId], references: [id], onDelete: Cascade)
  event           String
  payload         Json
  attempts        Int                    @default(0)
  lastStatus      Int?
  lastResponse    String?                @db.Text
  status          DeliveryStatus         @default(pending)
  nextAttemptAt   DateTime?
  deliveredAt     DateTime?
  createdAt       DateTime               @default(now())
  @@index([subscriptionId, createdAt])
  @@index([nextAttemptAt])
}

enum WebhookStatus { active paused failing }
enum DeliveryStatus { pending retrying delivered failed }
```

**`IntegrationDestination`**.
```prisma
model IntegrationDestination {
  id          String                @id @default(cuid())
  userId      String
  user        User                  @relation(fields: [userId], references: [id], onDelete: Cascade)
  type        DestinationType
  name        String
  config      Json                  // схема зависит от type, валидируется DTO
  createdAt   DateTime              @default(now())
  updatedAt   DateTime              @updatedAt
  @@index([userId])
}

enum DestinationType { email slack_webhook telegram_bot generic_webhook }
```

**`Export`**.
```prisma
model Export {
  id              String           @id @default(cuid())
  userId          String
  user            User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  type            ExportType
  meetingIds      String[]
  options         Json
  s3Key           String?
  status          ExportStatus     @default(queued)
  error           String?          @db.Text
  expiresAt       DateTime?
  createdAt       DateTime         @default(now())
  completedAt     DateTime?
  @@index([userId, createdAt])
}

enum ExportType { meeting_md meeting_pdf meeting_docx bulk_zip }
enum ExportStatus { queued processing ready failed expired }
```

**`UserTemplate`** — сохранённые юзером шаблоны.
```prisma
model UserTemplate {
  id              String        @id @default(cuid())
  userId          String
  user            User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  name            String
  basedOnType     MeetingType?
  prompt          String?       @db.Text
  sectionsConfig  String[]
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt
  @@index([userId])
}
```

**`LlmTaskRoute`** — таблица маршрутизации LLM по задачам.
```prisma
model LlmTaskRoute {
  id          String     @id @default(cuid())
  taskType    String     @unique             // chat | summary | chapters | tasks | regenerate-section | custom-prompt | follow-up | clip-title
  providers   Json                           // [{provider: 'anthropic', model: 'claude-sonnet-4-6'}, {provider: 'openai-via-proxy', model: 'gpt-5'}] — валидируется class-validator-ом в админ-DTO перед записью
  isActive    Boolean    @default(true)
  updatedAt   DateTime   @updatedAt
}
```

**`AuditLog`** — критические действия для расследований (см. секцию «Безопасность»).
```prisma
model AuditLog {
  id          String   @id @default(cuid())
  userId      String?
  user        User?    @relation(fields: [userId], references: [id], onDelete: SetNull)
  action      String   // user.delete | share.create | api_key.create | webhook_subscription.create | destination.create | meeting.delete | meeting.regenerate | quota.exceeded
  resourceId  String?
  metadata    Json?
  ipHash      String?
  userAgent   String?  @db.Text
  createdAt   DateTime @default(now())
  @@index([userId, createdAt])
  @@index([action, createdAt])
}
```

**`ApiAccessLog`** — лог обращений к Public API (для analytics и расследований abuse).
```prisma
model ApiAccessLog {
  id          String    @id @default(cuid())
  apiKeyId    String?
  apiKey      ApiKey?   @relation(fields: [apiKeyId], references: [id], onDelete: SetNull)
  userId      String?
  route       String    // GET /api/public/v1/meetings
  status      Int
  durationMs  Int?
  ipHash      String?
  createdAt   DateTime  @default(now())
  @@index([apiKeyId, createdAt])
  @@index([userId, createdAt])
  @@index([status, createdAt])
}
```

Retention `ApiAccessLog` — 30 дней.

**`UserQuotaCounter`** — счётчики квот в БД (бэкап Redis-storage; Redis — горячий, БД — для анализа в админке).
```prisma
model UserQuotaCounter {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  quotaName   String   // chat_requests_per_day | render_jobs_per_hour | ...
  windowStart DateTime
  count       Int      @default(0)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@unique([userId, quotaName, windowStart])
  @@index([userId, quotaName])
}
```

#### Изменения в существующих

- **`User`** — добавить relations: `apiKeys`, `webhookSubscriptions`, `destinations`, `tags`, `tasks`, `chatMessages`, `userTemplates`, `exports`, `meetingShares`, `highlightShares`, `meetingHighlights`. **Добавить `deletedAt DateTime?` (soft-delete)** + индекс `@@index([deletedAt])`. Все запросы через `MeetingsService` / `TasksService` / etc. получают вrapper-фильтр `where: { deletedAt: null }` по дефолту. Hard-delete (с каскадным удалением всего) — отдельная фоновая задача `user-hard-delete-worker`, запускается через 30 дней после `deletedAt`. До этого юзер может восстановить аккаунт по ссылке в email-уведомлении.
- **`Meeting`** — добавить relations: `tasks`, `chapters`, `highlights`, `shares`, `transcriptChunks`, `chatMessages`, `meetingTags`. Новые поля:
  - `recapVersion Int @default(1)` — инкрементируется при regenerate (для optimistic-lock и кэш-инвалидации фронта).
  - `chaptersStatus AiStepStatus @default(none)`, `tasksStatus AiStepStatus @default(none)`, `embeddingsStatus AiStepStatus @default(none)` — гранулярные статусы новых этапов AI-pipeline. Enum `AiStepStatus { none queued processing ready failed }`.
  - `deletedAt DateTime?` — soft-delete; `meeting-hard-delete-worker` физически удаляет через 30 дней.
  - `durationMs Int?` — длительность в миллисекундах (для time-validation на highlights). Заполняется на этапе `recordingReady`.
  - Индекс `@@index([deletedAt])`.
- **`AiResult`** — больше не несёт плоский `tasks String[]`; поле помечается `@deprecated`, читается только до миграции данных. Новые задачи пишутся в `Task`. После выкатки фазы 3 в проде — миграционный скрипт из `AiResult.tasks[]` в `Task` (см. `backend/scripts/migrate-ai-tasks.ts`).
- **`AiUsageLog`** — добавить `taskType String?`, индекс `@@index([userId, taskType, createdAt])`.

#### Расширения PostgreSQL

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Запуск через init-скрипт `backend/scripts/postgres-init.sql`. На Yandex Cloud Managed PostgreSQL — поддерживается без доп. настроек.

### Frontend

#### Новые страницы (App Router, Next.js)

- `app/(authenticated)/page.tsx` — главная-дашборд (заменяет редирект на `/meetings`).
- `app/(authenticated)/tasks/page.tsx` — My Tasks.
- `app/(authenticated)/settings/tags/page.tsx`.
- `app/(authenticated)/settings/integrations/page.tsx`.
- `app/(authenticated)/settings/api/page.tsx`.
- `app/(authenticated)/settings/webhooks/page.tsx`.
- `app/(authenticated)/settings/exports/page.tsx`.
- `app/(authenticated)/admin/ai-models/page.tsx` (под `AdminRouteGuard`).
- `app/(public-share)/share/[token]/page.tsx` — публичная страница встречи без AppShell.
- `app/(public-share)/share/clip/[token]/page.tsx` — публичная страница клипа.

#### Перепиcываемые страницы

- `app/(authenticated)/meetings/[id]/result/page.tsx` — полная переработка (3-колоночный layout, табы, AI-чат справа).
- `app/(authenticated)/meetings/page.tsx` — добавить чекбоксы, toolbar, фильтр по тегам, поиск по содержимому. Master-detail из standalone-product сохраняется.
- `app/(authenticated)/meetings/create/page.tsx` — переход на галерею шаблонов с описаниями и customizable sections.

#### Новые компоненты

**`ui/components/meeting-result-v2/*`** (полная замена `meeting-result/*`):
- `ThreeColumnLayout.tsx` — wrapper.
- `LeftColumn/TocPanel.tsx`, `LeftColumn/ChaptersNav.tsx`, `LeftColumn/ParticipantsList.tsx`.
- `CenterColumn/MeetingTabs.tsx` — табы Overview / Chapters / Transcript / Action Items / Notes.
- `CenterColumn/tabs/OverviewTab.tsx` — summary, отчёт, follow-up, кнопки `Скопировать` / `Отправить в...`.
- `CenterColumn/tabs/ChaptersTab.tsx` — DR2-accordion (chapter heading → rolling summary → raw transcript). Звёзды и чекбоксы.
- `CenterColumn/tabs/TranscriptTab.tsx` — двусторонняя синхронизация с плеером.
- `CenterColumn/tabs/ActionItemsTab.tsx` — inline-editable list.
- `CenterColumn/tabs/NotesTab.tsx` — markdown-textarea.
- `RightColumn/AiChatPanel.tsx` — чат поверх встречи.
- `Header/MeetingHeader.tsx` — название (inline-edit), дата, кнопки.
- `Header/ShareDialog.tsx` — диалог шеринга с тумблерами и сроком.
- `Header/RegenerateDialog.tsx` — выбор шаблона для регенерации.
- `Header/SendToDialog.tsx` — отправка в destinations.

**`ui/components/video-player/MeetingVideoPlayer.tsx`** — обёртка Vidstack.
- Пропсы: `src, chapters, clips, currentClipBounds?, onTimeUpdate, onClipCreate?`.
- Маркеры на timeline через `<Markers>`.
- Кнопка `Создать клип из выделения` появляется при выделении интервала.

**`ui/components/dashboard/*`** — виджеты главной.
- `TodayWidget.tsx`, `ThisWeekWidget.tsx`, `OpenTasksWidget.tsx`, `StatsWidget.tsx`.

**`ui/components/tasks/*`**:
- `TasksList.tsx` (для страницы `/tasks`).
- `TaskRow.tsx` — inline-editable строка.
- `TaskFilters.tsx`.
- `AddTaskInline.tsx`.

**`ui/components/tags/*`**:
- `TagsManager.tsx` (страница).
- `TagPicker.tsx` (popover для выбора).
- `TagBadge.tsx`.

**`ui/components/integrations/*`**:
- `DestinationsList.tsx`, `AddDestinationDialog.tsx`, `DestinationCardEmail.tsx`, `DestinationCardSlack.tsx`, `DestinationCardTelegram.tsx`, `DestinationCardWebhook.tsx`.

**`ui/components/api-keys/*`**:
- `ApiKeysList.tsx`, `CreateApiKeyDialog.tsx`, `ApiKeyShownOnceDialog.tsx`.

**`ui/components/webhooks/*`**:
- `SubscriptionsList.tsx`, `EditSubscriptionDialog.tsx`, `DeliveriesJournal.tsx`.

**`ui/components/exports/*`**:
- `ExportsList.tsx`, `ExportProgressBadge.tsx`.

**`ui/components/meetings-list/*`** (расширение):
- `BulkActionsToolbar.tsx`.
- Изменение `MeetingRow.tsx` — добавить чекбокс и теги.
- Изменение `MeetingFiltersBar.tsx` — фильтр по тегам, поиск по содержимому.

**`ui/components/templates/*`**:
- `TemplateGallery.tsx` (используется на странице создания и в Regenerate-диалоге).
- `TemplateCard.tsx`.
- `SectionsCustomizer.tsx`.
- `SaveAsUserTemplateDialog.tsx`.

**`ui/components/share-public/*`** (для публичных страниц):
- `PublicShareLayout.tsx` — лёгкий layout без AppShell, с лого Z и подписью «доступно до DD.MM».
- `ExpiredShareLanding.tsx` — лендинг при истёкшей или отозванной ссылке с CTA на `/signup`.

**`ui/components/admin/AiModelsRoutesEditor.tsx`** — редактор `LlmTaskRoute` в админке.

#### Изменения в существующих

- `frontend/src/api/*` — добавить новые api-клиенты по правилу `frontend-rules` (один файл на сущность, все методы возвращают типизированные DTO).
- `frontend/src/domain/*` — соответствующие domain-модели (`task.ts`, `chapter.ts`, `highlight.ts`, `tag.ts`, ...) с `*FromApi(...)` мапперами.
- `frontend/src/hooks/use-result-polling.ts` — расширить под новые поля результата (chapters, tasks count, highlights count).
- `frontend/src/contexts/auth-context.tsx` — без изменений.
- `frontend/middleware.ts` — добавить публичные маршруты `/share/<token>`, `/share/clip/<token>`.

### Интеграции

- **SMTP** — переиспользуем `MailService` из standalone-product для destination типа `email`.
- **Slack** — incoming webhook (юзер вставляет URL).
- **Telegram** — Bot API (юзер указывает bot token и chat_id).
- **OpenAI Embeddings** — через `proxy.agent-lia.ru/v1/embeddings`. ENV: `OPENAI_API_KEY` (уже есть), `EMBEDDING_PROVIDER=openai|local|cascade`.
- **Локальный embedding-сервис** (опционально) — отдельный микросервис на FastAPI с моделью BGE-M3 или Multilingual-E5. Деплой как отдельный Docker-контейнер. ENV: `EMBEDDING_FALLBACK_LOCAL_URL=http://embeddings.internal:8000`.
- **ffmpeg** — на сервере backend (или в отдельном Docker-образе для воркера). Используется в `ClipRenderWorker` и при экспорте видео в ZIP.
- **puppeteer** или `markdown-pdf` — для PDF-экспорта (бэкенд-зависимость).
- **`docx`** библиотека — для DOCX-экспорта.
- **`@vidstack/react`** — фронтенд-зависимость.
- **`yauzl`** / **`archiver`** — для генерации ZIP.

### Очереди (BullMQ)

Новые очереди:
- `clip-render` — обрабатывается `ClipRenderWorker`.
- `transcript-index` — обрабатывается `TranscriptIndexerWorker` (chunk + embed + сохранение).
- `webhook-deliver` — обрабатывается `WebhookDeliverWorker`.
- `export-zip` — обрабатывается `ExportZipWorker`.
- `export-doc` — обрабатывается `ExportDocWorker`.

Существующие очереди (`transcribe`, `analyze`, `summarize`) расширяются: после `analyze` параллельно ставятся три job'а — `generate-chapters`, `extract-tasks-structured`, `transcript-index`. Они независимы, могут выполняться одновременно. Каждый имеет свой статус (`Meeting.chaptersStatus`, `tasksStatus`, `embeddingsStatus`); UI показывает прогресс гранулярно.

Новые retention-очереди (cron):
- `webhook-retention` — раз в час, удаляет `WebhookDelivery > 30 дней`.
- `export-retention` — раз в час, удаляет S3-объекты для `Export.expiresAt < now`, статус `expired`.
- `share-view-retention` — раз в сутки, удаляет `MeetingShareView > 90 дней`.
- `meeting-hard-delete` — раз в сутки, удаляет `Meeting.deletedAt < now - 30d` (физически + cascade).
- `user-hard-delete` — раз в сутки, удаляет `User.deletedAt < now - 30d` (физически + cascade всех связанных сущностей).

## State transitions (FSM)

Чтобы избежать рассинхронизации статусов и ad-hoc состояний, формализуем переходы.

### Meeting AI-pipeline

`Meeting` хранит четыре независимых статус-поля (вместо одного монолитного):

```
recordingStatus:    none → recording → ready / failed
transcriptStatus:   none → queued → processing → ready / failed
chaptersStatus:     none → queued → processing → ready / failed
tasksStatus:        none → queued → processing → ready / failed
embeddingsStatus:   none → queued → processing → ready / failed
```

`Meeting.aiOverallStatus` — derived (вычисляется не в БД, а в getter'е): `ready` если все 5 ≥ ready (включая «failed как терминальный»); `processing` если хоть один в очереди или processing; `failed` только если transcript или chapters failed (остальные — допустимы failed без блокировки UX).

**Правила переходов:**
- Из `queued`/`processing` → `ready` или `failed` — атомарно при завершении job'а воркером.
- Возврат в `queued` возможен только через явный `POST /regenerate` (с инкрементом `recapVersion`).
- При regenerate: `chaptersStatus = queued`, `tasksStatus = queued` (embeddings не трогаются — текст не менялся).
- При load транскрипта (если был fail и поправили вручную): admin-action в админке, явный API `POST /admin/meetings/:id/restart-pipeline`.

### Highlight render

```
renderStatus: none → queued → processing → ready / failed
```

- `none → queued` через `POST /render-mp4` (только если текущий статус `none` или `failed`; иначе 409).
- `queued → processing` атомарно при подхвате job'ом (через Redis-lock в BullMQ).
- `processing → ready / failed` атомарно при завершении.
- Из `ready` обратно в `queued` — только при изменении `startMs/endMs` (см. PATCH highlight выше: автоматический сброс).
- Из `failed` юзер может повторно вызвать `POST /render-mp4` (allowed transition).

### Webhook delivery

```
DeliveryStatus: pending → retrying → delivered / failed
```

- `pending` — задача в очереди, ещё ни разу не пробовали.
- `retrying` — была неудачная попытка, ждём `nextAttemptAt`.
- `delivered` — терминальный (2xx ответ).
- `failed` — терминальный (4 неудачных попытки, или 4xx-ответ кроме 408/429).
- Восстановление воркера при перезапуске backend: при старте `WebhookDispatcherService` поднимает все `pending`/`retrying` с `nextAttemptAt < now+5min` обратно в очередь BullMQ.

### Export

```
ExportStatus: queued → processing → ready / failed → expired
```

- `expired` — `ready`, у которого `expiresAt` прошёл (cron-воркер делает переход).
- Допустимый флоу: `queued → processing → ready → expired` или `queued → processing → failed`.

### Public share

`expiresAt` — обязательное поле. Состояния (производные):
- `active` — `expiresAt > now AND revokedAt IS NULL`.
- `revoked` — `revokedAt IS NOT NULL`.
- `expired` — `expiresAt <= now AND revokedAt IS NULL`.

Возврат из `revoked` или `expired` в `active` — только через `POST /api/v1/shares/:id/extend` (инкремент `expiresAt += extraDays`, `revokedAt = null`). Внутренняя проверка: `extraDays IN (1, 7, 14)` через DTO whitelist.

## Безопасность, квоты и валидация

### URL-валидация для outgoing webhooks и Generic webhook destination

Любой URL, который мы получаем от юзера и потом сами POST'им — точка SSRF-атаки (атакующий может попросить нас бить по внутренним сервисам). Защита:

1. **Парсинг URL** через `new URL(...)` — отказ на невалидном.
2. **Whitelist протоколов:**
   - В проде — только `https://`.
   - В dev (`NODE_ENV=development`) — `http://` и `https://`.
   - Никогда — `file:`, `javascript:`, `gopher:`, `data:`, `ftp:` и т.д.
3. **DNS resolve** хоста перед запросом. Для всех returned IP проверяем:
   - Запрещены: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`, `169.254.0.0/16` (link-local + AWS metadata), `::1`, `fc00::/7` (IPv6 ULA), `fe80::/10` (IPv6 link-local), `0.0.0.0/8`.
   - Если хоть один IP попадает в blacklist — отказываем (защита от DNS-rebinding).
4. **Hostname blacklist** (на случай non-IP whitelist): `localhost`, `*.local`, `*.internal`, `metadata.google.internal`.
5. **HTTP-клиент настройки:**
   - `maxRedirects: 0` — атакующий может через 302 редирект увести запрос на внутренний хост.
   - `timeout: 10s`.
   - Запрет cookies в запросе (нам не надо).
6. **Egress network isolation** (опция, рекомендуется): Webhook-воркер деплоится в отдельной network namespace без доступа к внутренней сети (только default gateway наружу). Конфиг через Docker Compose / Kubernetes NetworkPolicy.

Реализация — общий хелпер `assertSafeOutboundUrl(url: string)` в `common/http/safe-outbound.ts`. Применяется в:
- `WebhookDeliverWorker` перед POST.
- `GenericWebhookSender` (destinations).
- `SlackWebhookSender` (хотя у Slack URL стабильный, на всякий случай — `hooks.slack.com` whitelist).
- При создании `WebhookSubscription` и `IntegrationDestination` (валидация на запись).

### Шифрование секретов at-rest

`WebhookSubscription.secretEncrypted` хранится как envelope-encrypted blob (AES-256-GCM, ключ из ENV `WEBHOOK_SECRETS_ENCRYPTION_KEY`). Plaintext-секрет показывается юзеру **один раз** при создании подписки (как API key); далее в UI — только `secretPrefix`. При ротации — новый секрет, старые delivery подписаны старым (миграция не требуется, ставим `lastSecretRotatedAt`).

То же самое — для `IntegrationDestination.config` (где есть Telegram bot-token): шифруем поле `config.botToken` перед записью.

### Per-user квоты на дорогие операции

В V1 без тарифов нужны жёсткие лимиты для защиты от случайного abuse:

| ENV | Default | Что лимитирует |
|---|---|---|
| `MAX_API_KEYS_PER_USER` | 50 | Защита от accidental DoS на API-keys таблицу |
| `MAX_WEBHOOK_SUBSCRIPTIONS_PER_USER` | 20 | То же для подписок |
| `MAX_DESTINATIONS_PER_USER` | 30 | Email/Slack/Telegram destinations |
| `MAX_TAGS_PER_USER` | 200 | Теги |
| `MAX_USER_TEMPLATES_PER_USER` | 30 | Сохранённые шаблоны |
| `MAX_CHAT_REQUESTS_PER_DAY` | 200 | Чат-вопросы (single + cross). Защита от LLM-bill abuse |
| `MAX_CHAT_TOKENS_PER_DAY` | 5_000_000 | Альтернативный лимит — по токенам, считается через `AiUsageLog` |
| `MAX_RENDER_JOBS_PER_HOUR` | 30 | Рендеры MP4 (защита ffmpeg-воркера) |
| `MAX_BULK_EXPORTS_PER_DAY` | 5 | Массовые экспорты |
| `MAX_REGENERATE_PER_MEETING_PER_DAY` | 10 | Регенерации одной встречи |
| `MAX_MEETINGS_CREATED_PER_DAY_VIA_API` | 200 | Защита от спам-создания через Public API |
| `MAX_EMBEDDING_TOKENS_PER_MONTH_PER_USER` | 50_000_000 | Embedding-cost cap |

Реализация — `QuotaGuard` с декоратором `@Quota('chat_requests_per_day')`, считает через Redis sorted-set с TTL. Превышение — 429 с заголовком `Retry-After` и понятным телом.

Все квоты конфигурируемы в админке (страница `Admin → Quotas`), изменение применяется без рестарта.

### DTO-валидация (унифицировано на class-validator)

Все Public API и внутренние эндпоинты с пользовательским вводом обязаны иметь DTO с класс-валидаторами. Краткий чек-лист требований:

- **Bulk-endpoints** — `@ArrayMaxSize(100)`, `@ArrayMinSize(1)` на массивы IDs.
- **Все строковые поля** — `@MaxLength(N)` (для title — 200, description/notes — 4000, chat-message — 8000, custom-prompt — 16000, tag-name — 60).
- **`expirationDays`** на share API — `@IsIn([1, 7, 14])`.
- **Webhook events** — `@IsIn([...WEBHOOK_EVENTS_WHITELIST])` на каждом элементе массива.
- **Webhook URL и destination URL** — `@IsUrl({ protocols: ['https'] })` в проде, дополнительно проверка через `assertSafeOutboundUrl`.
- **Highlight `startMs/endMs`** — `@Min(0)`, business-rule check в сервисе.
- **Tag name** — `@Matches(/^[a-zA-Zа-яА-Я0-9 _-]{1,60}$/)`.
- **Email** в destinations — `@IsEmail()`.

Все DTO — в `*.dto.ts` рядом с контроллером, с Swagger-аннотациями (`@ApiProperty({ example: ... })`).

### Public API: дополнительная защита

- Per-key rate limit: `100 req/min` (уже было).
- **Per-user суммарный rate limit** (на сумму всех ключей юзера): `500 req/min`. Защита от обхода через создание множества ключей.
- IP-based fail2ban на 10 неудачных попыток аутентификации за минуту (15 минут блок).
- Логирование всех 4xx/5xx ответов с `apiKeyId, userId, route, status` в `ApiAccessLog` (новая таблица, retention 30 дней).

### Публичные share-страницы

- HTTP-заголовки на `/share/<token>` и `/share/clip/<token>`:
  - `Referrer-Policy: no-referrer` — токен не утекает на внешние домены.
  - `X-Robots-Tag: noindex, nofollow, noarchive` + `<meta>` дублирует.
  - `Cache-Control: private, no-store` — токен не кэшируется на CDN.
  - `Content-Security-Policy` — only self для скриптов и стилей.
- Token format: 32 символа `base64url` (192 бит энтропии — невзламываемо перебором).
- Rate-limit: 60 запросов/минуту на IP по pattern `/api/public/share/*` (защита от scrape).
- При истёкшей или revoked-ссылке — 410 Gone (не 404 — 404 неотличимо от «не существовало никогда», 410 чётко говорит «было, но больше нет»).

### Audit logging

Новая таблица `AuditLog` — для критических действий, которые потенциально нужно расследовать:
```prisma
model AuditLog {
  id          String   @id @default(cuid())
  userId      String?
  action      String   // "user.delete", "share.create", "api_key.create", "webhook_subscription.create", "destination.create", ...
  resourceId  String?
  metadata    Json?
  ipHash      String?
  userAgent   String?  @db.Text
  createdAt   DateTime @default(now())
  @@index([userId, createdAt])
  @@index([action, createdAt])
}
```

Пишется в `AuditLog` через единый `AuditService.log(...)` после успешной мутации. Retention — 365 дней.

### Observability расширения

- **Метрики Prometheus** (новые counters/gauges):
  - `webhook_delivery_total{event, status}` — по всем доставкам.
  - `webhook_delivery_failure_rate` — gauge, обновляется кажд 5 минут.
  - `llm_router_dispatch_total{taskType, provider}` — счётчик маршрутизаций.
  - `llm_fallback_total{from, to}` — fallback-перебросы (уже есть, расширяем меткой `from`).
  - `embedding_tokens_total{provider}` — общее число обработанных токенов.
  - `embedding_cost_estimated_usd` — gauge, обновляется по `AiUsageLog`.
  - `chat_request_total{scope}` — single / cross.
  - `quota_exceeded_total{quota_name}` — сколько раз срабатывало 429.
  - `mp4_render_duration_seconds{status}` — гистограмма.
  - `export_zip_size_bytes` — гистограмма.
- **Алерты** (Grafana, описать в `docs/runbook/alerts.md`):
  - `webhook_delivery_failure_rate > 5%` за 15 минут — INFO для команды.
  - `llm_fallback_total[5m] > 100` — WARN.
  - `quota_exceeded_total{quota_name="chat_requests_per_day"}[1h] > 50` — INFO (потенциальный abuse).
  - `embedding_cost_estimated_usd > X * baseline` — WARN.

## Критерии готовности (DoD)

- [ ] Pgvector extension установлен в Postgres, индекс HNSW на `MeetingTranscriptChunk.embedding`.
- [ ] AI-pipeline после `analyze` запускает три параллельных этапа: chapters, structured tasks, embeddings. Все три состояния трекаются в `Meeting.status` (или новых полях `chaptersStatus`, `tasksStatus`, `embeddingsStatus`).
- [ ] `LlmRouter` маршрутизирует по `taskType`, в админке можно изменить порядок провайдеров и применить без рестарта.
- [ ] `EmbeddingService` работает в default-режиме (через прокси). Локальный fallback включается ENV-флагом и работает.
- [ ] Страница встречи рендерит трёхколоночный layout, все 5 табов работают, AI-чат справа отвечает по контексту встречи.
- [ ] Видео-плеер показывает маркеры глав и клипов, клик по маркеру и по строке транскрипта перематывает плеер, шорткаты работают.
- [ ] Action items создаются автоматически из AI-pipeline, можно редактировать inline (статус, assignee, dueDate), добавить вручную, удалить, отправить в destination.
- [ ] Highlight clip создаётся из выделения, шерится по ссылке с авто-перемоткой, рендер MP4 запускается по запросу и приходит ссылка на скачивание.
- [ ] Публичная ссылка на встречу: тумблеры работают, срок (1/7/14) выбирается, после истечения — лендинг с CTA.
- [ ] Cross-meeting AI-чат: на главной кабинета можно задать вопрос, в ответе цитаты с jump-to-meeting.
- [ ] Журнал: чекбоксы, toolbar `Удалить / Теги / Экспорт ZIP`, фильтр по тегам, поиск по содержимому.
- [ ] My Tasks: страница `/tasks` со всеми задачами юзера, фильтрами, inline-edit.
- [ ] Главная-дашборд: 4 виджета загружаются и кликабельны.
- [ ] Settings → Tags / Integrations / API / Webhooks / Exports — все страницы работают.
- [ ] Public REST API: API-ключ создаётся через UI, Bearer-аутентификация работает, Swagger UI на `/api/public/v1/docs` доступен с примерами.
- [ ] Outgoing webhooks: подписка на события, HMAC-подпись, retry с backoff, журнал доставок видим в кабинете.
- [ ] Integrations destinations: Email/Slack/Telegram/Generic webhook — все работают, тестовая отправка успешна.
- [ ] Templates: галерея на странице создания, кнопка регенерации с другим шаблоном на странице результата, customizable sections, user templates.
- [ ] Все интерактивные элементы — на компонентах shadcn/ui (или адаптерах поверх них).
- [ ] `assertSafeOutboundUrl` работает: попытка подписки/destination на `http://localhost`, `http://127.0.0.1`, `http://169.254.169.254`, `http://10.0.0.1`, `javascript:`, `file://` — отказана с понятной ошибкой.
- [ ] `WebhookSubscription.secretEncrypted` хранится зашифрованным (проверить SQL-выборкой — plaintext в поле быть не должно). Plaintext-секрет показывается юзеру один раз при создании.
- [ ] `IntegrationDestination.config.botToken` (Telegram) шифруется аналогично.
- [ ] Per-user квоты работают: при превышении — 429 с `Retry-After` и понятным телом. Проверить на chat-requests-per-day.
- [ ] DTO-валидация: bulk endpoint с 1000 IDs возвращает 400; chat-message длиной 100KB — 400; `expirationDays = 5` — 400.
- [ ] Idempotency: двойной POST `/regenerate` возвращает 409. Двойной POST `/render-mp4` возвращает 409 при `processing`. Двойной POST `/exports/bulk` возвращает 409 при наличии queued/processing.
- [ ] Webhook-доставка несёт заголовки `X-Z-Event-Id`, `X-Z-Delivery-Id`, `X-Z-Signature` в формате `t=...,v1=...`.
- [ ] Optimistic-lock на regenerate: одновременный POST из двух вкладок — один проходит, второй получает 409 `recap_version_mismatch`.
- [ ] Soft-delete юзера: после `DELETE /me` юзер помечен `deletedAt`, не может логиниться, но может восстановить через email-ссылку в течение 30 дней.
- [ ] Public share страница отдаёт `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow, noarchive`, `Cache-Control: private, no-store`.
- [ ] Истёкший share возвращает 410 Gone (не 404).
- [ ] `MeetingTranscriptChunk` имеет unique constraint на `(meetingId, startMs, endMs)`; повторный запуск `transcript-index` job не плодит дубли.
- [ ] Highlight time-validation: попытка создать клип с `endMs > meeting.durationMs` или `endMs - startMs > CLIP_MAX_DURATION_SECONDS * 1000` — 400.
- [ ] FSM-переходы покрыты тестами: regenerate → chaptersStatus/tasksStatus = queued, embeddingsStatus не трогается.
- [ ] Retention-воркеры работают: `WebhookDelivery > 30d`, `Export.expiresAt < now`, `MeetingShareView > 90d`, `Meeting.deletedAt < now-30d`, `User.deletedAt < now-30d` — удаляются.
- [ ] `AuditLog` пишется при критических мутациях (минимум: user.delete, share.create, api_key.create, webhook_subscription.create, meeting.delete, meeting.regenerate, quota.exceeded).
- [ ] Prometheus-метрики появляются: `webhook_delivery_total`, `llm_router_dispatch_total`, `embedding_tokens_total`, `quota_exceeded_total`, `mp4_render_duration_seconds`.
- [ ] `bun run typecheck` и `bun run test:unit` зелёные.
- [ ] Smoke-test пройден.
- [ ] Second Brain обновлён: `01_projects/meeting-result-page.md` (полная переработка), `01_projects/api-layer.md` (расширение), `01_projects/admin.md`, `01_projects/ai-jobs.md`, `01_projects/workers-queues.md`, `01_projects/frontend-pages.md`, `01_projects/frontend-contexts-hooks.md`, `02_architecture/data-model.md`, `02_architecture/module-map.md`, `02_architecture/ai-integration.md`, `02_architecture/security.md` (новая заметка про SSRF, encryption, quotas), `02_architecture/state-machines.md` (новая заметка с FSM-диаграммами).

## Риски и ограничения

- **pgvector на managed Postgres.** Если на нашем хостинге его нет / недоступен по тарифу — падаем на схему без вектора, cross-meeting search V2 откладывается. Митигация: проверить в инфре до старта Фазы 2; если плохо — встаём на отдельный Postgres-инстанс под векторы.
- **Стоимость embeddings на масштабе.** На 100 встреч/мес — копейки. На 10K — ощутимо. Локальный fallback зайдёт, когда счёт OpenAI станет видимым в P&L.
- **Качество extract-tasks-structured.** AI на разных типах встреч извлекает задачи неравномерно. Митигация: confidence-score, явная пометка «низкая уверенность» в UI, лёгкий ручной добавление, отдельный промпт под каждый тип через `LlmRouter` и user templates.
- **Конкуренция этапов AI-pipeline.** Параллельный запуск `chapters / structured-tasks / embeddings` после `analyze` создаёт нагрузку. Митигация: rate-limit в очередях BullMQ, отдельный воркер на embeddings (можно масштабировать независимо).
- **HMAC-подпись webhook не проверяется получателем.** Если юзер не реализует проверку — теоретически можно подделать. Это его ответственность; в документации публичного API даём ссылку на пример проверки в Python/Node/Go.
- **MP4-рендер задерживает воркер.** Длинный клип занимает ffmpeg надолго. Митигация: ограничение длины клипа 5 минут (`CLIP_MAX_DURATION_SECONDS`), per-user лимит `MAX_RENDER_JOBS_PER_HOUR`, лимит на конкурентность `ClipRenderWorker` через BullMQ.
- **Размер ZIP-экспорта.** 50 встреч с видео — десятки гигабайт. Митигация: чекбоксы «что включить» (без видео по умолчанию), лимит 100 встреч на один экспорт, лимит размера итогового ZIP `EXPORT_ZIP_MAX_SIZE_BYTES`, multipart upload в S3.
- **Перегруз UI.** 3 колонки + 5 табов + чат — много. Митигация: коллапс колонок, sticky-навигация, тестирование на мобиле (на мобиле центр + bottom-tabs, левая и правая в drawer).
- **Совместимость с standalone-product ТЗ.** Если standalone не закрыт — некоторые компоненты (AppShell, дизайн-система) ещё не существуют. Митигация: standalone Фаза 1 — хард-зависимость, без неё этот ТЗ не стартует.
- **Vidstack лицензия.** MIT по официальной странице — проверить юристом перед закрытием Фазы 4.
- **DNS-rebinding на webhook URL.** Атакующий может зарегистрировать домен с TTL=0, отдавать сначала публичный IP, потом приватный. Митигация: `assertSafeOutboundUrl` резолвит DNS прямо перед запросом, не доверяет кэшу. Дополнительно — opt-in egress-network isolation воркера.
- **Шифрование webhook-секретов в админ-режиме.** Если админ-юзер хочет посмотреть секрет — он его не сможет посмотреть (только prefix). Это by-design — снижение поверхности утечки. В runbook описать процедуру regenerate-secret.
- **Drift квот при многонодовом backend.** Counter в Redis консистентен; в `UserQuotaCounter` БД — eventual consistency (бэкап для отчётности). На двух нодах одновременная попытка записи — Redis INCR atomic, всё ок.
- **Меняем формат AuditLog без миграции.** В будущем поле `metadata` может стать строго типизированным per `action`. На старте — Json, в коде через discriminated union по `action`.

## Фазы реализации

Фазы упорядочены по зависимостям. Параллелизация возможна между фронт- и бэк-задачами одной фазы.

### Фаза 0 — Подготовка инфры

- [ ] pgvector extension в Postgres (init-скрипт + проверка в существующем инстансе).
- [ ] **`WEBHOOK_SECRETS_ENCRYPTION_KEY`** сгенерирован (256-бит base64) и положен в secret-storage прода (Yandex Lockbox или аналог); локально — в `.env`.
- [ ] ENV расширения:
  - AI: `EMBEDDING_PROVIDER`, `OPENAI_PROXY_API_KEY`, `EMBEDDING_FALLBACK_LOCAL_URL` (опц).
  - Limits: `CLIP_MAX_DURATION_SECONDS=300`, `EXPORT_ZIP_MAX_MEETINGS=100`, `EXPORT_ZIP_MAX_SIZE_BYTES=21474836480` (20GB).
  - Quotas (см. таблицу в разделе «Безопасность»): `MAX_API_KEYS_PER_USER`, `MAX_WEBHOOK_SUBSCRIPTIONS_PER_USER`, `MAX_DESTINATIONS_PER_USER`, `MAX_TAGS_PER_USER`, `MAX_USER_TEMPLATES_PER_USER`, `MAX_CHAT_REQUESTS_PER_DAY`, `MAX_CHAT_TOKENS_PER_DAY`, `MAX_RENDER_JOBS_PER_HOUR`, `MAX_BULK_EXPORTS_PER_DAY`, `MAX_REGENERATE_PER_MEETING_PER_DAY`, `MAX_MEETINGS_CREATED_PER_DAY_VIA_API`, `MAX_EMBEDDING_TOKENS_PER_MONTH_PER_USER`.
  - SSRF protection: `WEBHOOK_EGRESS_ALLOWED_HOSTS` (опц whitelist для тестирования).
  - Telegram destinations: ничего (юзер вводит свой `bot_token`).
- [ ] Проверка ffmpeg в проде / в Docker-образе backend.
- [ ] Подтверждение MIT-лицензии Vidstack (юридическая проверка).
- [ ] Standalone-product ТЗ Фаза 1 (дизайн-система + AppShell) — должна быть закрыта до старта Фазы 4.
- [ ] Network policy / egress isolation для webhook-воркера (опционально, для прода) — отдельная network namespace без доступа к internal CIDR.

### Фаза 0.5 — Design Foundations (БЛОКИРУЮЩАЯ для всех frontend-фаз)

> Все детали — в [design-документе](plans/analysis/2026-05-09-ai-meeting-workspace-design.md).

- [ ] Утверждение direction: dark-first minimalism + mint (`#5EEAD4`) + Geist + glass-cards.
- [ ] CSS-токены в `frontend/src/ui/tokens.css` по таблице из design-документа: bg-base/elevated/card/overlay, border-subtle/default/strong, text-primary/secondary/tertiary, accent палитра, success/warning/danger, radius scale, shadow scale, blur tokens, spacing scale.
- [ ] Light mode tokens — параллельный набор переменных в `:root[data-theme="light"]`.
- [ ] Theme switcher в шапке sidebar (Sun/Moon icon), persist в localStorage `z-theme`, respect `prefers-color-scheme` при первом заходе.
- [ ] Geist Sans + Geist Mono подключены через `next/font` (или local woff2 в `public/fonts/`).
- [ ] Lucide Icons подключены, базовые stroke 1.5px.
- [ ] Framer Motion (`motion`) добавлен в зависимости.
- [ ] Базовые motion-presets в `frontend/src/ui/motion.ts`: `SPRING_DEFAULT`, `SPRING_BOUNCY`, `EASE_OUT_EXPO`, `DURATION_DEFAULT`. Используются всеми компонентами.
- [ ] `prefers-reduced-motion` обработка (instant fallback для критических, нулевой transform для остальных).
- [ ] Реализация эталонной страницы — `/meetings/[id]/result` в новом 3-колоночном layout до production-quality визуала: видео-плеер с кастомизацией Vidstack по design-документу, 5 табов с shared-layout indicator, AI-чат справа с glass-citations, левая колонка со smart chapters timeline. На моках данных, без бэкенд-логики (она в Фазе 4).
- [ ] AI-цитата как переиспользуемый компонент `<AiCitation>` в `frontend/src/ui/components/ai/AiCitation.tsx` с glass-стилями (`backdrop-filter`, mint border, hover-glow). Используется в чате, в Smart chapters, в action items source-quote.
- [ ] AI-typing indicator как компонент `<AiTypingDots>`.
- [ ] Skeleton-states с shimmer-анимацией в `<Skeleton>`.
- [ ] Calibration loop с владельцем продукта — 1–3 итерации на эталонной странице.
- [ ] Утверждение эталона — `status: approved` в design-документе.
- [ ] Документация в second-brain: `02_architecture/design-system.md` (новая заметка с финальными токенами, motion-каталогом, ссылкой на design-документ).

### Фаза 1 — БД и миграции

- [ ] Все Prisma-модели из раздела «База данных», `bunx prisma db push`.
- [ ] Расширение `User` / `Meeting` / `AiResult` / `AiUsageLog`.
- [ ] HNSW-индекс на `MeetingTranscriptChunk.embedding` (raw SQL после `db push`).
- [ ] Миграционный скрипт `backend/scripts/migrate-ai-tasks.ts` — переносит существующие `AiResult.tasks[]` в `Task` с `createdManually=false`.
- [ ] Bun runtime, юнит-тесты на маппинг.

### Фаза 2 — AI-pipeline расширения

- [ ] `LlmRouter` поверх `LlmFallbackService`, кэш `LlmTaskRoute` в памяти с TTL 60 сек.
- [ ] `EmbeddingService` (`OpenAiProxyEmbeddingService` + `EmbeddingFallbackService` + опционально `LocalEmbeddingService`).
- [ ] Воркеры: `chapter-generation` (новая задача в очереди `analyze`), `task-extraction-structured`, `transcript-index`.
- [ ] `AiPipelineOrchestrator` — параллельная постановка трёх задач после готовности `analyze`.
- [ ] Расширение `AiUsageLog` с `taskType`.
- [ ] Юнит-тесты: маршрутизация, fallback, chunk-splitting, retry на таймаут.
- [ ] e2e: создаём встречу, прогоняем pipeline, проверяем `MeetingChapter` / `Task` / `MeetingTranscriptChunk` в БД.
- [ ] Админ-страница `/admin/ai-models` — редактор маршрутов.

### Фаза 3 — Action items как сущность

- [ ] `tasks` модуль (Controller + Service).
- [ ] DTO с Swagger-аннотациями.
- [ ] API: внутренний (`/api/v1/tasks`, `/api/v1/meetings/:id/tasks`).
- [ ] UI: `Tab Action Items` на странице встречи, `My Tasks` на `/tasks`, виджет `OpenTasks` на главной.
- [ ] Inline-редактирование (status / assignee / dueDate).
- [ ] Юнит и e2e.

### Фаза 4 — Страница встречи: подключение к API

> Визуальный layout, плеер и моушн уже сделаны и утверждены в Фазе 0.5. Здесь — подключение к настоящим данным и реализация интерактива.

- [ ] Все 5 табов подключены к API: Overview (summary, отчёт, follow-up), Chapters (из `MeetingChapter`), Transcript (с двусторонней синхронизацией с плеером), Action Items (Tab из Фазы 3), Notes (autosave каждые 2 секунды).
- [ ] Двусторонняя синхронизация transcript ↔ player: текущая utterance подсвечивается во время воспроизведения, click по utterance → перемотка.
- [ ] Поиск (`/` shortcut) в Transcript с подсветкой matches.
- [ ] Выделение интервала в Transcript → floating button `Создать клип` (используется в Фазе 7).
- [ ] Шапка `MeetingHeader` + диалоги Share / Regenerate / Send (последний — из Фазы 12).
- [ ] Inline-edit названия встречи.
- [ ] Левая колонка: TOC секций, Smart chapters timeline с pulse-индикатором текущей главы, ParticipantsList с длительностью речи.
- [ ] Mobile-адаптация: левая колонка → drawer, правая → drawer, центр → bottom-tabs.
- [ ] Старый `meeting-result/` помечается как deprecated, после смок-теста — удаляется.

### Фаза 5 — AI-чат (фаза А — single-meeting)

- [ ] `chat` модуль с `POST /api/v1/meetings/:id/chat`.
- [ ] Хранение истории в `MeetingChatMessage`.
- [ ] Suggested prompts по типу встречи.
- [ ] UI `AiChatPanel` в правой колонке страницы встречи.
- [ ] Citations с jump-to-time.
- [ ] e2e.

### Фаза 6 — AI-чат (фаза Б — cross-meeting)

- [ ] `POST /api/v1/chat` с `scope: 'all' | { meetingIds: string[] }`.
- [ ] RAG-flow: embed query → top-K chunks → contexting LLM.
- [ ] UI: cross-meeting chat-страница `/chat`.
- [ ] Citations с jump-to-meeting.
- [ ] Fallback на «нет релевантных встреч» с явным сообщением.

### Фаза 7 — Highlight clips

- [ ] `highlights` модуль + DTO + API.
- [ ] UI: создание клипа из выделения транскрипта или интервала на плеере.
- [ ] `clip-render` очередь, `ClipRenderWorker` с ffmpeg.
- [ ] UI: статус рендера, кнопка `Скачать MP4` после готовности.
- [ ] Лимит длины клипа (`CLIP_MAX_DURATION_SECONDS`).

### Фаза 8 — Публичный шеринг

- [ ] `shares` модуль + DTO + публичный API без авторизации.
- [ ] Tokens (criptographically random, 32 char base64url).
- [ ] Публичные роуты фронта `(public-share)/share/[token]` и `(public-share)/share/clip/[token]`.
- [ ] `PublicShareLayout` без AppShell.
- [ ] `ExpiredShareLanding` с CTA на `/signup`.
- [ ] Диалог шеринга с тумблерами (Видео / Транскрипт / Задачи / Главы) и сроком (1/7/14 дней, default 7).
- [ ] Списки активных ссылок на странице встречи + кнопки `Продлить` / `Отозвать`.
- [ ] Counter `viewCount` инкрементируется при просмотре.

### Фаза 9 — Tags и массовые действия

- [ ] `tags` модуль + DTO + API.
- [ ] UI: страница `/settings/tags`, popover-выбор тегов в журнале и на странице встречи.
- [ ] Чекбоксы и `BulkActionsToolbar` в журнале.
- [ ] Bulk-API: `delete`, `tag`, `export`.
- [ ] `exports` модуль + `export-zip` очередь + `ExportZipWorker`.
- [ ] UI: страница `/settings/exports`, прогресс-индикатор в toolbar.

### Фаза 10 — Public REST API + API keys

- [ ] `api-keys` модуль + UI создания / отзыва.
- [ ] `ApiKeyAuthGuard`.
- [ ] Публичные эндпоинты `/api/public/v1/*` (зеркало внутренних, обогащённое Swagger-описаниями).
- [ ] Swagger UI на `/api/public/v1/docs` с примерами.
- [ ] Per-key rate-limit (default 100 req/min) + per-user суммарный (500 req/min).
- [ ] `MAX_API_KEYS_PER_USER` enforce (50 default).
- [ ] IP fail2ban при 10 неудачных аутентификаций за минуту (15 минут блок).
- [ ] `ApiAccessLog` пишется на каждый запрос (route, status, durationMs, apiKeyId, userId, ipHash).
- [ ] Логирование использования (`ApiKey.lastUsedAt`).
- [ ] Документация публичного API в `docs/public-api.md` + примеры HMAC-проверки на Python/Node/Go.

### Фаза 11 — Outgoing webhooks

- [ ] `webhooks` модуль (subscriptions + deliveries).
- [ ] HMAC SHA-256 подпись + полный набор заголовков (`X-Z-Event-Id`, `X-Z-Delivery-Id`, `X-Z-Event`, `X-Z-Timestamp`, `X-Z-Signature t=...,v1=...`).
- [ ] `webhook-deliver` очередь + воркер с retry-расписанием 30s / 5m / 1h.
- [ ] **SSRF-защита через `assertSafeOutboundUrl`** (общий хелпер из `common/http/safe-outbound.ts`): валидация URL при создании подписки + перед каждым POST в воркере. DNS-resolve, blacklist private CIDR, max-redirects=0, HTTPS-only в проде.
- [ ] **Шифрование `secretEncrypted`** (envelope encryption через `WEBHOOK_SECRETS_ENCRYPTION_KEY`). Plaintext-секрет показывается юзеру 1 раз при создании.
- [ ] Валидация `events` массива против enum-whitelist в DTO.
- [ ] `MAX_WEBHOOK_SUBSCRIPTIONS_PER_USER` enforce.
- [ ] `WebhookEventBus` — подписка на NestJS events (`@OnEvent`).
- [ ] `WebhookRetentionWorker` (cron) — удаление `WebhookDelivery > 30d`.
- [ ] Восстановление при рестарте: `WebhookDispatcherService.onApplicationBootstrap` поднимает все `pending`/`retrying` с `nextAttemptAt < now+5min` обратно в очередь BullMQ.
- [ ] UI: страница `/settings/webhooks` с формой создания, журналом доставок, кнопкой ручного retry.
- [ ] Email-уведомление при `failing` статусе.

### Фаза 12 — Integration destinations

- [ ] `destinations` модуль (CRUD).
- [ ] `DeliveryService` + 4 sender'а.
- [ ] Шаблоны сообщений (Email html / Slack md / Telegram md / Generic JSON).
- [ ] UI: страница `/settings/integrations` с диалогом добавления и тестовой кнопкой.
- [ ] Кнопка `Отправить в...` на странице встречи, на задаче, на клипе.

### Фаза 13 — Templates UX

- [ ] `templates` модуль + `UserTemplate` модель + API.
- [ ] `TemplateRegistryService`.
- [ ] UI: галерея шаблонов на странице создания встречи.
- [ ] `RegenerateDialog` на странице результата.
- [ ] `SectionsCustomizer` (галочки секций).
- [ ] `SaveAsUserTemplateDialog`.
- [ ] Регенерация инкрементирует `Meeting.recapVersion`.

### Фаза 14 — Главная-дашборд + страница My Tasks

- [ ] `dashboard` модуль + API агрегатов.
- [ ] Главная `/` — 4 виджета (Today / This Week / Open Tasks / Stats).
- [ ] Страница `/tasks` (если ещё не закрыта в Фазе 3 — финализация).
- [ ] Cross-meeting search-bar в шапке кабинета (поверх API из Фазы 6).

### Фаза 14.5 — Security hardening, quotas, audit, retention

> Сводная фаза, чтобы security-пункты, разбросанные по другим фазам, имели одного владельца и были закрыты комплексно. Часть пунктов уже частично сделана внутри Фаз 10, 11, 12 — здесь добиваем недостающее и интегрируем.

- [ ] Общий хелпер `common/http/safe-outbound.ts::assertSafeOutboundUrl(url)` с тестами на все опасные паттерны (private CIDR, link-local, IPv6, javascript:, file:, redirects).
- [ ] Общий хелпер `common/crypto/envelope.ts::encryptAtRest(plain) / decryptAtRest(blob)` — AES-256-GCM, ключ из `WEBHOOK_SECRETS_ENCRYPTION_KEY`. Используется в `WebhookSubscription.secretEncrypted` и `IntegrationDestination.config.botToken`.
- [ ] `QuotaGuard` декоратор `@Quota(quotaName)`, реализация через Redis sorted-set + бэкап в `UserQuotaCounter` (в БД).
- [ ] Все per-user квоты подключены к соответствующим эндпоинтам (см. таблицу в разделе «Безопасность»).
- [ ] `AuditService.log({ action, resourceId, metadata })` + write-points на критических мутациях. Минимум: `user.delete`, `user.restore`, `share.create`, `share.revoke`, `api_key.create`, `api_key.delete`, `webhook_subscription.create`, `destination.create`, `meeting.delete`, `meeting.regenerate`, `quota.exceeded`.
- [ ] Retention-воркеры (cron):
  - `webhook-retention` — `WebhookDelivery > 30d`.
  - `export-retention` — `Export.expiresAt < now`.
  - `share-view-retention` — `MeetingShareView > 90d`.
  - `meeting-hard-delete` — `Meeting.deletedAt < now-30d`.
  - `user-hard-delete` — `User.deletedAt < now-30d`.
  - `audit-log-retention` — `AuditLog > 365d`.
  - `api-access-log-retention` — `ApiAccessLog > 30d`.
- [ ] Soft-delete юзера: `DELETE /api/v1/me` ставит `deletedAt`, шлёт email с restore-link, ссылка действует 30 дней. `POST /api/v1/me/restore?token=...` сбрасывает `deletedAt`.
- [ ] HTTP-заголовки на публичных share-страницах: `Referrer-Policy: no-referrer`, `X-Robots-Tag`, `Cache-Control: private, no-store`, `CSP`. Реализация в Next.js middleware для `(public-share)` route group.
- [ ] Admin-страница `/admin/quotas` — таблица квот с возможностью редактирования значений (без рестарта, через `LlmTaskRoute`-style hot-reload).
- [ ] Admin-страница `/admin/audit-log` — фильтруемый журнал критических действий.
- [ ] Admin-страница `/admin/api-access-log` — журнал обращений к Public API + поиск по apiKeyId / userId / status.
- [ ] Prometheus-метрики (см. раздел «Observability»): `webhook_delivery_total`, `webhook_delivery_failure_rate`, `llm_router_dispatch_total`, `llm_fallback_total{from,to}`, `embedding_tokens_total`, `embedding_cost_estimated_usd`, `chat_request_total`, `quota_exceeded_total`, `mp4_render_duration_seconds`, `export_zip_size_bytes`.
- [ ] Алерты в Grafana по `docs/runbook/alerts.md`.
- [ ] e2e тесты: SSRF-блок, quota-overflow, soft-delete-restore, retention-cron, optimistic-lock на regenerate.

### Фаза 15 — Регрессии, доки, smoke-test

- [ ] Регрессия: Crossmark-flow (deep-link → cookie → /m/[id]).
- [ ] Регрессия: гостевой вход.
- [ ] Регрессия: standalone-product (signup → login → forced password change → создание встречи).
- [ ] Регрессия: админка (управление API-ключами Crossmark, AdminMeetingActions).
- [ ] Обновление second-brain (см. DoD).
- [ ] Smoke-test (см. ниже).
- [ ] Чистка deprecated-кода (`meeting-result/*`).

## Чек-лист smoke-test

- [ ] Создаю встречу, провожу 5-минутный звонок с двумя участниками, завершаю.
- [ ] AI-pipeline отрабатывает: появляются `summary`, `chapters`, `tasks` (структурированные с assignee и due date), `embeddings` в `MeetingTranscriptChunk`.
- [ ] На странице встречи: 3 колонки, табы, плеер с маркерами глав на timeline, клик по маркеру → перемотка.
- [ ] Клик по строке транскрипта → перемотка плеера; во время воспроизведения текущая строка подсвечивается.
- [ ] AI-чат справа: задаю вопрос «что мы решили по срокам» → получаю ответ с цитатой и кнопкой jump-to-time.
- [ ] Действие на задаче: `status=done`, изменение `assignee`, отправка в Slack-destination → сообщение приходит в канал.
- [ ] Создаю клип (выделение интервала), шерю ссылку, открываю в инкогнито — клип воспроизводится. Жму `Скачать MP4` → через минуту приходит ссылка на скачивание, файл валидный.
- [ ] Создаю share-ссылку с тумблерами «только summary и tasks» и сроком 1 день. Открываю в инкогнито — вижу summary + tasks, не вижу видео и транскрипт.
- [ ] Изменяю системное время на +2 дня (или жду сутки) — открываю ту же ссылку, вижу лендинг «истекла» с CTA на `/signup`.
- [ ] Тегирую 3 встречи, фильтрую по тегу — все 3 видны.
- [ ] Массово выделяю 5 встреч → toolbar → `Экспорт ZIP` → диалог с чекбоксами включения транскрипта/аудио → жму. Через несколько минут приходит email со ссылкой, скачиваю ZIP, в нём 5 markdown-файлов и (если включил) транскрипты.
- [ ] Создаю API-ключ, делаю `curl /api/public/v1/meetings -H "Authorization: Bearer ..."` — получаю JSON со списком.
- [ ] Создаю webhook-подписку на `meeting.completed`, провожу новую встречу, в журнале доставок появляется запись со статусом `delivered`. На моём `webhook.site` приходит payload с правильной HMAC-подписью.
- [ ] Регенерирую отчёт с другим шаблоном — секции в Overview меняются, `recapVersion` инкрементируется.
- [ ] На главной кабинета вижу виджеты с актуальными цифрами.
- [ ] На `/tasks` вижу все задачи всех своих встреч, фильтрую по `status=open`.
- [ ] Cross-meeting AI-чат: спрашиваю про обсуждения за последний месяц → ответ с цитатами из 3 разных встреч, у каждой кнопка перехода.
- [ ] Админ заходит в `/admin/ai-models`, меняет порядок провайдеров для `taskType=chat`, через 60 секунд новый порядок применяется.
- [ ] **SSRF-чек:** пытаюсь создать webhook-подписку с URL `http://169.254.169.254/latest/meta-data/`, `http://localhost:8080`, `http://10.0.0.1`, `http://[::1]`, `javascript:alert(1)`, `file:///etc/passwd` — все отказаны с 400.
- [ ] **Quota-чек:** в админке ставлю `MAX_CHAT_REQUESTS_PER_DAY=3`, делаю 4 запроса в чат — четвёртый возвращает 429 с `Retry-After` и понятной строкой в теле.
- [ ] **Idempotency-чек:** одновременно из двух вкладок жму `Регенерировать` — один проходит, второй получает 409 с `recap_version_mismatch`. Видеогруппы обновляются через 60 секунд.
- [ ] **Encryption-чек:** в БД смотрю на `WebhookSubscription.secretEncrypted` — это base64-blob, не plain. В админке тестирую webhook delivery — приходит со валидной HMAC-подписью.
- [ ] **Soft-delete-чек:** удаляю свой аккаунт. Логинюсь с тем же email — 401. Жду 5 минут, восстанавливаю по email-ссылке — аккаунт активен, встречи на месте.
- [ ] **Retention-чек:** ставлю системное время на +31 день, запускаю retention-воркеры вручную — `Meeting.deletedAt`-старше-30 удаляется физически вместе со всеми связанными `Task`/`Highlight`/`Share`/`MeetingTranscriptChunk`.
- [ ] **Public share token format:** генерирую 100 ссылок, проверяю формат каждой — 32 base64url символа, без коллизий.

## Итог

_Заполняется по факту: реализовано целиком или нет, что осталось._
