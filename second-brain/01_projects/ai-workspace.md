---
title: AI Meeting Workspace — новые модули и API
status: actual
updated: 2026-05-09
---

# AI Meeting Workspace

Расширение MVP до уровня Otter / Fathom / Fireflies. Реализовано 2026-05-09 по ТЗ `plans/tz/2026-05-09-ai-meeting-workspace.md`.

## Backend — карта модулей

### AI-pipeline (расширения существующего)
- `backend/src/modules/ai/services/llm-router.service.ts` — маршрутизация по `taskType` через таблицу `LlmTaskRoute`. taskTypes: `summary | chapters | tasks | chat | regenerate-section | custom-prompt | follow-up | clip-title`. In-memory кэш с refresh раз в минуту.
- `backend/src/modules/ai/services/regenerate.service.ts` — `regenerateMeeting` и `regenerateSection` с optimistic-lock (`recapVersion`). 409 на mismatch, 429 на превышение `MAX_REGENERATE_PER_MEETING_PER_DAY`.
- `backend/src/modules/ai/services/{chapter,task}-extraction.service.ts` — structured extraction через LlmRouter с `responseFormat='json'` + zod-валидация.
- `backend/src/modules/ai/workers/{chapters,tasks-extract,transcript-index,clip-render}.worker.ts` — 4 новых BullMQ-воркера. Очереди: `ai.chapters`, `ai.tasks`, `ai.embeddings`, `clip.render`.
- `backend/src/modules/ai/workers/analyze.worker.ts` — после `ai_ready` оркеструет 3 параллельных job'а (chapters + tasks-extract + transcript-index) через `Promise.allSettled`. **С Фазы 1 knowledge-core (2026-05-10)** — добавлен 4-й параллельный вызов: `meetingIngest.ingestMeeting(meetingId)` (прямой await, не enqueue), который пишет канонический payload встречи в `RawEvent` через `IngestService` (см. [[ingest-and-sources]]). `transcript-index.worker` остаётся работать **параллельно** с ingest — chat-модуль ещё на нём (выпиливание — Фаза 6, после chat-v2). `MeetingTranscriptChunk` помечен `@deprecated`.

### Embeddings + RAG
- `backend/src/modules/embeddings/services/openai-proxy-embedding.service.ts` — POST на `OPENAI_PROXY_EMBEDDINGS_URL` с моделью `text-embedding-3-small` (1536-dim).
- `embedding-fallback.service.ts` — каскад provider→fallback (proxy → local).
- `local-embedding.service.ts` — для self-hosted BGE-M3 (опц, `EMBEDDING_FALLBACK_LOCAL_URL`).
- `transcript-indexer.service.ts` — chunk-splitting (~400 токенов с overlap 50), batching (100), запись в `MeetingTranscriptChunk` через `prisma.$queryRaw` с `::vector` cast.
- pgvector extension + HNSW-индекс — см. `backend/scripts/postgres-init.sql`.

### Domain
- `tasks/` — action items с inline-edit, bulk, send-to-destination
- `chapters/` — smart chapters (CRUD + regenerate)
- `highlights/` — клипы с MP4-рендером через ffmpeg (`clip-render.worker`)
- `shares/` — приватный CRUD + публичные `/api/v1/public/share/:token`, `/api/v1/public/share/clip/:token` (без auth, с заголовками `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`, `Cache-Control: no-store`)
- `tags/` — пользовательские теги встреч
- `templates/` — пользовательские шаблоны отчётов

### Cross-cutting
- `chat/` — single-meeting (context-stuffing) + cross-meeting (RAG over pgvector cosine). Эндпоинты `POST /meetings/:id/chat`, `POST /chat`, `GET .../chat/history`.
- `api-keys/` — personal API keys для Public REST. Hash = sha256(key), prefix первые 10 символов, scopes `read|write`.
- `webhooks-out/` — outgoing webhook subscriptions с HMAC-SHA256 подписью (`X-Z-Signature: t=<unix>,v1=<hex>`), exponential backoff, AES-GCM-256 envelope-encryption секретов.
- `destinations/` — Email / Slack webhook / Telegram bot / Generic webhook (через `SenderFactory`).
- `exports/` — md (handlebars), docx (`docx` пакет), bulk_zip (`archiver`). PDF — отложен (501).
- `public-api/` — Public REST под `/api/v1/public/v1` с Bearer-auth + Swagger UI на `/api/public/v1/docs`.
- `admin/llm-routes/` — управление маршрутами LLM (карточки на каждый taskType).

### Security + ops
- `security/ssrf-guard.service.ts` — проверка outbound URL: блок private CIDR, link-local, cloud-metadata; DNS-resolve перед запросом (anti-rebinding); whitelist `WEBHOOK_EGRESS_ALLOWED_HOSTS`.
- `security/encryption.service.ts` — AES-GCM-256 (IV 12B + ciphertext + tag 16B, base64-склеено через `.`).
- `security/ip-hashing.service.ts` — `sha256(ip + IP_HASH_DAILY_SALT + dateString)` для shares/audit.
- `audit/` — `AuditLogService` с константами `AUDIT.*` (USER_DELETE, SHARE_CREATE, API_KEY_CREATE, WEBHOOK_SUBSCRIPTION_CREATE, MEETING_REGENERATE, QUOTA_EXCEEDED, ...).
- `quotas/` — `QuotaService.checkAndIncrement` через Redis INCR + DECR rollback на превышение, `QuotaExceededError` (HTTP 429 с Retry-After). Snapshot в `UserQuotaCounter` каждые 10 инкрементов.
- `retention/retention-extras.cron.ts` — hard-delete `WebhookDelivery>30d`, `Export.expiresAt<now`, `MeetingShareView>90d`, `ApiAccessLog>30d`, `Meeting/User.deletedAt < now-30d`.

## Frontend — карта страниц

### Новые
- `app/(authenticated)/dashboard/` — главная для залогиненного: 4 виджета + cross-meeting AI-чат
- `app/(authenticated)/tasks/` — My Tasks с фильтрами/группировкой/inline-edit/bulk
- `app/(authenticated)/settings/{tags,integrations,api,webhooks,exports}/` — все разделы settings под `(authenticated)/settings/layout.tsx`
- `app/(admin)/admin/ai-models/` — управление LlmTaskRoute
- `app/share/[token]/`, `app/share/clip/[token]/` — публичный шеринг (без AppShell)

### Переписанные
- `app/(authenticated)/meetings/page.tsx` → `MeetingsJournalReal` (master-detail + поиск + фильтры + bulk + теги)
- `app/(authenticated)/meetings/[id]/result/page.tsx` → `MeetingResultPageReal` (3-колонки + 5 табов + AI-чат + Vidstack-плеер с маркерами + Highlights + ShareDialog + Regenerate)
- `app/(authenticated)/meetings/create/page.tsx` → `CreateMeetingFormV2` (2-step wizard с галереей шаблонов)

### UI-foundations (M4, 2026-05-09)
- `frontend/src/ui/tokens.css` — dark-first + mint `#5EEAD4` + Geist + glass tokens
- `frontend/src/ui/shadcn/` — 22 примитива (button/dialog/dropdown/select/tabs/...)
- `frontend/src/ui/components/{theme,app-shell,ai}/` — ThemeProvider/Toggle, AppShell с sidebar, AiCitation/AiTypingDots/Sparkle
- `frontend/src/ui/motion.ts` — SPRING_DEFAULT/BOUNCY, fadeIn/slideUp/scaleIn variants

## DB-модели (новые)

`Task | MeetingChapter | MeetingHighlight | MeetingShare | MeetingShareView | HighlightShare | Tag | MeetingTag | MeetingChatMessage | MeetingTranscriptChunk(pgvector) | ApiKey | WebhookSubscription | WebhookDelivery | IntegrationDestination | Export | UserTemplate | LlmTaskRoute | AuditLog | ApiAccessLog | UserQuotaCounter`

Расширения существующих: `Meeting.{recapVersion, chaptersStatus, tasksStatus, embeddingsStatus, durationMs, deletedAt}`, `User.deletedAt`, `AiResult.updatedAt`, `AiUsageLog.{userId, taskType}`.

Все модели — в `backend/prisma/schema.prisma`.
