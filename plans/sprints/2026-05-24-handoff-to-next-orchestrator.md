---
type: handoff
status: ready-for-pickup
date: 2026-05-24
from: claude-orchestrator (Opus 4.7) — сессия Sprint 1+2+3 backend + frontend scaffold
to: next-orchestrator
---

# Handoff — продолжай оркестрацию Wave 1-2 разработки Z/Кора

## Ты — оркестратор разработки продукта Z/Кора. Главная задача — продолжать писать качественный код через параллельных subagent'ов до полного закрытия Wave 1 (Phase 1-6 трекера + AI-COO + Specialist 3.8 + Activity Feeds + Recognition + α-5 DialogService).

---

## 0. Регламент работы (СТРОГО соблюдать)

Владелец 2026-05-24 явно делегировал полную ответственность:

- **Ты главный оркестратор.** Делаешь локальные коммиты сам, без подтверждения. Push — тоже сам.
- **Качество кода — приоритет.** Каждый агент должен: `bun run typecheck` зелёный, `bun run lint` без новых errors на его файлах, тесты passed где есть.
- **Pre-commit самопроверка обязательна** — typecheck/lint/тесты до `git commit`. Если красное — фиксить, не коммитить.
- **Conventional Commits + HEREDOC + Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>** — формат всех коммитов.
- **`git add` явно перечислять файлы** — НЕ `git add .` / `git add -A`. Спасает от попадания pre-сессионных файлов.
- **Параллелизация:** агенты запускаются параллельно ТОЛЬКО если трогают **разные файлы**. На `schema.prisma` — последовательно (race на `bun run prisma:push`).
- **Никогда `prisma migrate*`** — только `bun run prisma:push`. После любой правки моделей — `bun run prisma:generate`.
- **Новые поля nullable (`?`)** — backward-compat. Backfill — отдельным шагом скриптом.
- **После push — рефлексия в `second-brain/05_история/YYYY-MM-DD-...md`** автоматически (без подтверждения, исключение из CLAUDE.md правила). И обновление `second-brain/` (module-map, data-model, project-overview, index.md, заметки в 01_projects).

**Что требует подтверждения владельца (НЕ делать автономно):**
- Применение скриптов на prod (backfill, патч-скрипты с массовыми изменениями данных).
- Запуск миграций на prod.
- Apple/Google/RuStore Developer Accounts (нужны деньги + KYC).
- EAS secrets (нужны реальные DSN/URL).

---

## 1. Что уже закрыто (13 коммитов 2026-05-24)

Все запушены в `origin/dev`. Стартовая точка: `2a6108f` (последний коммит Sprint 3 frontend).

| # | Коммит | Что |
|---|---|---|
| 1 | `c5573b8` | Sprint Plan Wave 1 + 10 решений владельца |
| 2 | `6b85491` | 20 моделей Prisma + 18 SignalType |
| 3 | `79c16dd` | Tracker module scaffold (8 controllers + 8 services + 18 DTO + RBAC) |
| 4 | `d1c2159` | ENV schema + 9 Prometheus метрик |
| 5 | `cd544be` | LiveKit RNNoise активация |
| 6 | `fb1e770` | γ-1 SkillTraitCategory frontend grouping + lint fix |
| 7 | `7d5e51e` | CRIT-2 type-review/retrospective промпты + CRIT-3 backfill script |
| 8 | `4576111` | IssueRelation + Attachments S3 + start-meeting LiveKit |
| 9 | `4961db8` | WebSocket gateway + BullMQ webhook delivery HMAC retry |
| 10 | `31fd270` | β-4 causeCategory 8-категорий + LLM extraction |
| 11 | `320cc20` | second-brain обновления + рефлексия Sprint 1 |
| 12 | `3c547f7` | **TrackerAdapter** — критический закрывающий тикет «трекер = источник для второго мозга» |
| 13 | `2a6108f` | **Frontend scaffold** — 83 файла, 12 страниц на реальных данных |

**Метрика:** ~17 905 строк кода + тестов добавлено.

### Что закрыто на 100%

✅ **Sprint 1 backend** — модели Prisma (20 трекер), tracker module, ENV, метрики, LiveKit RNNoise, γ-1 frontend, CRIT verifications + 2 промпта, backfill script
✅ **Sprint 2 backend** — IssueRelation CRUD с auto-обратной, Attachments S3, start-meeting LiveKit, WebSocket /ws/tracker, BullMQ webhook delivery HMAC + retry, β-4 causeCategory
✅ **Sprint 3 backend критический путь** — TrackerAdapter с маппингом 8 событий → signalType, IssueOverdueDetectorCron, IssueStateGaugeCron, block-ingest.worker поддержка signalTypeHint, IssuesService/CommentsService эмитят события после транзакций
✅ **Frontend scaffold** — API layer (9 файлов) + Domain layer (10 файлов) + 15 SWR хуков + 19 UI компонентов + 38 страниц App Router. 12 страниц грузят реальные данные

### α-4, β-5, γ-1 — оказались УЖЕ готовы в коде на момент сессии
- α-4 CompletenessSlot + ConsistencyCheckerCron + расширение CurationDecisionType — closed до сессии
- β-5 closing-loop respond-to-probe — closed до сессии
- γ-1 SkillTraitCategory + ExecutablePersona гибрид-версионирование — 95% closed до сессии

**Главный урок (для будущей оркестрации):** перед запуском Wave 2 sub-ТЗ — обязательная разведка через `grep -rn "ModelName" backend/src/`. Reality-deltas (документ от 2026-05-22) показал 60-70% Кора v2 готово; реальный код продолжает опережать план. Минимум +3 sub-ТЗ оказались полностью готовы — экономия часов работы.

---

## 2. Что осталось до DoD Wave 1 (закрывай эти тикеты первыми)

### Sprint 3 backend завершение (3 тикета)

**B1-3.2 — Goals integration + strategic-alignment расширение** ~30-45 минут agent:
- Sub-ТЗ: `plans/tz/2026-05-23-tracker-phase-1-models-api.md` раздел «Связь с Goals».
- В `backend/src/modules/tracker/services/issues.service.ts` уже есть методы `linkGoal/unlinkGoal` — проверить что они полные (с IssueActivity).
- Расширить `backend/src/modules/goals/cron/strategic-alignment.cron.ts` (или подобный): для каждой активной Goal сосчитать сколько Issue привязано (`Goal.linkedIssues`), сколько completed (state.category=completed), сколько осталось, % времени прошло. Snapshot в `GoalAlignmentSnapshot` или `Goal.progressSnapshot Json`.
- Probe-trigger через ProbeService.suggest: если у пользователя ≥80% Issue без `goalId` → "stratgic_misalignment_high". `ProbeService.suggest({ type: 'strategic_misalignment_high', targetUserId, formulatedQuestion })`.
- Endpoint `GET /api/v1/goals/:id/alignment-snapshot`.
- Тесты unit.

**B1-3.3 — миграция legacy `Task` → `Issue`** ~45 минут agent:
- Sub-ТЗ: `plans/tz/2026-05-23-tracker-phase-1-models-api.md` раздел «Миграция legacy Task модуля».
- Скрипт `backend/scripts/migrate-task-to-issue.ts`:
  - Для каждой Org создать виртуальный `Project { slug: 'from-meetings', identifier: 'MTG', name: 'Из встреч' }`.
  - Каждый существующий `Task` → новый `Issue` с `projectId` виртуального проекта, `externalSource='meeting_legacy'`, `linkedMeetingIds=[task.meetingId]`, `title=task.title`, `description=task.description`. assignee пытаемся найти User по email/имени; если не найден — `metadata.legacyAssigneeRaw`.
- `--dry-run` (default) + `--apply` flags.
- legacy `/api/v1/tasks/*` помечается `@deprecated`, остаётся работать (frontend Phase 2 переходит на `/issues/*`).
- Идемпотентность: повторный запуск не дублирует.

**IdempotencyService общий для трекера** ~30 минут agent:
- В коде есть только `IdempotencyInterceptor` для Crossmark (`backend/src/modules/crossmark/`). Нужен общий `backend/src/common/idempotency/`:
  - `idempotency.service.ts` — Redis-based cache с TTL из ENV `IDEMPOTENCY_KEY_TTL_SECONDS` (default 86400).
  - `idempotency.middleware.ts` — читает `Idempotency-Key` header, кэширует response per key.
  - Применить к POST `/api/v1/issues`, `/issues/:id/comments`, `/intake` в tracker controllers.

### Frontend завершение (3 тикета)

**Socket.io-client интеграция в `useTrackerWebSocket`** ~30 минут agent:
- `frontend/src/hooks/tracker/useTrackerWebSocket.ts` — сейчас TODO stub.
- Добавить `socket.io-client` в `frontend/package.json` (`bun add socket.io-client`).
- Реализовать handshake с cookie `z_session`: `io('/ws/tracker', { auth: { tenantId: currentTenantId } })`.
- EventEmitter pattern: подписка на rooms `project:${projectId}` / `issue:${issueId}` через message `subscribe.project/issue`.
- Интегрировать в `useIssues`, `useIssue`, `useCycles` — auto-revalidate при WS event'ах.

**Drag-n-drop канбана через @dnd-kit/core** ~45 минут agent:
- `frontend/src/ui/tracker/Board.tsx` — добавить D&D через `@dnd-kit/core` (или `@atlaskit/pragmatic-drag-and-drop` если уже подключён).
- При drop карточки в другую колонку → `PATCH /api/v1/issues/:id/transitions` с новым stateId.
- Optimistic update через SWR `mutate()`.

**`GET /api/v1/me/inbox` + `GET /api/v1/states` endpoints (backend)** ~30 минут agent:
- В `backend/src/modules/tracker/controllers/issues.controller.ts`:
  - `GET /api/v1/me/inbox` — все Issue где currentUser в assignees, через все Project. Фильтры: state, dueDate, project, label.
- В `backend/src/modules/tracker/controllers/` создать `states.controller.ts`:
  - `GET /api/v1/states` — список всех IssueState текущего tenant'а с фильтром по projectId.
- Обновить `useMyInbox` и канбан Board.tsx чтобы использовали реальные endpoints.

### second-brain обновления после Sprint 3 close

После закрытия 3 backend тикетов выше + рефлексии:
- Обновить `second-brain/01_projects/tracker.md` — отметить B1-3.1/2/3 ✅.
- Обновить `second-brain/02_architecture/module-map.md` — добавить Goals → Issue связь.
- Рефлексия в `second-brain/05_история/YYYY-MM-DD-sprint3-finishing.md`.

---

## 3. Wave 2 (10 нед в плане, реально 4-5 нед при темпе оркестрации)

После Sprint 3 закрытия — Wave 2. План: `plans/sprints/2026-05-24-sprint-plan-wave-1.md` раздел «Wave 2 (обзор)».

### Параллельные потоки Wave 2

**Поток A — Phase 2 frontend полностью** (Sprint 4-7):
- Чат-в-задаче (`<IssueChat>`) поверх `chat-v2` с голосовыми + ASR Vox/GigaAM.
- Cmd+K AI-парсинг через `concierge-parse` LlmTaskType (Sprint 6 — зависит от α-5 готовности).
- PWA manifest + service worker + web push.
- Bottom navigation активация (mount `<TrackerBottomNav>` в layout).
- Optimistic updates для всех мутаций.

**Поток B — α-5 DialogService** (Sprint 4-6, разбить на 3 micro-sub-ТЗ):
- ContextualizerService (standalone-question из истории).
- ConfidenceEstimatorService.
- QueryClassifierService.
- MultiQueryExpansionService (3 переформулировки для recall ≥85%).
- ConversationSummarizerCron (сжатие старых сообщений).
- AnswerCache + RetrievalCache (Redis TTL).
- Temporal `validAt` фильтр.
- Mode-specific prompts (factual / synthetic / clone_style).
- Реализация в `backend/src/modules/dialog-layer/`.
- Sub-ТЗ: `plans/tz/2026-05-23-sba-alpha-5-dialog-layer-and-cache.md`.

**Поток C — Phase 3 трекера AI-фичи** (Sprint 6-7):
- meeting-extract-actions расширение (одна или N задач из встречи с suggestedAssignee/Goal/DueDate).
- issue-infer-fields LlmTaskType (AI-suggest при создании задачи).
- Похожие задачи через KNN embeddings.
- AI Q&A через chat-v2 для tracker.
- auto-triage Intake.
- Sub-ТЗ: `plans/tz/2026-05-23-tracker-phase-3-ai-features.md`.

**Поток D — Activity Feeds + Specialist 3.8 Helpfulness + Recognition** (Sprint 4-6):
- Activity Feeds (4 нед): модель ActivityFeedItem + 6 типов лент + WebSocket events.
- Specialist 3.8 Helpfulness Agent (4 нед): 3 LlmTaskType, worker, 3 cron, 4 probe-trigger, 4 страницы UI + 3 виджета. **Этическая защита:** `question_unanswered`/`question_acknowledged_no_action` только private-to-admin + руководитель команды (никогда публично).
- Recognition + Gamification (3 нед): Badge, Recognition Agent (от имени AI), ContributionSnapshot, BadgeAwarderCron.
- Sub-ТЗ: `plans/tz/2026-05-23-activity-feeds.md`, `plans/tz/2026-05-23-specialist-3-8-helpfulness-agent.md`, `plans/tz/2026-05-23-gamification-and-motivation.md`.

**Поток E — α-10 Admin LLM + Unit Economics** (Sprint 7):
- ⚠ ВАЖНО: ДО старта α-10 — унификация двух admin-групп `(admin)/admin/*` vs `(authenticated)/admin/*`. Иначе плодим третью группу `/admin/llm/*`.
- LlmProvider, LlmModel, AiCostDaily, OrgBudgetCap, CurrencyRate модели.
- 4 cron'а: DailyCostAggregatorCron, OrgEconomicsCron, BudgetAlertCron, CurrencyRateSyncCron (ЦБ РФ), ProviderSmokeTestCron.
- Sub-ТЗ: `plans/tz/2026-05-23-sba-alpha-10-wave3-admin-llm-economics.md`.

---

## 4. Wave 3 (8 нед в плане)

**Phase 4 трекера РФ** (Sprint 9-10):
- Telegram-бот для задач: создание задачи голосом ("поставь Иванову задачу X к пятнице") через `tracker-task-parse` LlmTaskType. Forward сообщения → IntakeIssue.
- Email-to-task: `proj-{cuid}@kora.app` → IntakeIssue.
- 10 шаблонов команд seed (sales/development/installation/marketing/management/customer_support/hr/finance/operations/product).
- Локализация: даты/телефоны/валюта/ИНН/КПП.
- Двусторонний календарь Я.Календарь + Google Calendar, Outlook ICS read-only.

**Phase 5 импорт** (Sprint 11): Битрикс24 + Trello + Я.Трекер wizard'ы.

**β-8 COO Operations Dashboard + DailyCheckIn + PersonalRelation** (Sprint 12):
- ⚠ **Sentiment чек-инов — БЕЗ ручных кнопок 🟢🟡🔴** (решение владельца 2026-05-24). AI определяет sentiment автоматически из свободного текста/голоса вечернего чек-ина.
- Утренний чек-ин: «Что главное / Что планирую».
- Вечерний: «Что сделано / Что не сделано / Что помешало / Предложения».
- LlmTaskType `checkin-parse` извлекает 4 секции + sentiment.
- COO Dashboard `/dashboard/operations`: сегодня + неделя.
- Personal Relations: extension EntityLink с relation_quality.
- Sub-ТЗ: `plans/tz/2026-05-23-sba-beta-8-personal-relation-coo-checkin.md`.

**γ-2 Concierge Agent** (Sprint 12): NL → command parser для Cmd+K + Telegram голоса ("назначь встречу с Иваном завтра в 15").

**γ-3, δ-1, δ-2, δ-3, β-6, β-7, α-7 wave-2** — добор фич, могут быть в Wave 4 после публичной беты.

---

## 5. Решения владельца (зафиксированы 2026-05-24, ОБЯЗАТЕЛЬНЫ к соблюдению)

См. `plans/sprints/2026-05-24-sprint-plan-wave-1.md` раздел «Принятые решения владельца 2026-05-24» (10 решений). Главные:

1. **Чек-лист 14 пунктов** — time-tracking только estimatePoints; бюджет не делаем; roadmap не делаем (cycles + Goals покрывают); OKR не делаем; LiveKit RNNoise активирован; `/me/dashboard` в Phase 2; HR/финансовый/sales агенты не делаем; аудитор через права; Apple Watch/VK Teams отложить; ФСТЭК только архитектура; Контур.Диадок не делаем сейчас; двусторонний календарь в Фаза 4-5.
2. **10 шаблонов команд** — sales/development/installation/marketing/management/customer_support/hr/finance/operations/product.
3. **Цены — отложены.** Sprint 1-6 не упоминаются.
4. **Магазины мобилки — все три** (App Store + Google Play + RuStore).
5. **Параллельная команда** — 4 разработчика минимум.
6. **Принцип «трекер = источник для второго мозга»** — каждое событие → RawEvent → knowledge-core. **ЗАКРЫТО в коммите 3c547f7.**
7. **Sentiment чек-инов — без ручных кнопок 🟢🟡🔴.** AI определяет из текста.
8. **Helpfulness Spotlights** — всегда ручное одобрение руководителем команды.
9. **Приватные негативные сигналы Helpfulness** — только админ + руководитель команды цепочки. Адресат не видит. Никогда публично.
10. **kora-mobile репозиторий** — отдельный (вариант А, не монорепо).

---

## 6. Ключевые ссылки

### Главные документы
- **Sprint Plan Wave 1:** `plans/sprints/2026-05-24-sprint-plan-wave-1.md`
- **Зонтичный план Wave 1-3:** `plans/tz/2026-05-23-coo-and-tracker-umbrella.md`
- **Reality-deltas:** `plans/analysis/2026-05-22-code-reality-deltas.md` ⚠ ОБЯЗАТЕЛЬНО прочесть перед запуском любого Wave 2 sub-ТЗ
- **Стратегия трекера:** `plans/analysis/2026-05-23-tracker-as-entry-wedge.md`
- **AI-COO readiness:** `plans/analysis/2026-05-23-ai-coo-readiness-analysis.md`
- **Product overview:** `plans/analysis/2026-05-23-product-overview-simple.md`

### Sub-ТЗ для Wave 2-3
- `plans/tz/2026-05-23-tracker-phase-2-frontend-mobile-first.md` — Phase 2 frontend
- `plans/tz/2026-05-23-tracker-phase-3-ai-features.md` — Phase 3 AI
- `plans/tz/2026-05-23-tracker-phase-4-rf-musthave.md` — Phase 4 РФ
- `plans/tz/2026-05-23-tracker-phase-5-import.md` — Phase 5 импорт
- `plans/tz/2026-05-23-tracker-mobile-native.md` — мобилка (требует RN-среды)
- `plans/tz/2026-05-23-activity-feeds.md`
- `plans/tz/2026-05-23-specialist-3-8-helpfulness-agent.md`
- `plans/tz/2026-05-23-gamification-and-motivation.md`
- 21 sub-ТЗ Кора v2 в `plans/tz/2026-05-23-sba-*.md`

### second-brain ключевые
- `CLAUDE.md` (корневой) — главные правила (LiveKit только медиа; отдельные аудиодорожки; AI-отчёт по типу; trekker как источник; ...)
- `.claude/CLAUDE.md` — vexp + context7 правила
- `second-brain/index.md` — навигация
- `second-brain/01_projects/tracker.md` — полное описание tracker модуля
- `second-brain/02_architecture/module-map.md` — карта модулей backend
- `second-brain/02_architecture/data-model.md` — все модели Prisma
- `second-brain/02_architecture/knowledge-core.md` — pipeline ingest
- `second-brain/01_projects/llm-providers-verified.md` — verified-карта LLM (DeepSeek primary, OpenAI proxy secondary, Ollama tertiary)
- `docs/reference/llm-models-playbook.md` — playbook вызовов LLM

### Рефлексия предыдущей сессии
- `second-brain/05_история/2026-05-24-tracker-sprint-1-orkestratsiya-9-agentov.md` — детальная рефлексия с 12 архитектурными решениями + 10 техническими уроками + 5 поведенческими уроками.

---

## 7. Технические pitfalls и важные паттерны

### Что НЕ ломать в существующем коде
1. **Apache AGE extension** отсутствует в текущем dev docker-образе `pgvector/pgvector:pg17` — `bun run apply-postgres-init` падает на `extension "age" is not available`. **Это инфра-проблема не из изменений 2026-05-24.** HNSW/GIN индексы pgvector работают. Отдельный тикет на нужный docker-образ.
2. **CRLF warnings на Windows** — git автоматически конвертирует. Нормально, не блокер.
3. **bash-tool требует POSIX-синтаксис** — НЕ PowerShell `Select-Object`/`Select-String`. Использовать `head -N`, `grep`, `tail`.
4. **Pre-сессионные untracked файлы** — `second-brain/06_marketing/*.md`, `plans/analysis/2026-05-23-*.md`, `plans/tz/2026-05-23-*.md`, `docs/user-guide/`, `.claude/hooks/`, `.claude/skills/dzen-content-research/` и др. **НЕ коммитить** в свои коммиты! Каждый `git add` явно перечисляет пути.
5. **Knowledge-core block-ingest worker** теперь поддерживает `payload.signalTypeHint` (override LLM-определения). Если будешь добавлять новые адаптеры — используй этот паттерн для явной семантики.
6. **TrackerWebhooksController на `/api/v1/tracker/webhooks`** — НЕ на `/api/v1/webhooks` (конфликт с LiveKit webhooks).
7. **WebhookDispatcher использует in-process BullMQ worker** (как knowledge-core воркеры) — следует существующему паттерну `workers.module.ts` «отдельный worker-процесс больше нет».
8. **S3Service из RecordingsModule** — `@Global()`, exports `S3Service`. Не создавать новый.
9. **LivekitService** — `@Global()`, методы `generateHostToken({id, endedAt?}, identity, name)` + `ensureRoom({id})`. Не вызывать `MeetingsService.create()` для task_discussion (quota обход).
10. **`task_discussion` AI-промпт** временно переиспользует `team` промпт. TODO Sprint 3: отдельный промпт под обсуждение задачи.

### Параллельная оркестрация — что работает
- **Один большой Agent с чётким DoD + skills + ограничениями** работает лучше нескольких маленьких. Agent 1 создал 20 моделей + 18 SignalType за один прогон. Agent 11 создал 83 файла frontend за один прогон.
- **Перед каждым Agent — разведка через grep/Read.** Минимум 3 sub-ТЗ оказались уже готовы — `grep "ModelName" backend/src/` спасает часы.
- **Промпт Agent должен включать:** контекст, путь к sub-ТЗ, skills проекта (nestjs-rules / prisma-db-push-rules / z-ai-agent-rules / core-engineering-standards), жёсткие правила (только prisma:push, nullable поля, никаких commit/push), чёткий DoD, список «что НЕ делать», требование отчёта в конце.
- **`bun install` после изменения package.json** — для новых зависимостей.
- **Параллельные коммиты после параллельных agent'ов** — нужно проверить через `git status` что нет конфликтов в одном файле (один agent → один commit разделяемых файлов).

### Skills проекта (применять обязательно)
- `nestjs-rules` — backend стандарты (DTO через nestjs-zod, TenantGuard, RbacGuard, $transaction для multi-мутаций, Logger из @nestjs/common)
- `frontend-rules` — ApiDto → DomainModel → UiModel слоёная модель
- `prisma-db-push-rules` — только `bun run prisma:push`
- `safe-seed-rules` — безопасные seed-скрипты
- `z-ai-agent-rules` — AI-агенты и prompt infrastructure
- `domain-business-context` — бизнес-контекст продукта Z
- `core-engineering-standards` — инженерные стандарты
- `project-architecture-router` — навигация по архитектуре
- `strict-production-review-gate` — code review

---

## 8. Готовые промпты следующих агентов (бери и запускай)

### Agent 12 — B1-3.2 Goals integration (~30-45 мин)

```
Ты backend разработчик Z/Кора. Sprint 3 тикет B1-3.2: Goals integration + strategic-alignment расширение.

Контекст:
- Tracker модуль: backend/src/modules/tracker/. IssuesService.linkGoal/unlinkGoal уже есть (проверить полноту + IssueActivity).
- Goals модуль: backend/src/modules/goals/. Найти strategic-alignment cron.
- Schema: Goal.linkedIssues уже добавлен (Issue.goalId + reverse relation).
- Sub-ТЗ: plans/tz/2026-05-23-tracker-phase-1-models-api.md раздел «Связь с Goals».
- Skills: nestjs-rules, core-engineering-standards.

Что сделать:
1. Verify IssuesService.linkGoal/unlinkGoal — должны писать IssueActivity verb='goal_linked'/'goal_unlinked'. Если нет — добавить.
2. Расширить strategic-alignment cron: для каждой active Goal сосчитать
   - total Issue (Goal.linkedIssues.count())
   - completed (state.category=completed)
   - blocked (state.category=blocked)
   - % времени прошло (от Goal.targetDate)
   - alignment score 0-100
3. Snapshot в Goal.progressSnapshot Json (или новой GoalAlignmentSnapshot).
4. Probe-trigger: если у user-а ≥80% Issue без goalId → ProbeService.suggest({type:'strategic_misalignment_high', targetUserId, formulatedQuestion: 'У вас 80% задач не привязаны к целям компании. Хотите проверить?'})
5. GET /api/v1/goals/:id/alignment-snapshot endpoint в GoalsController.
6. Unit-тесты для cron + endpoint.

Проверки: bun run typecheck, bun run lint, bunx vitest run src/modules/goals/.

НЕ делать: commit/push, prisma migrate*, не менять Goal модель в schema.prisma (всё уже есть).

Отчёт: список файлов, output проверок, тесты.
```

### Agent 13 — B1-3.3 Legacy Task → Issue миграция (~45 мин)

```
Ты backend разработчик Z/Кора. Sprint 3 тикет B1-3.3: миграция legacy `Task` модели → новые `Issue`.

Контекст:
- Legacy: backend/src/modules/tasks/. Task = action items из встреч (с assigneeRaw String, без FK на User).
- Новое: backend/src/modules/tracker/. Issue полноценный.
- Sub-ТЗ: plans/tz/2026-05-23-tracker-phase-1-models-api.md раздел «Миграция legacy Task модуля».
- Skills: safe-seed-rules, core-engineering-standards.

Что сделать:
1. Скрипт backend/scripts/migrate-task-to-issue.ts.
2. Логика:
   - Для каждой Org: upsert виртуальный Project { slug: 'from-meetings', identifier: 'MTG', name: 'Из встреч', ownerId: orgOwnerUserId } (идемпотентно).
   - Для каждой Task в Org:
     - Создать Issue: projectId=virtualProject.id, identifier=MTG-N, externalSource='meeting_legacy', externalId=task.id, linkedMeetingIds=[task.meetingId], title=task.title, description=task.description, sourceBlockIds=task.sourceBlockIds (если есть).
     - assigneeUserIds: пытаемся найти User по email/name из task.assigneeRaw. Если не найден — metadata.legacyAssigneeRaw=task.assigneeRaw.
     - dueDate, status (mapped в IssueState), createdAt — copy as is.
     - IssueActivity verb='migrated_from_legacy_task'.
3. --dry-run (default): показывает план без изменений.
4. --apply: реально применяет.
5. Идемпотентность: повторный запуск НЕ дублирует (проверка по externalSource+externalId unique).
6. legacy /api/v1/tasks/* пометить @deprecated в Swagger (TasksController).
7. Логирование через @nestjs/common Logger.

Проверки: bun run typecheck. Скрипт компилируется (НЕ запускать на dev БД — это для владельца).

НЕ делать: commit/push, prisma migrate*, НЕ удалять Task модель/модуль (legacy остаётся работать).

Отчёт: путь скрипта, как запускать, dry-run preview.
```

### Agent 14 — IdempotencyService + socket.io-client (~60 мин, 2 в одном)

```
Ты fullstack разработчик Z/Кора. Sprint 2 finishing: IdempotencyService + socket.io-client интеграция.

Контекст:
- Sub-ТЗ: plans/sprints/2026-05-24-sprint-plan-wave-1.md (B1-2.2 finishing).
- Backend: backend/src/common/idempotency/ — пока нет общего сервиса (только Crossmark-specific IdempotencyInterceptor).
- Frontend: frontend/src/hooks/tracker/useTrackerWebSocket.ts — TODO stub.
- ENV: IDEMPOTENCY_KEY_TTL_SECONDS=86400 уже в TrackerSchema.

Часть 1 — IdempotencyService backend (30 мин):
1. backend/src/common/idempotency/idempotency.service.ts:
   - getCachedResponse(key, tenantId) — читает Redis.
   - setCachedResponse(key, tenantId, response, ttl=86400).
   - Используется Redis client из RedisModule.
2. backend/src/common/idempotency/idempotency.middleware.ts:
   - Читает Idempotency-Key header (формат: uuid).
   - Если в cache — возвращает кэшированный response.
   - Иначе — вызывает next() и кэширует response.
3. backend/src/common/idempotency/idempotency.module.ts — Global.
4. Применить middleware к POST endpoints трекера: /issues, /comments, /intake, /webhooks. Через @UseMiddleware декоратор или RouteConfig.
5. Unit-тесты idempotency.service.

Часть 2 — socket.io-client (30 мин):
1. bun add socket.io-client (frontend).
2. frontend/src/hooks/tracker/useTrackerWebSocket.ts:
   - io('/ws/tracker', { auth: { token: ... } }) с cookie z_session.
   - subscribe.project и subscribe.issue по необходимости.
   - EventEmitter на события issue.*, comment.*, cycle.*.
3. Интегрировать в useIssues/useIssue/useCycles — auto-revalidate через SWR mutate() при WS event'ах.

Проверки: bun run typecheck + lint backend + frontend, bunx vitest run src/common/idempotency/.

НЕ делать: commit/push, не ломать существующий Crossmark IdempotencyInterceptor.

Отчёт: список файлов, output проверок, тесты.
```

### Agent 15 (Wave 2 первый) — Activity Feeds (~90 мин)

```
Ты backend разработчик Z/Кора. Wave 2 Sprint 4: Activity Feeds — единая модель + 6 типов лент.

Контекст:
- Sub-ТЗ: plans/tz/2026-05-23-activity-feeds.md (читать полностью).
- Backend: новый модуль backend/src/modules/activity-feed/.
- Зависит от tracker (закрыто), insights (закрыто), decisions (закрыто), ideas (закрыто), curation (закрыто), probe (закрыто).
- Skills: nestjs-rules, prisma-db-push-rules, core-engineering-standards.

ВАЖНО — РАЗВЕДКА ПЕРЕД СТАРТОМ:
1. grep -rn "ActivityFeedItem" backend/src/ — проверить что нет уже готовой модели.
2. grep -rn "feed.publish\|ActivityFeedService" backend/src/ — проверить если уже частично есть.
3. Если 90%+ готово — отчитаться и не дублировать (см. Agent 9 опыт с α-4/β-5).

Что сделать (если новое):
1. Prisma модели ActivityFeedItem + ActivityFeedSubscription (по sub-ТЗ).
2. ActivityFeedService.publish(...) — единая точка для всех агентов.
3. 6 типов лент: probe_question, insight, decision, task, idea, conflict (+ опц. knowledge_change).
4. REST endpoints /api/v1/feed + /feed/{type} + /react + /subscriptions.
5. WebSocket events feed.new_item / feed.item_updated.
6. Cron задачи: ActivityFeedExpireCron (probe-questions), ActivityFeedDigestCron.
7. RBAC ResourceType activity_feed_item с visibility scope.
8. Метрики Prometheus.
9. Тесты unit + integration.

НЕ делать: commit/push, prisma migrate*. Не ломать существующие модули.

Отчёт: что обнаружила разведка, список файлов, проверки, тесты.
```

### Agent 16 (Wave 2 параллельно) — Specialist 3.8 Helpfulness (~90 мин)

```
Ты backend разработчик Z/Кора. Wave 2: Specialist 3.8 Helpfulness Agent.

Контекст:
- Sub-ТЗ: plans/tz/2026-05-23-specialist-3-8-helpfulness-agent.md (читать полностью).
- α-2 wave-3 SignalType (7 helpfulness + 3 gamification) — УЖЕ добавлены в Sprint 1 (commit 6b85491).
- Зависит от RouterService (α-3), CardSpecialistRegistry, ProbeService.
- Skills: nestjs-rules, z-ai-agent-rules, prisma-db-push-rules.

ВАЖНО — РАЗВЕДКА: grep -rn "HelpfulnessTrait\|SocialContributionProfile" backend/src/ — может быть уже частично готово.

Что сделать (если новое):
1. Prisma модели: HelpfulnessTrait, SocialContributionProfile, HelpfulnessSpotlight (по sub-ТЗ).
2. Worker specialist-3-8-helpfulness.worker (consumer core.specialist-routing jobName=3-8-helpfulness).
3. 3 LlmTaskType: helpfulness-detect, helpfulness-trait-merge, helpfulness-spotlight-formulate. Тройная цепочка DeepSeek → OpenAI proxy → Ollama qwen3.5:9b.
4. 3 cron: SocialContributionProfileCron (5 утра), HelpfulnessSpotlightCron (9:00 MON), HelpfulnessTraitDecayCron (6 утра).
5. 4 probe-trigger: new_expertise_helper_detected, unrecognized_high_contributor, mentor_emerging, question_chain_unanswered (последний — только private).
6. REST endpoints /api/v1/me/social-contribution, /persons/:id/social-contribution, /feed/spotlights (+ approve/hide/republish), /admin/helpfulness/* (team-map, unanswered).
7. Frontend: страницы /me/social-contribution, /persons/[id]/social-contribution, /feed/spotlights, /admin/helpfulness-overview + 3 виджета.
8. RBAC: 3 ResourceType с visibility scope.
9. ⚠ ЭТИЧЕСКИЕ ЗАЩИТЫ (КРИТИЧНО):
   - question_unanswered + question_acknowledged_no_action — только private (главный админ + руководитель команды). Никогда публично.
   - Spotlights — всегда ручное одобрение руководителем (status='pending' → 'approved' → 'published').
   - Opt-out в /me/settings/privacy.
   - Mark-as-misleading кнопка для каждого trait в /me/social-contribution.
   - Никаких рейтингов «топ-10».
10. Тесты unit + integration.

НЕ делать: commit/push, prisma migrate*. Не дублировать готовое.

Отчёт: разведка, список файлов, проверки, тесты, особенно ethical safeguards verified.
```

### Agent 17 (Wave 2 параллельно) — Recognition + Gamification (~60 мин)

```
Ты backend разработчик Z/Кора. Wave 2: Recognition Agent + Gamification.

Контекст:
- Sub-ТЗ: plans/tz/2026-05-23-gamification-and-motivation.md (читать полностью).
- α-2 wave-3 SignalType (helped_by, helped_to, thanks_explicit) — УЖЕ добавлены (commit 6b85491).
- Зависит от Specialist 3.8 Helpfulness (Agent 16 параллельно).
- Skills: nestjs-rules, z-ai-agent-rules, prisma-db-push-rules.

ВАЖНО — РАЗВЕДКА: grep -rn "Recognition\|Badge\|ContributionSnapshot" backend/src/ — может быть частично готово.

Что сделать (если новое):
1. Prisma модели: Recognition, Badge, UserBadge, ContributionSnapshot.
2. Расширения: IssueComment.thanksUserIds String[].
3. LlmTaskType recognition-formulate (от имени AI). Тройная цепочка.
4. Recognition Agent — worker / cron RecognitionWeeklyDigestCron (9:00 MON).
5. 4 cron: RecognitionWeeklyDigestCron, ContributionSnapshotCron (4:00), BadgeAwarderCron (5:00), StreakDetectorCron (23:00).
6. Seed 5 базовых badges: ideator, expert, helper, aligned, consistent.
7. REST endpoints /api/v1/me/contributions, /persons/:id/contributions, /me/recognitions, /badges, /me/badges, /comments/:id/thanks.
8. Frontend: страницы /me/contributions, /persons/[id]/contributions + 3 виджета (TeamSpotlight, MyContributions, RecognitionFeed).
9. Probe-trigger: low_team_engagement, unrecognized_high_contributor.
10. ⚠ ВАЖНО:
   - Recognition от имени AI (не руководителя автоматически). Опц. — кнопка руководителю одобрить и переслать от себя.
   - Никаких рейтингов, никаких очков-валюты.
   - Опт-аут в /me/settings/notifications.
   - Бейджи без сравнения между людьми.
11. Тесты unit + integration.

НЕ делать: commit/push, prisma migrate*. Не дублировать готовое.

Отчёт: разведка, список файлов, проверки, тесты.
```

### Agent 18 (Wave 2 параллельно) — α-5 DialogService (~120 мин — большой scope)

```
Ты backend разработчик Z/Кора. Wave 2: α-5 DialogService (RAG-слой над chat-v2).

Контекст:
- Sub-ТЗ: plans/tz/2026-05-23-sba-alpha-5-dialog-layer-and-cache.md (читать полностью).
- chat-v2 уже работает (cosine + BM25 + 1-hop graph retrieval). Не ломать.
- KnowledgeCoreChatV2Service ядро retrieval — оставить как есть.
- ChatV2OrchestrationService.ask() оркестрация — оборачивать сюда DialogService как препроцессор.
- Skills: nestjs-rules, z-ai-agent-rules.

ВАЖНО — РАЗВЕДКА: grep -rn "DialogLayer\|ContextualizerService\|MultiQueryExpansion" backend/src/ — может быть частично готово (по reality-deltas 30% done).

Что сделать (новый модуль backend/src/modules/dialog-layer/):
1. ContextualizerService — переписывает вопрос пользователя в standalone-вопрос с учётом истории.
2. ConfidenceEstimatorService — оценивает уверенность ответа 0-1.
3. QueryClassifierService — гибрид эвристика + LLM-fallback (классифицирует вопрос: factual / analytical / opinion).
4. MultiQueryExpansionService — генерирует 3 переформулировки для recall ≥85%.
5. ConversationSummarizerCron — раз в день сжимает старые сообщения в ChatV2Conversation.summary.
6. AnswerCache (Redis TTL 24h) + RetrievalCache (Redis TTL 1h).
7. Расширить ChatV2Conversation.summary String? @db.Text.
8. Temporal validAt фильтр в retrieval (по Card.currentVersion.validFrom/validUntil).
9. Mode-specific system prompts: factual / synthetic / clone_style.
10. 5 новых LlmTaskType: dialog-contextualize, dialog-confidence, dialog-classify, dialog-multi-query, dialog-summarize. Тройная цепочка.
11. Интеграция: ChatV2OrchestrationService.ask() — препроцессор DialogService → KnowledgeCoreChatV2Service.
12. Тесты unit для каждого сервиса.

НЕ делать: commit/push, prisma migrate*. НЕ ломать chat-v2 core retrieval.

Отчёт: разведка (что уже есть), список файлов, проверки, тесты.
```

---

## 9. Регламент коммитов

```bash
# После каждого закрытого тикета:
cd c:\work\z
git add <конкретные пути>      # НЕ git add . !!
git commit -m "$(cat <<'EOF'
тип(область): краткое описание тикета (Sprint N Agent M)

Полное описание:
- Что сделано.
- Архитектурные решения принятые автономно.
- Тесты passed/failed.
- TODO которые остались.

Проверки: bun run typecheck ✓, bun run lint ✓ (0 errors), тесты passed.

Refs:
- plans/tz/...md
- plans/sprints/2026-05-24-sprint-plan-wave-1.md (Sprint N тикет M-X.Y)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"

# После каждых 3-4 коммитов или законченного спринта:
git push origin dev

# Сразу после push (автоматически, без подтверждения):
# 1. Обновить second-brain (module-map / data-model / 01_projects / index.md).
# 2. Записать рефлексию в second-brain/05_история/YYYY-MM-DD-...md.
# 3. Commit "docs(second-brain): ..." + push рефлексии.
# 4. Prod-инструкция в чате владельцу (один раз за сессию).
```

---

## 10. Финальный итог

**Стартовая точка для тебя:** `git pull origin dev`, последний коммит `2a6108f`.

**План работы (по приоритетам):**

1. **Sprint 3 finishing (1-2 ч):** Agent 12 + Agent 13 + Agent 14 параллельно. 3 коммита + push.
2. **second-brain update + рефлексия Sprint 3** автоматически.
3. **Wave 2 backend старт (4-6 ч):** Agent 15 (Activity Feeds) + Agent 16 (Specialist 3.8 Helpfulness) + Agent 17 (Recognition) + Agent 18 (α-5 DialogService) параллельно. 4 коммита + push.
4. **Wave 2 frontend (~3 ч):** чат-в-задаче, Cmd+K AI после α-5, PWA, drag-n-drop канбана, Bottom navigation. 3-4 коммита + push.
5. **second-brain update + рефлексия Wave 2** автоматически.
6. **Wave 3 backend (по запросу владельца):** β-8 COO Dashboard, Phase 4 РФ Telegram-бот, Phase 5 импорт, γ-2 Concierge.

**Текущий темп оркестрации:** 13 коммитов / ~17 900 строк за одну сессию. Если темп сохранится, Wave 2 + Wave 3 могут быть закрыты за 2-3 длинных сессии.

**Главный показатель качества:** `bun run typecheck` всегда зелёный на main, `bun run lint` без новых errors в наших файлах, тесты passed для каждого нового сервиса/cron'а/worker'а.

**Удачи. Делай качественно, делай параллельно, не дублируй уже готовое.**

— claude-orchestrator (Opus 4.7), 2026-05-24
