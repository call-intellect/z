# Накопительная prod-инструкция — Z / Кора

> **Назначение.** Единый реестр операций, которые нужно выполнить на проде после очередного push в `dev` / `main`.
> Каждый push, который требует операций (миграция БД, seed, patch, новые ENV, рестарт), **обязан** добавить запись в раздел [🚨 Накоплено к выкату](#-накоплено-к-выкату).
> После реального выката на прод накопленный блок переезжает в [📂 Архив применённых](#-архив-применённых).
>
> **Прод-программист:** открой раздел «Накоплено к выкату», иди сверху вниз — это твоя готовая копи-пейст-инструкция.
> **Агент (Claude):** правила обновления см. в [🔄 Правила поддержки файла](#-правила-поддержки-файла) и в `CLAUDE.md` → «Триггер 1: после `git push`».

---

## 🚨 Накоплено к выкату

**Окно:** 2026-05-20 .. 2026-05-26 (с момента последнего prod-cut).
**Источник:** все рефлексии в `second-brain/05_история/` с этой даты + git log dev.
**Содержит:** ~80 prod-скриптов (patch/seed/migrate/backfill/setup) + ~165 новых Prisma-моделей + ~100 новых ENV (все опциональные) + 2 опасных schema-изменения.

---

### Шаг 0 — Pre-flight (один раз перед выкатом)

**0.1. Apache AGE extension** — критичный блокер.
`apply-postgres-init` (Шаг 4) создаёт `CREATE EXTENSION age` и `ag_catalog.create_graph('z_graph')` для онтологии компании (Фаза 0). Если кластер PostgreSQL **не настроен под AGE — Шаг 4 упадёт** с `extension "age" is not available`.

Что сделать ДО выката:
- Yandex Cloud Managed PostgreSQL 16 / SberCloud / Selectel Managed: в настройках кластера прописать `shared_preload_libraries = 'age'` → рестарт инстанса.
- Self-hosted: composite-образ с AGE; см. `infra/postgres/Dockerfile` (если есть) или собрать вручную.
- Проверить: `psql -c "SHOW shared_preload_libraries"` → должно содержать `age`.

См. `second-brain/02_architecture/age-deployment-decision.md`.

**0.2. Бэкап БД** — обязательно перед `prisma:push` (Шаг 3) и `patch-*` (Шаг 5).

**0.3. ENV** — см. Шаг 1.

---

### Шаг 1 — ENV (новые ключи за период)

Все ENV, добавленные за окно, **опциональны (имеют дефолты)** — backend стартует без них. Но рекомендованный минимум для прода:

```bash
# === Conversational channels β-9 (2026-05-25) — глобальный Telegram-бот ===
KORA_BOT_USERNAME=kora_bot          # без @, для deep-link
INVITE_TTL_DAYS=14
INVITE_REMINDER_DAYS=7
MAGIC_LINK_TTL_MINUTES=15
MAGIC_LINK_RATE_LIMIT_PER_HOUR=5
INACTIVE_BINDING_DAYS=30

# === Web Push (если включается push-уведомления) ===
# ВНИМАНИЕ: VAPID_* НЕ в EnvSchema → опечатки не валидируются zod'ом, фича просто молча отключится.
VAPID_PUBLIC_KEY=<сгенерировать: bunx web-push generate-vapid-keys>
VAPID_PRIVATE_KEY=<...>
VAPID_SUBJECT=mailto:noreply@kora.app
PUSH_MAX_FAILURES=5
# Frontend (.env.production) — тот же public key:
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<тот же public>

# === Email-to-task (T5, опц., default OFF) ===
MAIL_INBOX_ENABLED=false                 # включить ТРЕБУЕТ заполнения остальных
MAIL_INBOX_DOMAIN=inbox.kora.app
MAIL_INBOX_IMAP_HOST=imap.kora.app
MAIL_INBOX_IMAP_PORT=993
MAIL_INBOX_IMAP_USER=inbox@kora.app
MAIL_INBOX_IMAP_PASS=<secret>
MAIL_INBOX_IMAP_TLS=true
MAIL_INBOX_IMAP_FOLDER=INBOX
MAIL_INBOX_POLL_CRON=*/2 * * * *
MAIL_INBOX_MAX_PER_RUN=50

# === T3 LLM провайдеры (kie + grsai) ===
KIE_API_KEY=<secret>
GRSAI_API_KEY=<secret>
# KIE_BASE_URL и GRSAI_BASE_URL имеют дефолты — править только при кастомных эндпоинтах

# === Kill-switch'и для безопасного запуска (все уже false по умолчанию — можно не дублировать) ===
BITEMPORAL_ENABLED=false                 # KC-Temporal — поэтапное включение
BITEMPORAL_SUPERSEDE_ENABLED=false
CLONE_V2_ENABLED=false                   # clone-respond v2
SPECIALISTS_COMBINED_ENABLED=false       # Variant Б+
COO_DAILY_DIGEST_DELIVER_TO_TELEGRAM=false

# === Опционально включить уже — но проверь dataclass enforcement ===
DATACLASS_POLICY_ENFORCEMENT=shadow      # off | shadow | enforce — на проде сначала shadow
```

Полный список новых ENV (домены: LLM, Channels, Email, COO, Tracker, KC-Temporal, Skill/Clone, Curation, Dialog Layer, Push, Voice) — в `backend/src/common/config/env.schema.ts`. Часть ENV (VAPID_*, CONCIERGE_*) **сознательно вне EnvSchema** из-за TS2589 при глубоких .merge() — читаются runtime'ом через `process.env`.

---

### Шаг 2 — Pull + install

```bash
cd c:/work/z
git pull origin dev
cd backend && bun install
cd ../frontend && bun install
cd ../backend
```

---

### Шаг 3 — PRE-MIGRATION gate (защитный backfill ДО prisma:push)

`prisma:push` ниже сделает `Meeting.tenantId` NOT NULL. Если есть legacy-Meeting с NULL — push упадёт. Сначала чиним:

```bash
bun run scripts/backfill-orgs-fase0.ts                  # создаёт personal-Org для legacy users (если ещё не запускалось)
bun run scripts/backfill-meeting-tenant-id.ts           # dry-run по умолчанию
bun run scripts/backfill-meeting-tenant-id.ts --apply   # реальный прогон
bun run scripts/tighten-meeting-tenant-not-null.ts      # exit 1 если остался хоть один NULL — это GATE
```

Если `tighten-*` падает → разбирайся, не запускай Шаг 4 пока не вернёт 0.

---

### Шаг 4 — Prisma schema (несколько опасных моментов)

```bash
bun run prisma:push
bun run prisma:generate
```

⚠️ **`prisma:push` спросит подтверждение на:**
1. **DROP колонки `Transcript.rawIndexS3Url`** (NOT NULL) — данные перенесены в новую модель `TranscriptTrack`. Согласиться `--accept-data-loss` (если попросит). Перед этим убедиться, что нет внешних потребителей S3-ключа из этой колонки.
2. **`Meeting.tenantId` → NOT NULL** — gate из Шага 3 должен был всё прибрать. Если не сработал — вернись.

Что нового в схеме (за окно ~165 новых моделей):
- Kora-v2 фундамент: AdminSetting, EmailTemplate, RetentionPolicy, CronSchedule, FeatureFlag
- knowledge-core graph: Decision, Insight, Idea, IdeaCluster, IdeaBlockLink, EntityLink, Interaction
- Tracker (~20 моделей): Issue, IssueState, IssueComment, IssueAttachment, IssueLink, IssueRelation, IssueWebhook, IssueWebhookLog, IntakeIssue, Project, ProjectMember, Label, Cycle, Plan, ImportLog, HolidayCalendar
- Company Foundation (Фаза 0): Person, Role, Department, JobDescription, Document, Mission, Vision, Strategy, Process, ProcessStep, Regulation, Policy, Tool, Metric, Market, OrgUnit, Vendor, CompanyProfile, FunctionalDomain, Appointment, RoleProfile
- Skill / Clone (γ-1): Skill, SkillProfile, SkillTrait, SkillTraitCategory, SkillTraitConcept, ExecutablePersona, PersonKnowledgeCategoryEmbedding, CloneAccessGrant
- AI/LLM Admin: LlmProvider, LlmModel, LlmModelExperiment, LlmTaskRouteChange, PromptTemplate, PromptTemplateVersion, AiResultFeedback, AiCostDaily, OrgBudgetCap, CurrencyRate
- Meetings/Curation: TranscriptTrack, MeetingBehaviorMetrics, MeetingQualityScore, MeetingReport, CurationItem, CardVersion, CompletenessSlot
- Operations β: Experiment, DailyCheckIn, DailyOperationsDigest, WeeklyOperationsDigest, ProactiveNotification, ProbeEvent
- Gamification: ActivityFeedItem, Recognition, HelpfulnessTrait, HelpfulnessSpotlight, Badge, UserBadge, TeamTemplate
- Channels: Channel, ChannelBinding, Notification, NotificationDelivery, MailInboundLog, ChatV2Conversation, ChatV2Message
- Calendar (MVP): Event, EventParticipant, EventReminder
- Concierge / Push: ConciergeConversation, ConciergeMessage, OrgConciergeQuota, OrchestratorRun, PushSubscription

Расширение существующих:
- `Meeting`: +linkedIssueId, +reportFastStatus, +recordByDefault, +behaviorMetricsStatus, +qualityScoreStatus
- `Transcript`: +turns(Json), +roomChat, +cleanedS3Url, +cleaningStatus; **DROP rawIndexS3Url**
- `AiResult`: +summaryFast, +promptTemplateVersionId, +experimentGroup
- `AiUsageLog`: +inputCostPerMillionTokensSnapshot, +costRub, +dataClassAudit
- `Task`: +assigneeUserId (FK на User)
- `User`: +calendarFeedToken (VarChar 80)

Enum расширения (без удалений — Postgres не умеет DROP VALUE):
- `MeetingType`: +review, +retrospective, +task_discussion
- `SignalType`: +30 значений (task_*, helpfulness, gamification, reasoning, plan_item, …)
- `EntityType`: +customer, +vendor, +document, +goal, +event, +technology, +metric, +market, +org_unit (client/custom помечены @deprecated)
- `EntityLinkType`: +30 значений
- `IdeaBlockLinkType`: +resolves, +supersedes
- `MembershipRole`: +coo
- `SourceType`: +conversational, +tracker_event
- `VerificationPurpose`: +magic_link, +invite_accept
- ~50 новых enum-типов целиком

---

### Шаг 5 — Postgres-init (HNSW + GIN + partial unique + AGE graph)

```bash
bun run apply-postgres-init
```

Что создаст (всё через `IF NOT EXISTS`, идемпотентно):
- **Extensions:** `vector`, `age` (+ `LOAD 'age'`, `SET search_path`)
- **Graph:** `ag_catalog.create_graph('z_graph')`
- **HNSW (cosine) на embedding-колонках:** Decision, Insight, Idea, IdeaCluster, SkillTrait, SkillTraitConcept, PersonKnowledgeCategoryEmbedding, HelpfulnessTrait, Issue, MeetingTranscriptChunk, IdeaBlock, Entity
- **GENERATED tsvector + GIN (словарь `russian`):** IdeaBlock.search_tsv, decisions.decision_search_tsv, insights.insight_search_tsv
- **GIN на массивах:** Event.participantsPersonIds, Vendor.contractIds, decisions/insights/ideas/EntityLink.* массивы IDs
- **Partial unique индексы (Prisma не умеет):**
  - `meeting_report_pending_unique` ON MeetingReport (meetingId, promptTemplateId) WHERE status IN ('pending','running')
  - `Vendor_tenantId_inn_unique_idx` ON Vendor (tenantId, inn) WHERE inn NOT NULL AND deletedAt NULL
  - `Entity_strong_inn_uniq`, `Entity_strong_ogrn_uniq`, `Entity_strong_email_uniq`, `Entity_strong_domain_uniq` (KC-Temporal W3.4)
  - `channels_global_unique` ON channels (kind) WHERE tenantId NULL — для β-9 глобального Telegram-бота
- **Composite:** probe_events_tenant_status_created_idx, Entity_strong_phone_idx (не unique)

---

### Шаг 6 — One-off patch-скрипты (порядок важен!)

```bash
# 6.1 — Knowledge-core: переименования + entityId
bun run scripts/patch-rename-client-to-customer.ts --dry-run
bun run scripts/patch-rename-client-to-customer.ts
bun run scripts/patch-migrate-entity-custom-to-topic.ts
bun run scripts/patch-backfill-entity-id-document.ts
bun run scripts/patch-backfill-entity-id-goal.ts
bun run scripts/patch-backfill-entity-id-person.ts
# либо composite alias (запускает все три выше):
# bun run patch:backfill-entity-id
bun run scripts/patch-person-relationship.ts

# 6.2 — Card versioning + document defaults
bun run scripts/patch-backfill-card-versions.ts
bun run scripts/patch-document-use-cases-default.ts

# 6.3 — Org / Person timezone (Europe/Moscow по умолчанию)
bun run scripts/patch-org-timezone-default.ts
bun run scripts/patch-person-timezone-default.ts

# 6.4 — Mission/Vision/Strategy → CompanyProfile (по умолчанию dry-run!)
bun run scripts/patch-migrate-mvs-to-company-profile.ts            # dry-run
bun run scripts/patch-migrate-mvs-to-company-profile.ts --apply    # запись

# 6.5 — PersonRole → Appointment (по умолчанию dry-run!)
bun run scripts/patch-migrate-person-role-to-appointment.ts            # dry-run
bun run scripts/patch-migrate-person-role-to-appointment.ts --apply    # запись

# 6.6 — Skill traits категории (γ-1)
bun run scripts/patch-skill-trait-categories-from-strings.ts --dry-run
bun run scripts/patch-skill-trait-categories-from-strings.ts

# 6.7 — KC-Temporal (bitemporal + dataclass + strong-ids + channel-binding)
bun run scripts/patch-bitemporal-backfill.ts --dry-run
bun run scripts/patch-bitemporal-backfill.ts
bun run scripts/patch-clones-role-versioning.ts
bun run scripts/patch-clones-dataclass-update.ts
bun run scripts/patch-backfill-dataclass-audit.ts
bun run scripts/patch-channel-binding-defaults.ts
bun run scripts/patch-extract-strong-ids.ts

# 6.8 — Prompt registry no-op (для будущей совместимости; сейчас ничего не пишут)
bun run scripts/patch-prompt-block-ingest-v2-fase0b.ts
bun run scripts/patch-prompt-role-profile-build-fase0d.ts

# 6.9 — LLM миграция на DeepSeek-V4-Pro (chat-v2 + 19 одиночек)
bun run scripts/patch-chat-v2-to-pro.ts
bun run scripts/patch-mass-migrate-to-deepseek-pro.ts --dry-run
bun run scripts/patch-mass-migrate-to-deepseek-pro.ts --update-existing
```

⚠️ **НЕ запускать на проде** (помечен внутри файла «без согласования»):
- `backfill-task-assignee-userid.ts`

⚠️ **Заглушка (no-op до волны 2):**
- `patch-migrate-clone-access.ts` — можно запускать, эффекта не будет.

---

### Шаг 7 — Seed-скрипты

```bash
# 7.1 — Базовый каркас LLM (порядок важен внутри: providers → models → prices → routes)
bun run scripts/seed-default-llm-providers-and-models.ts
bun run scripts/seed-llm-model-prices.ts
bun run scripts/seed-prompt-templates.ts                          # 13 системных шаблонов (A.1)
bun run scripts/seed-llm-task-routes-default.ts                   # дефолтные цепочки для всех LlmTaskType (A.4)

# 7.2 — Тарифы / Entitlements / Retention / Календарь / Шаблоны команд / Домены
bun run scripts/seed-entitlements.ts                              # OrgEntitlement(tier_pro) per Org
bun run scripts/seed-retention-policies.ts
bun run scripts/seed-holiday-calendar-ru-2026.ts                  # производственный календарь РФ
bun run scripts/seed-team-templates.ts                            # 10+5 системных TeamTemplate
bun run scripts/seed-functional-domains.ts                        # 8 базовых FunctionalDomain per Org

# 7.3 — Admin settings (синк cfg.* → AdminSetting)
bun run scripts/seed-admin-settings.ts
bun run scripts/seed-admin-setting-daily-digest.ts                # operations.daily_digest.enabled/deliver_to_telegram

# 7.4 — Бейджи (gamification T1)
bun run scripts/seed-badges.ts                                    # 5 базовых (ideator/expert/helper/aligned/consistent)

# 7.5 — Глобальный Telegram канал (β-9)
bun run scripts/seed-global-channels.ts

# 7.6 — LLM TaskRoutes для всех новых taskType (за период, безопасно идемпотентно)
bun run scripts/seed-llm-task-routes-phase-B.ts                   # behavior-refine
bun run scripts/seed-llm-task-routes-phase-C.ts                   # meeting-quality-score
bun run scripts/seed-llm-task-routes-phase-D.ts                   # transcript-clean-refine
bun run scripts/seed-llm-task-routes-phase-E.ts                   # custom-report
bun run scripts/seed-llm-task-routes-regulations.ts
bun run scripts/seed-llm-task-routes-knowledge-clone.ts
bun run scripts/seed-llm-task-routes-knowledge-core.ts
bun run scripts/seed-llm-task-routes-decisions.ts
bun run scripts/seed-llm-task-routes-insights.ts
bun run scripts/seed-llm-task-routes-ideas-and-probe.ts
bun run scripts/seed-llm-task-routes-skill-and-clone.ts
bun run scripts/seed-llm-task-routes-skill-concept.ts             # skill-trait-concept-name
bun run scripts/seed-llm-task-routes-chat-v2.ts                   # chat-v2-conversation-title, chat-v2-cite-select
bun run scripts/seed-llm-task-routes-recognition.ts               # recognition-formulate
bun run scripts/seed-llm-task-routes-helpfulness.ts               # 3 helpfulness taskType
bun run scripts/seed-llm-task-routes-beta-8.ts                    # checkin-parse, operations-summary
bun run scripts/seed-llm-task-routes-beta-8-1.ts                  # checkin-sentiment(+batch), operations-weekly-digest
bun run scripts/seed-llm-task-routes-beta-8-2.ts                  # commitment-extract-dates/status
bun run scripts/seed-llm-task-routes-beta-8-3.ts                  # operations-daily-digest
bun run scripts/seed-llm-task-routes-axis-classify.ts             # axis-classify, router-fallback
bun run scripts/seed-llm-task-routes-brand-voice.ts
bun run scripts/seed-llm-task-routes-company-foundation.ts        # department-extract, domain-expand, maturity-rationale
bun run scripts/seed-llm-task-routes-concierge.ts                 # concierge-respond, concierge-toolcall-validate
bun run scripts/seed-llm-task-routes-cross-functional.ts          # cross-functional-friction-summary
bun run scripts/seed-llm-task-routes-experiments.ts
bun run scripts/seed-llm-task-routes-process-template.ts
bun run scripts/seed-llm-task-routes-role-map.ts                  # role-map-extract, role-completeness-rationale
bun run scripts/seed-llm-task-routes-orchestrator.ts              # 4 orchestrator-*
bun run scripts/seed-llm-task-routes-proactive.ts                 # proactive-message-craft
bun run scripts/seed-llm-task-routes-tracker-phase3.ts            # meeting-extract-actions, intake-auto-triage
bun run scripts/seed-llm-task-routes-tracker-phase3-c.ts          # issue-infer-fields, issue-goal-suggest
bun run scripts/seed-llm-task-routes-tracker-phase4-telegram.ts   # telegram-create-task и др. (4 шт.)
bun run scripts/seed-llm-task-routes-feedback-cluster.ts          # feedback.cluster (4 уровня)
bun run scripts/seed-llm-task-routes-clone-v2.ts                  # dialog-multi-query-clone, clone-respond v2 → deepseek-v4-pro
bun run scripts/seed-llm-task-routes-specialists-combined.ts      # knowledge-specialists-combined (Variant Б+)
bun run scripts/seed-llm-task-routes-dialog-layer.ts              # 5 dialog-* taskType
bun run scripts/seed-llm-task-routes-temporal.ts                  # fact-supersede-detect
bun run scripts/seed-llm-task-routes-kie-grsai-ab.ts              # A/B на dialog-multi-query (status=draft)

# 7.7 — Глобальный default: DeepSeek-V4-Pro primary на ВСЕ taskType
bun run scripts/seed-llm-default-primary-deepseek-pro.ts
# Если хочешь перебить уже существующие primary (gpt-4o, deepseek-v4-flash и т.п.):
# bun run scripts/seed-llm-default-primary-deepseek-pro.ts --update-existing
```

ℹ️ Большинство `seed-llm-task-routes-*` принимают `--update-existing` — без него существующие записи не трогаются. Защита `editedByAdmin` блокирует затирание ручных правок админа везде.

---

### Шаг 8 — Backfill (после schema + seed)

```bash
bun run scripts/backfill-meeting-sources-fase1.ts                 # дефолтный Source(type=meeting) per Org
bun run scripts/backfill-entity-link-types-fase0.ts               # EntityLink.fromType/toType → 'entity'
bun run scripts/backfill-commitment-due-dates.ts --dry-run
bun run scripts/backfill-commitment-due-dates.ts                  # β-8.2: проставить open + срок для legacy commitment'ов

# Опционально (дорого по LLM-quota):
bun run scripts/skill-trait-concepts-backfill.ts
bun run scripts/person-knowledge-embeddings-backfill.ts --dry-run
bun run scripts/person-knowledge-embeddings-backfill.ts

# НЕ запускать (помечен «без согласования»):
# bun run scripts/backfill-task-assignee-userid.ts
```

---

### Шаг 9 — Миграции (β-9 Telegram + Tracker legacy Task)

```bash
# β-9: per-tenant Telegram-каналы → один глобальный
bun run scripts/migrate-telegram-channels-to-global.ts --dry-run
# Изучи output (cases A/B/C/D/E). Если ок:
bun run scripts/migrate-telegram-channels-to-global.ts
# Аварийный откат: bun run scripts/migrate-telegram-channels-back.ts

# Tracker: legacy Task → Issue (по умолчанию dry-run!)
bun run migrate-task-to-issue                # alias = bun run scripts/migrate-task-to-issue.ts (dry-run)
bun run migrate-task-to-issue --apply        # реальная запись
```

---

### Шаг 10 — Per-tenant: настройка ботов

```bash
# Telegram (β-9, 2026-05-25): теперь ГЛОБАЛЬНЫЙ — один на всю инсталляцию, без --tenant-id!
bun run setup:telegram-bot -- --token=$TG_TOKEN --public-host-url=https://prod.host --webhook-secret=<секрет>

# MAX (платформа Дзен): пока per-tenant
bun run setup:max-bot -- --token=$MAX_TOKEN --tenant-id=$ORG_ID --public-host-url=https://prod.host --webhook-secret=<секрет>
```

⚠️ В старых рефлексиях `setup-telegram-bot` мог упоминаться с `--tenant-id` — **это устарело с β-9**.

---

### Шаг 11 — Build + restart (HTTP + worker — два процесса!)

```bash
cd ../frontend && bun run build
cd ../backend && bun run build

# Если backend и worker в одном compose:
docker compose up -d --build backend

# Если worker — отдельный сервис (рекомендуется в проде):
docker compose restart backend
docker compose restart worker
```

⚠️ **Воркер — отдельный процесс** (`backend/src/workers/main.ts`). Без рестарта worker'а новые BullMQ-очереди и `@Cron`'ы не подцепятся. Без рестарта backend — не подцепятся новые REST/WS-роуты.

---

### Шаг 12 — Smoke-проверка

```bash
curl https://prod.host/health
curl https://prod.host/api/docs                  # Swagger UI
```

В Swagger должны появиться разделы: **tracker, projects, issues, cycles, intake, webhooks, comments, labels, attachments, relations, team-templates, chat-v2, conversational, curation, decisions, events, ideas, insights, knowledge-clone, clones, probe, regulations, vendors, calendar (events)**.

```bash
curl https://prod.host/metrics | grep -E 'z_voice_ws|z_mail_inbound|z_llm_cache|z_prompt_injection|bullmq_'
```

Должны быть `bullmq_*` метрики под новые очереди: `probe-*, conversational-send, chat-v2-cleanup, card-stale-detector, idea-clusterer, insight-clusterer, knowledge-clone-rebuild, skill-profile-*, executable-persona-build, skill-manager-digest, tracker.webhook-delivery`.

```bash
# Hot-reload Prometheus alerts (если изменялись правила):
docker compose exec prometheus kill -HUP 1
```

---

## ⚠️ Особо опасные операции (требуют согласования владельца)

| Операция | Чем опасна | Защита |
|---|---|---|
| `prisma:push` + `--accept-data-loss` | Дроп `Transcript.rawIndexS3Url` — данные исчезнут | Данные перенесены в `TranscriptTrack` (Wave 5). Проверить отсутствие внешних потребителей S3-ключа. |
| `apply-postgres-init` без AGE в shared_preload_libraries | Падение с `extension "age" is not available` | Шаг 0.1 |
| `patch-mass-migrate-to-deepseek-pro.ts --update-existing` | Перезатирает primary провайдер у НЕ-admin-edited LlmTaskRoute | Сначала `--dry-run`, затем `--update-existing`. `editedByAdmin` защищён. |
| `seed-llm-default-primary-deepseek-pro.ts --update-existing` | Меняет primary у ВСЕХ taskType | `editedByAdmin` НЕ трогается. Использовать ТОЛЬКО если действительно хочешь сбросить ручные настройки. |
| `migrate-task-to-issue --apply` | Конвертирует legacy Task → Issue | Идемпотентен (externalSource+externalId). Сначала dry-run. Task не удаляется. |
| `backfill-task-assignee-userid.ts` | В шапке файла стоит «НЕ ЗАПУСКАТЬ НА ПРОДЕ без согласования» | Пропустить в стандартной инструкции. |

---

## 📂 Архив применённых

_(пусто — это первый накопительный документ; после первого выката переносим блок «Накоплено к выкату» сюда с датой)_

---

## 🔄 Правила поддержки файла

**Когда обновлять.** После каждого `git push` в `dev`/`main`, если push содержит:

| Что изменилось | Куда писать в разделе «Накоплено к выкату» |
|---|---|
| `backend/prisma/schema.prisma` (новая модель / nullable→NOT NULL / drop / новый enum) | Шаг 4 |
| `backend/scripts/postgres-init.sql` (HNSW / GIN / partial unique / extension) | Шаг 5 |
| Новый файл `backend/scripts/patch-*.ts` | Шаг 6 (выбрать подгруппу 6.x по теме) |
| Новый файл `backend/scripts/seed-*.ts` | Шаг 7 |
| Новый файл `backend/scripts/backfill-*.ts` | Шаг 8 |
| Новый файл `backend/scripts/migrate-*.ts` | Шаг 9 |
| Новый файл `backend/scripts/setup-*.ts` | Шаг 10 |
| `backend/src/common/config/env.schema.ts` (новая ENV) | Шаг 1 |
| Новая модель worker / cron / BullMQ-очередь | Шаг 12 (smoke: добавить в grep по `bullmq_`) |
| Новый REST/Swagger раздел | Шаг 12 (smoke: добавить в список разделов Swagger) |
| Включение нового feature flag по умолчанию | Шаг 1 («Kill-switch'и») |

**Как обновлять.**

1. После `git push` запусти у себя:
   ```
   git show --stat HEAD
   git diff HEAD~N --name-only | grep -E '(prisma/schema|scripts/(seed|patch|migrate|backfill|setup|smoke)|postgres-init\.sql|env\.schema\.ts)'
   ```
2. Для каждого попавшего файла добавь строчку в соответствующий шаг. Стиль — одна команда + комментарий: что делает / опц. флаги / опц. порядок.
3. Если переименовываешь существующий скрипт или меняешь поведение — **обнови запись inline**, не дублируй.
4. Если запись становится неактуальной (фича откатили) — удали из «Накоплено к выкату».

**Когда переносить в архив.** После триггера «выкат прошёл / прод обновили / выкатили» — целиком копируешь блок «🚨 Накоплено к выкату» в новый подраздел `## 📂 Архив применённых` → `### 2026-MM-DD — выкат N` с пометкой кто выкатил и какие были инциденты. Раздел «Накоплено к выкату» обнуляется (Pre-flight + пустой Шаг 1..12).

**Связь с рефлексией.** При записи рефлексии в `second-brain/05_история/` всегда ссылайся на этот файл («prod-инструкция обновлена → см. `docs/operations/prod-deploy-log.md`»), вместо того чтобы дублировать команды в рефлексии.
