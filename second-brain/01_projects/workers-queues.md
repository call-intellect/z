---
title: BullMQ Workers + Queues + Crons (реестр)
status: living
covers: реестр BullMQ-очередей, воркеров, @Cron заданий
---

# Workers + Queues + Crons

Сжатый реестр BullMQ-очередей, in-process воркеров и `@Cron` заданий backend. Все воркеры запускаются в **отдельном процессе** через `bun run worker:dev` (`src/workers/main.ts`).

Файл создан 2026-05-25 как часть финального handoff Wave 1-3.

## Очереди BullMQ (Redis-backed)

| Очередь | Producer | Consumer | Concurrency | Назначение |
|---|---|---|---|---|
| `core.raw-events` | `IngestService` (meeting-adapter, tracker-adapter, telegram-adapter, email-adapter, **mail-inbound** T5) | `block-ingest.worker` | 4 | Универсальный ingest в knowledge-core |
| `core.block-distill` | `block-ingest.worker` | `block-distill.worker` | 2 | Дистилляция блоков |
| `core.block-linker` | cron / on-event | `block-linker.worker` | 1 | KNN+LLM граф знаний |
| `core.entity-resolve` | `block-distill.worker` | `entity-resolver.worker` | 1 | Слияние Entity |
| `core.theme-clusterer` | cron 15 * * * * | `theme-clusterer.cron` | — | KNN-greedy кластеры тем |
| `core.specialist-routing` | `block-distill.worker`, on-event | per-specialist (`3-1-regulations`, `3-2-knowledge-clone`, `3-3-decisions`, `3-4-project-customer`, `3-5-insights`, `3-6-ideas`, `3-8-helpfulness`, `tracker-ingest`) | 2-4 | Маршрутизация в специалистов слоя 3 |
| `core.skill-profile-rebuild` | on-event (debounce 60s) | `skill-profile-rebuild.worker` | 1 | γ-1 |
| `core.knowledge-clone-rebuild` | on-event | `knowledge-clone-rebuild.worker` | 1 | β-2 |
| `core.probe-events` | `ProbeService.suggest` | `probe-dispatcher.worker` | 1 | Probe-Agent (формулирует и шлёт через каналы) |
| `core.recognition-formulate` | on-event (badge_awarded, thanks_explicit, ...) | `recognition-formulate.worker` | 2 | Recognition (с fallback на deterministic copy) |
| `core.push-send` | on-event | `push-sender.worker` | 5 | Web Push (jobId dedup по `<userId>_<hash>_<bucketMin>`) |
| `tracker.webhook-delivery` | `IssueWebhookService` | `webhook-delivery.worker` | 8 | Outgoing tracker webhooks (HMAC SHA256, retry 5x exp backoff) |
| `core.intake-auto-triage` | `meeting-extract-actions.worker` | `intake-auto-triage.worker` | 2 | confidence ≥ 0.92 → auto-Issue |
| `core.card-rollup-v2` | on-event (debounce 60s) | `card-rollup-v2.worker` | 2 | AI rollup карточки |
| (legacy) `core.card-rollup` | on-event (debounce 5s) | `card-rollup.worker` | 2 | Legacy (живёт до Фаз 5/6) |
| **`core.meeting-report-fast` (ТЗ 2026-05-25)** | `merge.worker` (после готовности транскрипта; рядом с `ai.analyze`) | `meeting-report-fast.worker` | 2 | Один LLM-вызов на сыром транскрипте → главы + задачи + summary + quality_score → `Meeting.reportFastStatus`. ENV kill-switch `MEETING_REPORT_FAST_ENABLED`. Параллельно с legacy v2 для A/B. См. [meeting-report-pipeline](meeting-report-pipeline.md). |

## @Cron задания

Все cron-задания читают `Org.workersEnabled` через `WorkerOrgGate.checkOrThrow` — admin может выключать per-Org.

| Cron | Расписание | Файл | Что делает |
|---|---|---|---|
| `theme-clusterer` | `15 * * * *` | `knowledge-core/workers/theme-clusterer.cron.ts` | Кластеризация тем |
| `reframing` | `0 3 * * *` | `knowledge-core/workers/reframing.cron.ts` | Архивация слабых связей + decay |
| `entity-graph-builder` | `0 * * * *` | `knowledge-core/workers/entity-graph-builder.cron.ts` | Co-mentioned пары Entity |
| `chat-v2-cleanup` | `0 3 * * 0` (Sun 03:00) | `chat-v2/workers/chat-v2-cleanup.cron.ts` | TTL 90 дней → archived |
| `knowledge-clone-rebuild` | `0 */6 * * *` | `specialist-3-2-knowledge-clone/cron/...` | β-2 rebuild |
| `insights-recalc` | `0 */6 * * *` | `specialist-3-5-insights/cron/...` | β-4 frequency/dynamic |
| `ideas-clusterer` | каждые 4 часа | `specialist-3-6-ideas/cron/ideas-clusterer.cron.ts` | β-5 KNN cluster Idea |
| `skill-profile-decay` | `0 5 * * *` | `specialist-3-7-skill/cron/...` | γ-1 daily decay |
| `skill-persona-snapshots` | `0 6 * * 0` (Sun) | `specialist-3-7-skill/cron/...` | Weekly snapshots |
| `skill-manager-digest` | `0 9 * * 1` (Mon) | `specialist-3-7-skill/cron/...` | Weekly digest |
| `social-contribution-profile` | `0 5 * * *` | `specialist-3-8-helpfulness/cron/...` | Wave 2 — агрегат helpCount/etc |
| `helpfulness-spotlight` | `0 9 * * 1` (Mon) | `specialist-3-8-helpfulness/cron/...` | Wave 2 — формирует pending spotlight |
| `helpfulness-trait-decay` | `0 6 * * *` | `specialist-3-8-helpfulness/cron/...` | 30-day decay |
| `helpfulness-probe` | `0 10 * * *` | `specialist-3-8-helpfulness/cron/...` | 4 probe-trigger обёртка |
| `contribution-snapshot` | `0 4 * * *` | `recognition/cron/contribution-snapshot.cron.ts` | Wave 2 — агрегат per user |
| `badge-awarder` | `0 5 * * *` | `recognition/cron/badge-awarder.cron.ts` | Wave 2 — 5 базовых badges |
| `streak-detector` | `0 23 * * *` | `recognition/cron/streak-detector.cron.ts` | Wave 2 — currentCheckinStreak + emit streak_milestone |
| `recognition-weekly-digest` | `0 9 * * 1` (Mon) | `recognition/cron/recognition-weekly-digest.cron.ts` | Wave 2 — manager digest |
| `feed-expire` | `*/15 * * * *` | `activity-feed/cron/feed-expire.cron.ts` | Wave 2 — FSM expired |
| `feed-digest` | daily 09:00 + Mon 09:00 | `activity-feed/cron/feed-digest.cron.ts` | Wave 2 — digest collection |
| `push-cleanup` | `0 3 * * *` | `push/cron/push-cleanup.cron.ts` | Wave 2 — удаляет subscriptions с failureCount ≥ PUSH_MAX_FAILURES |
| `strategic-alignment` (issue-based) | `0 6 * * *` (06:00 UTC) | `goals/cron/strategic-alignment.cron.ts` | Sprint 3 B1-3.2 |
| `telegram-digest` | `0 9 * * *` | tracker Wave 3 | Telegram дайджест моих задач |
| `cycle-rollover` | (на end of cycle) | tracker | Auto-rollover незакрытых задач |
| **`imap-poll` (T5)** | `MAIL_INBOX_POLL_CRON` default `*/2 * * * *` | `mail-inbound/cron/imap-poll.cron.ts` | **Финальный handoff 2026-05-25.** IMAP fetch unseen → парсит → routing на Project |
| **`operations-weekly-digest` (β-8.1)** | `0 * * * *` (фильтр по `Org.timezone`, понедельник `COO_WEEKLY_DIGEST_LOCAL_HOUR`) | `operations/workers/operations-weekly-digest.cron.ts` | Идемпотентно по `(tenantId, weekStart)`. Отправка `coo+owner` через `ConversationalService` (eventType `operations.weekly_digest`). |
| **`commitment-followup` (β-8.2)** | `0 * * * *` (фильтр по `Org.timezone`, `COMMITMENT_FOLLOWUP_LOCAL_HOUR` default 9) | `operations/workers/commitment-followup.cron.ts` | Ищет `commitmentStatus='open'` со сроком прошедшим (+1 рабочий день через `HolidayService`) → `ProbeService.suggest(reason='commitment.followup')`. Эскалация ролям `coo`/`owner` после `COMMITMENT_ESCALATION_DAYS` молчания. |

## Финальный handoff Wave 1-3 — новые воркеры (2026-05-25)

### T5 — Email-to-task (mail-inbound)

**Cron `ImapPollCron`** — `@Cron(MAIL_INBOX_POLL_CRON)` (default `*/2 * * * *`):
1. Открывает IMAP connection (imapflow, lifecycle: connect → fetch unseen → mark seen → close).
2. Для каждого `unseen` сообщения: mailparser → дёргает `MailInboundService.handleMessage(parsed)`.
3. `MailInboundService` ищет `Project.emailInboxAlias` по `To:`, идемпотентность по `Message-ID @unique` → routing → `Issue` или `IntakeIssue` + S3 attachments → log в `MailInboundLog`.
4. Метрики `z_mail_inbound_{received,routed,rejected,duplicates}_total`.

**ENV (9 новых):** `MAIL_IMAP_HOST/PORT/USER/PASSWORD/TLS/MAILBOX`, `MAIL_INBOX_POLL_CRON`, `MAIL_INBOX_DOMAIN`, `MAIL_ATTACHMENT_MAX_BYTES` (default 26214400 = 25 MB).

**ВАЖНО:** воркер запускается только в worker-process (`bun run worker:dev`), но cron registered в `@nestjs/schedule` модуле, который монтируется и в HTTP-app, и в worker-app. Чтобы избежать двойного pull — проверяем `process.env.WORKER_INSTANCE === 'true'` в cron'е (TODO если не реализовано — добавить).

### T4 — Voice Streaming (без воркера)

**`VoiceStreamGateway`** в `concierge/gateways/voice-stream.gateway.ts` (namespace `/ws/voice`).

⚠ **Это WebSocket gateway, НЕ воркер и НЕ cron.** Сессии хранятся **in-memory** (`Map<userId, VoiceSession>`), TTL 60s, 1 session per user, buffer cap 5 MB. При `voice.end` синхронно отдаём в `VoxAdapter.transcribe()` (poll-модель).

Не используется BullMQ — задержка важна, очередь только добавила бы latency. Risk: при рестарте процесса все активные сессии теряются (приемлемо для voice-капчи — пользователь просто повторит).

**TODO:** миграция на streaming ASR (Whisper realtime / GigaAM streaming) — тогда понадобится отдельный stateful worker или per-session pod.

## Принципы

1. **HTTP-app и worker-app — разные процессы.** Worker не должен принимать HTTP-запросы (кроме `/health` /  `/metrics`).
2. **Все cron используют `WorkerOrgGate`** — admin может выключить per-Org через `Org.workersEnabled`.
3. **Идемпотентность через jobId** — все важные воркеры используют детерминированный `jobId` (формат `<entityType>_<entityId>_<hash>`) для дедупликации.
4. **HNSW pgvector индексы** — для всех embedding-полей. Создаются скриптом `bun run apply-postgres-init` (НЕ в `schema.prisma`).
5. **Метрики Prometheus** — каждая очередь имеет `<queue>_total{tenant, status}` counter.

## SBA β-8.1 + β-8.2 — добивка панели COO + Хранитель обещаний (2026-05-25)

**Источник:** [`plans/tz/2026-05-24-sba-beta-8-1-coo-dobivka.md`](../../plans/tz/2026-05-24-sba-beta-8-1-coo-dobivka.md), [`plans/tz/2026-05-24-sba-beta-8-2-promise-keeper.md`](../../plans/tz/2026-05-24-sba-beta-8-2-promise-keeper.md).

### Воркеры (event-driven, без BullMQ-очереди)

| Worker | Триггер | Файл | Что делает |
|---|---|---|---|
| `CheckinSentimentAnalyzerWorker` | `@OnEvent('checkin.created')` после `CheckinResponseHandler.upsertFromParser` или ручного `POST /me/check-ins` | `operations/workers/checkin-sentiment-analyzer.worker.ts` | Один вызов LLM `checkin-sentiment` (timeout 30с). Только вечерние чек-ины. Best-effort: при ошибке — `sentiment=null`, чек-ин остаётся. |
| `PersonalRelationBuilderWorker` (β-8, уже было) | event-driven | `operations/workers/personal-relation-builder.worker.ts` | — |
| `CommitmentResponseHandler` (β-8.2) | `@OnEvent('notification.responded')` + `metaJson.reason='commitment.followup'` | `operations/services/commitment-response.handler.ts` | LLM `commitment-extract-status` → создаёт `IdeaBlock(signalType='commitment_status')` + `IdeaBlockLink(type='resolves')` + обновляет статус исходного. Если `missed` — создаёт ещё `blocker`-блок. |

Маршрутизатор `knowledge-core/services/router.service.ts` для `signalType='commitment_status'` теперь эмитит `commitment.status_received` (раньше был `no-op`).

## История

- **2026-05-25:** создан в рамках финального handoff Wave 1-3. Добавлен `imap-poll` cron (T5), документировано отсутствие воркера для voice WS (T4).
- **2026-05-25 (β-8.1/β-8.2):** добавлены `operations-weekly-digest` и `commitment-followup` cron'ы + event-driven worker'ы `CheckinSentimentAnalyzerWorker` и `CommitmentResponseHandler`.

[[../index|← index]]
