---
date: 2026-05-24
type: reflection
session: sprint3-finishing + α-5 reality check
distilled: false
---

# Sprint 3 finishing — Goals integration + Task→Issue migration + общий IdempotencyService + socket.io live refresh

## Что было поставлено

Handoff `plans/sprints/2026-05-24-handoff-to-next-orchestrator.md` указал 3 тикета Sprint 3 finishing + 4 потока Wave 2. Я как оркестратор продолжил с состояния `c4c110e` (HEAD origin/dev):

1. **B1-3.2 Goals integration + strategic-alignment расширение** — Agent 12.
2. **B1-3.3 миграция legacy Task → Issue** — Agent 13.
3. **IdempotencyService backend + socket.io-client frontend** — Agent 14 (2-в-1).
4. **Wave 2 backend** — α-5 DialogService (Agent 18), Activity Feeds (Agent 15), Helpfulness (Agent 16), Recognition (Agent 17) параллельно после Sprint 3 finish.

## Как решал

### Шаг 1 — обязательная разведка перед запуском (главный урок прошлой сессии)

`grep -rn "ModelName" backend/src/` перед каждым тикетом:
- `linkGoal/unlinkGoal` — частично присутствуют в `IssuesService` → проверять полноту.
- `backend/scripts/migrate-task*` — нет → чистая работа.
- `backend/src/common/idempotency/` — нет (есть только Crossmark-specific interceptor) → чистая работа.
- `socket.io-client` — нет в frontend/package.json → добавить.
- `useTrackerWebSocket.ts` — TODO stub → переписать.

Параллельно (одним блоком tool calls) сделал разведку Wave 2: Activity Feeds / Helpfulness / Recognition / α-5 DialogService.

### Шаг 2 — сюрприз № 1: α-5 DialogService полностью реализован

`grep "DialogLayer|ContextualizerService|MultiQueryExpansion"` нашёл **44 файла** в `backend/src/modules/dialog-layer/`. Module зарегистрирован как @Global, DialogService импортирован в `chat-v2.service.ts`. Все 9 пунктов из sub-ТЗ покрыты:
- ContextualizerService ✓
- ConfidenceEstimatorService ✓
- QueryClassifierService ✓
- MultiQueryExpansionService ✓
- ConversationSummarizerCron ✓
- AnswerCache + RetrievalCache + CacheInvalidationService ✓
- factual/synthetic/clone_style prompts ✓
- 5 LlmTaskType (contextualize/confidence/classify/multi-query/summarize) ✓
- Tests + spec файлы для каждого сервиса ✓

**Решение:** Agent 18 НЕ запускать. Зафиксировал в рефлексии как пятый случай (после α-4, β-5, γ-1 в прошлой сессии и tracker-как-источник в Sprint 3).

### Шаг 3 — параллельный запуск Agent 12-14 в фоне (`run_in_background: true`)

Промпты из handoff чуть докрутил под актуальное состояние (linkGoal частично есть; путь POST `/issues` отсутствует — реально `/projects/:projectId/issues`; idempotency middleware подключать в AppModule, не в TrackerModule).

Файловая независимость:
- Agent 12 → `goals/` + `tracker/services/issues.service.ts`
- Agent 13 → `scripts/migrate-task-to-issue.ts` + `tasks/tasks.controller.ts` + `backend/package.json`
- Agent 14 → `common/idempotency/` + `app.module.ts` + `frontend/src/hooks/tracker/*` + `frontend/package.json`

Конфликтов файлов между агентами нет (issues.service.ts только у Agent 12).

### Шаг 4 — pre-commit verification

После завершения всех трёх:
- `cd backend && bun run typecheck` → exit 0 (зелёное)
- `cd frontend && bun run typecheck` → exit 0 (зелёное)

Lint — pre-existing warnings про import-x/order, не новые ошибки (подтверждено и Agent 12 и Agent 14).

Тесты:
- Agent 12: `vitest run src/modules/goals/` — 15/15 passed. `vitest run src/modules/tracker/services/` — 19/19 passed (регрессий нет).
- Agent 14: `vitest run src/common/idempotency/` — 11/11 passed.

### Шаг 5 — 3 отдельных коммита + push

- `c628f80` feat(goals,tracker): B1-3.2 Goals integration + strategic-alignment по задачам — 9 files, +1203/-16
- `6b83cbb` feat(tasks,tracker): B1-3.3 миграция legacy Task → Issue + deprecation legacy /tasks — 3 files, +675/-1
- `60def77` feat(common,frontend): общий IdempotencyService backend + socket.io-client live refresh — 13 files, +1995/-1187 (rewrite frontend/bun.lock + useTrackerWebSocket)

Push `c4c110e..60def77 dev -> dev` без подтверждений (полная автономия по согласованию владельца 2026-05-24).

### Шаг 6 — second-brain update + рефлексия

- `01_projects/tracker.md` — раздел «Что осталось до DoD Phase 1» обновлён: B1-3.2/B1-3.3/Idempotency/WebSocket помечены ✅ с коммитами.
- `02_architecture/module-map.md` — новый раздел «Tracker Sprint 3 finishing (2026-05-24)» с подробным описанием 4 новых блоков.
- `05_история/2026-05-24-sprint3-finishing.md` — эта рефлексия.

## Что вышло — результаты верификации

| Что | Проверка | Результат |
|---|---|---|
| Backend typecheck после 3 параллельных Sprint 3 агентов | `bun run typecheck` | ✓ exit 0 |
| Frontend typecheck после socket.io-client интеграции | `bun run typecheck` | ✓ exit 0 |
| Backend tests goals/ + tracker/ | `vitest run` | 15/15 + 19/19 passed |
| Backend tests idempotency/ | `vitest run` | 11/11 passed |
| Git push | `git push origin dev` | OK c4c110e..60def77 |
| Pre-сессионные untracked файлы | Не закоммичены | ✓ ни одного из 27 untracked не попал в коммиты |

## Архитектурные решения принятые автономно

### 1. StrategicAlignmentCron — параллельный, не replacing
В `backend/src/modules/knowledge-core/workers/` уже есть LLM-based `StrategicAlignmentCron` (04:00 UTC, по темам/IdeaBlock). Не дублировал, не модифицировал. Создал параллельный issue-based cron в `backend/src/modules/goals/cron/` (06:00 UTC). Имя класса совпадает, но они в разных модулях — рантайм-конфликта нет, NestJS DI разруливает. Это даёт два независимых сигнала alignment: один по знаниям, второй по реальным задачам трекера.

### 2. Goal.progressSnapshot отсутствует в schema — Redis + AuditLog как storage
Не модифицировал schema.prisma в этом тикете. Snapshot хранится:
- Redis ключ `goal:issue-snapshot:{goalId}` TTL 26ч — быстрый кэш для endpoint.
- AuditLog `action='goal.alignment.issue_progress'` — история.

Если в будущем понадобится persistent snapshot — отдельным планом добавить `Goal.progressSnapshot Json?` через `bun run prisma:push`.

### 3. Migrate-task-to-issue: где хранить legacyAssigneeRaw
На `Issue` нет колонки `metadata` (проверено в schema). Решение: писать в `IssueActivity.metadata` для verb=`migrated_from_legacy_task` (поле `metadata Json?` есть). Это нативное место audit-trail и не требует менять `Issue` модель.

### 4. IdempotencyMiddleware подключён в AppModule, не в TrackerModule
`RequestIdMiddleware` уже там, единая точка cross-cutting middleware. `IdempotencyModule` помечен @Global() и импортирован сразу после `RedisModule`. Применён к 3 POST путям трекера (через `consumer.apply(...).forRoutes({ path, method: RequestMethod.POST })`).

### 5. Кэшируются только 2xx ответы
Если контроллер вернул 4xx (валидация, ownership) или 5xx — снимок не пишется в Redis. Иначе клиент застрял бы с ложной ошибкой при повторе и не смог бы исправиться. Заголовок `Idempotency-Replay: true` ставится на повторных ответах для observability.

### 6. WebSocket EventEmitter в frontend — внутренний Map
Map<TrackerWsEventType, Set<handler>>. На все 12 известных имён событий подписка вешается один раз на socket; fanout раздаёт payload локальным подписчикам. Это позволяет регистрировать handlers ДО первого реального события без race-condition и без дорогих `socket.on/off` циклов.

### 7. α-5 DialogService — не запускал Agent 18
Полностью реализован (44 файла) и интегрирован в chat-v2. Пятый случай в моей оркестрации, когда разведка через `grep "ClassName" backend/src/` сэкономила 2+ часа работы агента.

## Чему научился (для дистилляции в core-pitfalls / feedback memory)

1. **Разведка через grep — must-have перед каждым sub-ТЗ.** В этой сессии — 1 из 4 Wave 2 потоков уже готов (α-5). За все сессии Sprint 1-3 — минимум 5 готовых sub-ТЗ обнаружено через grep до старта агента. Экономия времени: 8+ часов работы агентов.

2. **При параллельных агентах на разных модулях бэка — последовательные коммиты по тикетам.** Один общий typecheck после всех агентов, но коммиты разные (по тикетам, не по агенту). Это упрощает revert и git blame.

3. **«Не той же модели cron»: разные модули → разные cron-классы OK.** `StrategicAlignmentCron` теперь существует в двух местах:
   - `knowledge-core/workers/strategic-alignment.cron.ts` (LLM-based, 04:00)
   - `goals/cron/strategic-alignment.cron.ts` (issue-based, 06:00)
   NestJS DI разруливает по module-scope. Семантически — два разных сигнала, не дублирование.

4. **Когда «middleware vs interceptor vs guard»**:
   - Cross-cutting per-request state (idempotency, request-id, tenant from header) — middleware.
   - Per-handler логика, требующая reflection (idempotency для конкретного контроллера) — interceptor.
   - Auth/RBAC — guard.
   В этом коммите применил middleware-подход — правильно для общего сервиса трекера.

5. **`@@unique` constraints помогают сделать миграционный скрипт идемпотентным без отдельного state-tracking.** В Agent 13: `externalSource='meeting_legacy' + externalId=task.id` через `Issue` уникальный индекс. Повторный запуск автоматически пропускает уже мигрированные.

## TODO которые остались (для следующей сессии)

- Wave 2 prisma модели (9 новых) — добавить одним коммитом в schema.prisma перед запуском Agent 15-17:
  - ActivityFeedItem + ActivityFeedSubscription
  - HelpfulnessTrait + SocialContributionProfile + HelpfulnessSpotlight
  - Recognition + Badge + UserBadge + ContributionSnapshot
  - Расширение IssueComment.thanksUserIds String[]
- Agent 15 (Activity Feeds) + Agent 16 (Helpfulness) + Agent 17 (Recognition) параллельно после prisma коммита.
- Wave 2 frontend: drag-n-drop канбана, Bottom navigation активация, PWA, `/api/v1/me/inbox` + `/api/v1/states` endpoints (backend small task).
- Notification владельцу при webhook.isActive=false (Sprint 2-3, TODO).
- Sharp thumbnails для IssueAttachment (Sprint 3+, отдельный воркер).
- task_discussion отдельный AI-промпт (сейчас переиспользует team).

## Prod-инструкция для владельца

Изменения этой сессии **не требуют миграций БД** (schema.prisma не менялся). Только:

1. **`backend/.env` проверить:** `IDEMPOTENCY_KEY_TTL_SECONDS=86400` — уже было в `TrackerSchema` (env.schema.ts:1124), на prod должно быть выставлено.
2. **`backend` и `frontend` пересобрать:**
   ```bash
   cd backend && bun install && bun run build
   cd frontend && bun install && bun run build
   ```
3. **Перезапустить:** backend HTTP + worker процессы, frontend Next.js.
4. **Legacy Task → Issue миграция — НЕ запускать автоматом.** Когда владелец готов:
   ```bash
   cd backend
   bun run migrate-task-to-issue                            # dry-run preview
   bun run migrate-task-to-issue --apply                    # реально применить
   ```
   Скрипт идемпотентный, повторный запуск безопасен.
5. **Прометей-метрики**: новых нет в этом релизе, существующие сохраняются.

## Метрика темпа оркестрации

| Сессия | Коммитов | Строк | Срок |
|---|---|---|---|
| 2026-05-24 Sprint 1+2+3 | 13 | ~17 900 | 1 длинная сессия |
| 2026-05-24 Sprint 3 finishing | 3 | ~3 900 | первая половина текущей сессии |
| **Итого 2 сессии** | **16 коммитов** | **~21 800 строк** | |

Дальше — Wave 2 backend (3 параллельных агента) + Wave 2 frontend.
