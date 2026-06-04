---
title: BullMQ Workers + Queues + Crons (реестр)
status: living
covers: реестр BullMQ-очередей, воркеров, @Cron заданий
---

# Workers + Queues + Crons

Сжатый реестр BullMQ-очередей, in-process воркеров и `@Cron` заданий backend. **Топология (2026-06-03, уточнено):** воркеры и cron'ы крутятся **IN-PROCESS внутри основного backend'а** — `WorkersModule` импортирован в `AppModule`, отдельного worker-процесса/контейнера НЕТ (см. doc `WorkersModule`; в compose один сервис `backend`, CMD `bun dist/main.js`). Это важно для идемпотентности: in-process lock (Set) реально покрывает гонку cron↔webhook↔producer. _(Прежняя фраза про `bun run worker:dev` / `src/workers/main.ts` устарела.)_

Файл создан 2026-05-25 как часть финального handoff Wave 1-3.

## Очереди BullMQ (Redis-backed)

| Очередь | Producer | Consumer | Concurrency | Назначение |
|---|---|---|---|---|
| `core.raw-events` | `IngestService` (meeting-adapter, tracker-adapter, telegram-adapter, email-adapter, **mail-inbound** T5) | `block-ingest.worker` | 4 | Универсальный ingest в knowledge-core |
| `core.block-distill` | `block-ingest.worker` | `block-distill.worker` | 2 | Дистилляция блоков |
| `core.block-linker` | cron / on-event | `block-linker.worker` | 1 | KNN+LLM граф знаний |
| `core.entity-resolve` | `block-distill.worker` | `entity-resolver.worker` | 1 | Слияние Entity |
| `core.theme-clusterer` | cron 15 * * * * | `theme-clusterer.cron` | — | KNN-greedy кластеры тем |
| `core.specialist-routing` | `block-distill.worker`, on-event | per-specialist (`3-1-regulations`, `3-2-knowledge-clone`, `3-3-decisions`, `3-4-project-customer`, `3-5-insights`, `3-6-ideas`, `3-8-helpfulness`, `3-13-sprint-helper`, `3-14-goals`, `tracker-ingest`) | 2-4 | Маршрутизация в специалистов слоя 3. Sprint helper (2026-05-27) использует ту же очередь с jobName `3-13-sprint-helper`, payload `SprintHelperJobData{cycleId, tenantId, reason}`, concurrency=1, jobId-дедуп по cycleId. **Goals (2026-06-02):** jobName `3-14-goals`, concurrency 2, триггер — блоки с `signalType ∈ {commitment, plan_item}` (НЕ decision); авто-добыча целей (`extract → KNN-dedup → hierarchy-арбитр → create`). См. [[sprints]], [[goals-and-strategic-alignment]] §«Goals OKR v2». |
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
| **`core.feedback-digest` (2026-05-25)** | `feedback-digest.cron` (`0 1 * * *` UTC) + ручной `POST /admin/feedback/digest/run` | `feedback-digest.worker` | 1 | Ночной AI-прогон по `FeedbackMessage`: кластеризация в `FeedbackTopic` через taskType `feedback-cluster` (DeepSeek V4 Pro). Redis-lock `feedback:digest:lock` (TTL 30 мин). Глобальная фича (без tenant). См. [[feedback]]. |
| **`core.specialists-combined` (Фаза 6 §3, 2026-05-26)** | `block-distill.worker` (после canonical-блока, если `SPECIALISTS_COMBINED_ENABLED=true`) | `specialists-combined.worker` (`SpecialistsCombinedWorker`) | 2 | Б+ объединённый вызов: один LLM (`knowledge-specialists-combined`, DeepSeek V4 Pro) извлекает 8 типов сущностей сразу — decisions / ideas / insights / experiments / regulations / knowledge_categories / skill_traits / helpfulness_traits. Параллельно со старой `core.specialist-routing` (A/B). ~3.7× дешевле по эвалу `judge-specialists-bplus-vs-g`. Флаг `SPECIALISTS_COMBINED_ENABLED` (default off). |
| **`onboarding.demo-seed` (ТЗ 2026-05-31)** | `OnboardingService.completeWelcome` (после welcome-онбординга, если `!demoWorkspaceSeededAt`) | `demo-seed.worker` (`DemoSeedWorker`) | 2 | Авто-заливка демо-кабинета «ТехноСтрим» новой Org. jobId=`demo-seed:<orgId>` (идемпотентно). Precondition: `Subscription.status==='DEMO'` (иначе skip). Делегирует в `seedDemoWorkspace`. См. [[onboarding-wizard]]. |
| **`onboarding.demo-cleanup` (ТЗ 2026-05-31)** | `SubscriptionActivatedListener` (on-event `billing.subscription.activated_paid`/`_bonus`, если `demoWorkspaceSeededAt!=null`) | `demo-cleanup.worker` (`DemoCleanupWorker`) | 1 | Авто-стирание демо-данных при первой оплате (DEMO→ACTIVE). jobId=`demo-cleanup:<orgId>`. Делегирует в `resetDemoWorkspace` (удаляет только `externalSource='demo'`); `no_demo_to_reset` = success-skip. См. [[onboarding-wizard]]. |
| **`recording.faststart` (ТЗ 2026-06-03 recording-reliability, Фаза 3)** | webhook `egress_ended`(composite) через `AiQueueService.enqueueRecordingFaststart`, если `RECORDING_FASTSTART_ENABLED` (дефолт ON) **и** размер composite ≥ `RECORDING_FASTSTART_MIN_BYTES` (50 МиБ) | `faststart.worker` (`FaststartWorker`, `recordings/workers/`) | 1 | Переупаковка composite MP4 в faststart (`ffmpeg -c copy -movflags +faststart`) → перезалив по тому же S3-ключу. jobId=`faststart_<meetingId>` (dedup). Идемпотентно/безопасно. Воркер повторно гейтит по `bytesTotal` ≥ порога. См. [[recording]]. |

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
| **`goal-kr-progress` (Goals OKR v2, 2026-06-02)** | `0 5 * * *` (05:00 UTC) | `goals/cron/goal-kr-progress.cron.ts` | `GoalKrProgressCron` — авто-прогресс Key Results. Per-Org/per-goal try/catch, только `status='active'` + `validUntil=null`. По `sourceKind`: `meeting_count`→`meeting.count(completed)`, `issue_rollup`→`issue.count(state.category=completed, goalId)`, `metric_entity`→`Entity.mentionsCount`, `manual`→skip. Checkpoint(recordedBy='auto') только при изменении значения. **M0:** уважает `manualOverride` (`currentValue`∈KR / `progressStatus`∈Goal). `progressStatus` по тренду 14д. Метрика `goal_kr_autoprogress_total{source_kind,status}`. См. [[goals-and-strategic-alignment]]. |
| **`goals-pulse` (Goals OKR v2, 2026-06-02)** | `0 6 * * 1` (пн 06:00 UTC = 09:00 МСК) | `goals/cron/goals-pulse.cron.ts` | `GoalsPulseCron` — еженедельный пульс целей. Идемпотентно по `(tenantId, isoWeek)` в `WeeklyGoalsPulseDigest`. Агрегат счётчиков по `progressStatus` + LLM `goals-pulse-summarize` (сухой fallback). Доставка `owner`/`coo` через `ConversationalService.sendNotification(eventType='goals.pulse')`. Тумблеры `AdminSetting.goals.pulse.enabled` (default true) / `goals.pulse.deliver_to_telegram` (default false). Метрики `goals_pulse_{generated,failed,delivered}_total`. |
| `telegram-digest` | `0 9 * * *` | tracker Wave 3 | Telegram дайджест моих задач |
| **`telegram-proxy-health` (2026-05-26)** | `*/<TELEGRAM_PROXY_HEALTH_INTERVAL_SEC> * * * * *` (default 30с) | `conversational/adapters/telegram-bot/telegram-proxy-health.cron.ts` | Пингует прокси `telegram.crossmark.ru`, пишет `tg:proxy:healthy` в Redis (читает `AdminTelegramBotService.getSettings`). Лидер-выбор через `SET NX EX`. Метрика `telegram_proxy_health_check_total{outcome}`. ТЗ: plans/tz/2026-05-26-telegram-via-crossmark-proxy.md. |
| `cycle-rollover` | (на end of cycle) | tracker | Auto-rollover незакрытых задач |
| **`imap-poll` (T5)** | `MAIL_INBOX_POLL_CRON` default `*/2 * * * *` | `mail-inbound/cron/imap-poll.cron.ts` | **Финальный handoff 2026-05-25.** IMAP fetch unseen → парсит → routing на Project |
| **`operations-weekly-digest` (β-8.1)** | `0 * * * *` (фильтр по `Org.timezone`, понедельник `COO_WEEKLY_DIGEST_LOCAL_HOUR`) | `operations/workers/operations-weekly-digest.cron.ts` | Идемпотентно по `(tenantId, weekStart)`. Отправка `coo+owner` через `ConversationalService` (eventType `operations.weekly_digest`). |
| **`commitment-followup` (β-8.2)** | `0 * * * *` (фильтр по `Org.timezone`, `COMMITMENT_FOLLOWUP_LOCAL_HOUR` default 9) | `operations/workers/commitment-followup.cron.ts` | Ищет `commitmentStatus='open'` со сроком прошедшим (+1 рабочий день через `HolidayService`) → `ProbeService.suggest(reason='commitment.followup')`. Эскалация ролям `coo`/`owner` после `COMMITMENT_ESCALATION_DAYS` молчания. |
| **`operations-daily-digest` (β-8.3)** | `0 22 * * *` UTC (= 01:00 МСК, час настраивается `COO_DAILY_DIGEST_HOUR_UTC`) — **глобальный, не per-Org** | `operations/workers/operations-daily-digest.cron.ts` | Идемпотентно по `(tenantId, dateLocal)` в окне 1 день МСК. Двухстадийная сборка (агрегат → LLM taskType `operations-daily-digest`). Тумблер `AdminSetting.operations.daily_digest.enabled` (+ kill-switch ENV `COO_DAILY_DIGEST_ENABLED`). Отправка в Telegram **только `coo+owner`** (admin исключён) через `ConversationalService.sendNotification(eventType='operations.daily_digest')` — гейтится `AdminSetting.operations.daily_digest.deliver_to_telegram` (default false). |
| **`feedback-digest` (2026-05-25)** | `0 1 * * *` UTC — **глобальный, не per-Org** | `feedback/workers/feedback-digest.cron.ts` | Producer ночного job'а в очередь `core.feedback-digest`. Сам `runDigest()` берёт Redis-lock `feedback:digest:lock` (SET NX EX 1800), забирает батч `FeedbackMessage` (`processedAt=null AND failedRuns<3`, take 1000), зовёт LLM `feedback-cluster` с 2 попытками, транзакционно создаёт `FeedbackTopic` + `FeedbackItem` + `processedAt=now()`. Метрики `feedback_digest_runs_total{result}` + 3 счётчика. См. [[feedback]]. |
| **`checkin-sentiment-batch` (Фаза 2 §6, 2026-05-26)** | `*/5 * * * *` каждые 5 минут | `operations/workers/checkin-sentiment-batch.cron.ts` | `CheckinSentimentBatchCron` забирает накопленные вечерние чек-ины с `sentiment=null` и обрабатывает одним LLM-батчем `checkin-sentiment-batch` (DeepSeek-flash → gpt-5.4-mini → qwen3.5:9b). Заменяет per-event `CheckinSentimentAnalyzerWorker` для экономии токенов и стабильного RPS — старый воркер можно выключить флагом. `max_tokens` поднят пропорционально размеру батча. **Покрыт unit-тестами 2026-05-26** (см. ниже §«Тесты CheckinSentimentBatchCron»). |
| **`sprint-helper-cron` (2026-05-27)** | `0 */4 * * *` (каждые 4 часа) | `knowledge-core/workers/sprint-helper.cron.ts` | `SprintHelperCron` находит активные циклы (`completedAt IS NULL AND endDate >= now`, cap=50) и enqueue `3-13-sprint-helper` в `core.specialist-routing`. Воркер `SprintHelperWorker` собирает контекст (issues + carryOver + last activity + sourceBlockIds → blocks + история подсказок 7д) и вызывает LLM `sprint-helper-suggest`. См. [[sprints]]. |
| **`recording-track-reconcile` (ТЗ 2026-06-03 recording-reliability, Фаза 1)** | `*/1 * * * *` | `recordings/cron/recording-track-reconcile.cron.ts` | `RecordingTrackReconcileCron` — pull-сверка per-track аудиодорожек. Проходит по `Recording.status ∈ {requested,recording}` (take 50) → `RecordingsService.reconcileTrackEgress`: `listParticipants` → для `kind=STANDARD`+`TrackType.AUDIO` догоняет недостающие track-egress. Kill-switch `RECORDING_TRACK_RECONCILE_ENABLED` (дефолт ON). Идемпотентность: in-process Set-lock + DB-дедуп. Метрика `recording_track_egress_failed_total`. См. [[recording]]. |
| **`curation-autotune` (Часть A, 2026-06-03)** | `0 3 * * *` | `curation/workers/curation-autotune.cron.ts` | `CurationAutotuneCron` — лестница доверия. **kill-switch (всегда активен):** если `provisionalWrongRate` (из `getProvisionalAuditStats` — доля аудит-выборок с финалом reject/mark_as_misleading/supersede) > `maxProvisionalOverride` и данных достаточно → `provisionalThresholdByType[type]=1.01` (тип возвращается к человеку). **автоподстройка (opt-in `autotuneEnabled`, default false):** двигает `autoThresholdByType` по override-rate в пределах guardrail'ов (`thresholdMin/Max`, `autotuneStep`, `minDecisionsForAutotune`). Все сдвиги порогов — через `updateSettings` + `AuditLogService.log` (`curation.kill_switch` / `curation.autotune`). Метрики `curation_kill_switch_total`, `curation_autotune_adjustment_total`. См. [[curation]]. |

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
- **2026-05-25 (β-8.3):** добавлен глобальный cron `operations-daily-digest` (`0 22 * * *` UTC = 01:00 МСК) + сервис `DailyDigestService` (двухстадийная сборка). См. [`plans/tz/2026-05-25-sba-beta-8-3-coo-daily-and-doelka.md`](../../plans/tz/2026-05-25-sba-beta-8-3-coo-daily-and-doelka.md).
- **2026-05-26 (миграция LLM на DeepSeek V4 Pro, Фазы 0-8):** добавлен `CheckinSentimentBatchCron` (`*/5 * * * *`, batch-режим вместо per-event) и `SpecialistsCombinedWorker` на новой очереди `core.specialists-combined` (Б+ объединённый вызов 8 сущностей одним LLM, флаг `SPECIALISTS_COMBINED_ENABLED`). См. [`plans/tz/2026-05-25-llm-architecture-changes-from-experiments.md`](../../plans/tz/2026-05-25-llm-architecture-changes-from-experiments.md).
- **2026-05-26 (follow-up Задача 1 + Задача 3):** добавлены unit-тесты `CheckinSentimentBatchCron` + парсера (8 + 10 кейсов) и откатный скрипт миграции LLM (см. ниже).
- **2026-06-02 (Goals OKR v2):** в `core.specialist-routing` добавлен consumer `3-14-goals` (авто-добыча целей, триггер commitment+plan_item). Новые cron'ы `goal-kr-progress` (`0 5 * * *`, авто-прогресс KR) и `goals-pulse` (`0 6 * * 1`, еженедельный пульс целей через `ConversationalService`). См. [[goals-and-strategic-alignment]] §«Goals OKR v2», ТЗ `plans/tz/2026-06-02-goals-okr-v2.md`.

## Тесты CheckinSentimentBatchCron (2026-05-26)

**Источник:** [`plans/tz/2026-05-26-checkin-batch-cron-tests.md`](../../plans/tz/2026-05-26-checkin-batch-cron-tests.md). Закрытие gap из Фазы 2 миграции LLM.

- `checkin-sentiment-batch.cron.spec.ts` — 8 кейсов (батчинг 25→10+10+5, отсутствие tool_calls, невалидные элементы с подсчётом скипов, `sentimentEnabled=false`, окно 60 минут, два tenant, дубликат checkInId, пустой findMany).
- `checkin-sentiment.prompt.spec.ts` — 10 кейсов (валидный, невалидный input ×5, results не массив ×4, невалидный enum, не-строковой checkInId, rationale ×3, пустой results, дубликат checkInId). Итого 18 passed.

**Поведенческие решения** (2026-05-26):
- Silent skip невалидных элементов парсером + инкремент `coo_sentiment_failed_total{reason="invalid_element"}` на каждый пропуск — видимость без падения батча.
- Throw на дубликат `checkInId` в парсере + внешний try/catch cron'а считает весь батч failed (дубликат = модель сглючила, всему батчу веры нет).

**Расширение `BusinessMetricsService`:** `cooSentimentFailedTotal` получил опц. label `reason` (`'invalid_element' | 'other'`), default `'other'` — обратная совместимость со всеми существующими вызовами. Cardinality `2 × ≤101 tenant_top = ≤202 series` (безопасно).

## Скрипт отката миграции LLM на DeepSeek-Pro (2026-05-26)

**Источник:** [`plans/tz/2026-05-26-llm-migration-smoke-checklist.md`](../../plans/tz/2026-05-26-llm-migration-smoke-checklist.md) §5.

`backend/scripts/patch-rollback-to-deepseek-flash.ts` — идемпотентный массовый откат taskType'ов с `deepseek-v4-pro` на `deepseek-v4-flash` при инциденте после миграции (Фаза 4 ТЗ архитектурных изменений).

**Цели (26):**
- `ROLLBACK_TARGETS` (20) — зеркало `patch-mass-migrate-to-deepseek-pro`: merge (9) + cron (5) + formulate (3) + chat (1) + rollup (1) + classifier (1).
- `EXTRA_TARGETS` (6) — chat-v2 + 5 dialog-layer (chat-v2 Фаза 4).
- **Закомментированы:** `clone-respond-v2`, `knowledge-specialists-combined` (под флагами `CLONE_V2_ENABLED` / `SPECIALISTS_COMBINED_ENABLED`, выключаются ENV'ом, а не откатом провайдера).

**Идемпотентность:**
- `editedByAdmin=true` → skip всегда (не перебиваем ручную правку через UI `/admin/llm/routes`).
- Already `deepseek-flash` → ok, без записи.
- Not-found → skip (не создаём новые записи).
- Без `--update-existing` → no-op (защита от случайного запуска).
- Повторный запуск после успешного отката = no-op.

**Флаги:** `--dry-run`, `--update-existing`, `--task <name>` (один taskType для отладки). Работает только с `tenantId=null` (глобальные дефолты); per-tenant откат — отдельный сценарий через `/admin/llm-routes`.

[[../index|← index]]
