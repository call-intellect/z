---
date: 2026-05-22
tags: [competitor-parity, orchestration, prompt-registry, llm-routing, multi-agent]
distilled: false
---

# Рефлексия — Wave 1-3 competitor-parity (паритет с mymeet/FollowUp/Таймлист)

## Что было поставлено

Зонтик [`plans/tz/2026-05-21-competitor-parity.md`](../../plans/tz/2026-05-21-competitor-parity.md) — 5 sub-TZ (A, B, C, D, E) с раскладкой на 7 фаз (A.1, A.2, A.3, A.4, B, C, D, E). Цель — закрыть 5 пользовательских гэпов от российских конкурентов (mymeet.ai с его конструктором шаблонов от 20.05.2026, FollowUp.tech с AI-оценкой качества, Таймлист с речевой аналитикой) + добавить 3-уровневую цепочку моделей в админке (зонтик Q9 + SBA-зонтик §3.7).

Я выступал оркестратором: разбил работу на 3 волны, запускал sub-agent'ов параллельно через `isolation: worktree`, мержил, чинил интеграционные конфликты, делал финальный commit + push.

## Как решал

**Wave 1 (последовательно):**
- A.1 — фундамент Prompt Registry. 1 агент в основной ветке (не worktree, т.к. блокирует остальных).

**Wave 2 (3 агента параллельно через worktree):**
- A.4 — админка `/admin/ai-models` + LlmRouterService tier-fallback.
- B — метрики поведения.
- D — очистка транскрипта.

**Wave 3 (4 агента поэтапно через worktree):**
- C + A.2 — параллельно (разные модели в БД).
- A.3 + E — параллельно (разные модули).

**Финальный merge worktree → main:**
Все worktree'ы автомержились в main, кроме A.3 — он остался отдельной веткой. Применил через `cp -ru` (update if newer), что сработало — A.3 сам сделал `cp` из main перед работой, поэтому worktree содержал main + расширения A.3.

**Интеграционные правки оркестратора** (после merge):
- `pdf-parse@^2.4.6` → `^2.4.5` (2.4.6 unpublished с npm — блокировало `bun install`).
- 3 недостающих метода в `BusinessMetricsService` (A.3 ссылался на них, но не добавил после моего стандартного шаблона).
- `PromptResolverTaskType` union: добавил behavior-refine / transcript-clean-refine / custom-report (B/D/E использовали приведение типа, потому что A.1 закрыл union слишком узко).
- `code-fallback.adapter.ts`: явный throw для taskType'ов без code-fallback.
- `FeatureKey/QuotaKey + tier-config.ts`: keys от E.
- `analyze.worker.spec.ts`: mock `enqueueQualityScore` (от C).

## Что вышло

**Метрики:**
- 154 файла, +28786/-1272 строк в коммите `a0f7a56`.
- 7 sub-ТЗ закрыты кодово.
- Backend `typecheck/build/prisma validate` чисто.
- 491/499 unit-тестов passed. 8 fails — pre-existing (AWS SDK v3 mock constructor + livekit-server-sdk mock), не от Wave 1-3.
- Frontend typecheck по новым файлам чист. Build не запускался — pre-existing `@tailwindcss/postcss` missing + EPERM на next в node_modules (нужен clean install).

**Что НЕ сделано из-за инфраструктуры:**
- `prisma:push` (Docker Desktop Linux engine не поднялся за всю сессию).
- 6 seed-скриптов (зависят от живой БД).
- Финальная end-to-end smoke-проверка (зависит от БД).

## Чему научился

### 1. Параллельные агенты в worktree — рабочий паттерн, но требует синхронизации точек интеграции

**Что сработало:**
- 3 агента в Wave 2 (A.4 + B + D) с разными моделями Prisma — конфликтов в schema.prisma не было.
- 2 агента в Wave 3 (C + A.2) — параллельно, разные модули.

**Что сломалось:**
- A.3 не автомержился (остался locked worktree). Пришлось руками `cp -ru`.
- A.3 расширял общие файлы (PromptResolverService, BusinessMetricsService), которые А.1/A.2/A.4 уже модифицировали — это привело к 4 «недостающим» методам и опечатке в имени (`setPromptExperimentActiveCount`). Параллельный агент не видит свежие изменения коллеги.

**Урок:** общие cross-cutting сервисы (метрики, типы, RBAC) — точки риска при параллельной работе. Перед запуском параллельных агентов давать им конкретный список того, что в этих файлах **уже добавил оркестратор/предыдущий агент**, чтобы они не дублировали и не пропускали.

### 2. Узкий union в фазовой работе — антипаттерн

A.1 закрыл `PromptResolverTaskType` буквально 5 значениями («summary/tasks/chapters/follow-up/card-rollup»). B/D/E пришлось делать type cast. C расширил union, но забыл про B/D/E.

**Урок:** для union'ов, которые расширяются другими фазами, явно делать комментарий «расширяется в фазах X/Y/Z» и оставлять `// extend here` маркер. Или сразу делать open-ended `string & {}` pattern.

### 3. `cp -ru` лучше `git merge` для worktree без коммитов

A.3 worktree был на том же базовом коммите d6fda6a что и main, без своих коммитов. `git merge` бесполезен. `cp -ru` (update if newer) с правильным расчётом — что worktree файл новее → его берём — сработал идеально.

**Урок:** для merge worktree без commits — `cp -ru` source/. dest/. Это безопаснее чем `cp -rf` (не перетирает свежие main файлы).

### 4. Docker Desktop Linux engine может прогреваться 5-10 минут после запуска

Несколько попыток `docker compose up` падали с `pipe dockerDesktopLinuxEngine not found` хотя `docker info` показывал клиент-сервер связь.

**Урок:** не блокировать оркестрацию ожиданием Docker. Все агенты могут работать без БД (mock-тесты), `prisma:push` оставить пользователю как часть prod-инструкции.

### 5. `pdf-parse@^2.4.6` unpublished с npm

Версия `2.4.6` указана в `backend/package.json`, но её нет на npmjs.org (последняя — 2.4.5). Это вылезло только при `bun install` после моего `cp -ru` (он сбросил локальный `node_modules`). Это **pre-existing bug** в проекте — `bun install` не работал бы и без моих действий, если бы кто-то его запустил.

**Урок:** проверять `npm view <pkg> versions` перед фиксацией версии в package.json. И в seed-инструкции писать `^2.4.x` (latest minor), а не точную patch-версию.

## Конкретные файлы

**Зонтик и sub-ТЗ:**
- [`plans/tz/2026-05-21-competitor-parity.md`](../../plans/tz/2026-05-21-competitor-parity.md)
- [`plans/tz/2026-05-21-phase-A-prompt-registry-admin.md`](../../plans/tz/2026-05-21-phase-A-prompt-registry-admin.md) (4 фазы A.1-A.4)
- [`plans/tz/2026-05-21-phase-B-meeting-behavior-metrics.md`](../../plans/tz/2026-05-21-phase-B-meeting-behavior-metrics.md)
- [`plans/tz/2026-05-21-phase-C-meeting-quality-score.md`](../../plans/tz/2026-05-21-phase-C-meeting-quality-score.md)
- [`plans/tz/2026-05-21-phase-D-transcript-cleaning.md`](../../plans/tz/2026-05-21-phase-D-transcript-cleaning.md)
- [`plans/tz/2026-05-21-phase-E-multi-report-per-meeting.md`](../../plans/tz/2026-05-21-phase-E-multi-report-per-meeting.md)

**Ключевые модели Prisma** (всё в [`backend/prisma/schema.prisma`](../../backend/prisma/schema.prisma)):
- A.1: PromptTemplate / PromptTemplateVersion / PromptTemplateSection / PromptExperiment / AiResultFeedback + AiResult.promptTemplateVersionId + AiUsageLog.tier/fallbackReason
- A.4: LlmTaskRoute.tier/priority + LlmTaskRouteChange + LlmModelExperiment + enum LlmRouteTier
- B: MeetingBehaviorMetrics + MeetingParticipantBehavior + Meeting.behaviorMetricsStatus
- C: MeetingQualityScore + Meeting.qualityScoreStatus + Org.qualityScoreDisabledForTypes
- D: Transcript.cleanedS3Url/cleaningStatus/cleaningStats/cleanedAt + Org.transcriptCleaningAuto
- E: MeetingReport + enum MeetingReportStatus + Meeting.customReports + partial unique index в `apply-postgres-init.sql`

**Воркеры BullMQ** (`backend/src/modules/ai/workers/`):
- ai.behavior-metrics (B)
- ai.transcript-clean (D)
- ai.quality-score (C, enqueue из ai.analyze после ai_ready)
- ai.custom-report (E, только on-demand)

**Admin UI:**
- `/admin/prompts` — A.2 (10 endpoints, drag-up/down редактор до 30 разделов, preview)
- `/admin/prompts/experiments` — A.3 (PromptExperiment с FNV-1a sticky allocation)
- `/admin/ai-models` — A.4 (per-taskType цепочка primary/secondary/tertiary с переключением одной кнопкой)

**Seed-скрипты** (`backend/scripts/`):
- seed-prompt-templates.ts (13 системных)
- seed-llm-task-routes-default.ts (28+ taskType с 3 tier'ами)
- seed-llm-task-routes-phase-{B,C,D,E}.ts (5 новых taskType'ов)
- smoke-llm-tertiary.ts (проверка Ollama qwen3.5:9b на 5 ключевых taskType'ах)

## Открытые блокеры для прода

1. **Docker compose dev не поднимается** — `pipe dockerDesktopLinuxEngine not found`. Без него:
   - `bun run prisma:push` не выполнен (схема в коде, не в БД)
   - 6 seed-скриптов не запущены
2. **Frontend `bun install`** падает: `EPERM` на next.js (Windows lock — возможно запущенный `next dev`) + 404 на `@livekit/components-react@2.9.21` от cdn.npmmirror.com.
3. **8 pre-existing test fails** (S3 + livekit-egress + accounts) — связаны с обновлением SDK, моки нужно переписать. Не блокирует Wave 1-3.
